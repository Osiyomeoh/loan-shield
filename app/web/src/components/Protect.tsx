// The owner's controls: turn protection on, then add USDC, withdraw, change the policy or turn it off. Every change is
// a transaction the owner's wallet signs; the form only builds it and shows what it would do.
import { AnimatePresence, motion } from "motion/react";
import { useId, useMemo, useState, type ReactNode } from "react";
import { DEFAULTS, KEEPER_WEBHOOK, onFork, REPO, web } from "../config";
import { hfText, short, usdc } from "../lib/format";
import type { Funds, Loan } from "../lib/live";
import { PRESETS, protectPreview, spendable, suggestedTopUp, type LoanState, type PlanRow } from "../lib/view";
import { signTypedData, walletError } from "../lib/wallet";
import { CodeBlock } from "./Copy";
import { IconArrow, IconCheck } from "./Icons";
import { Ext } from "./Links";
import { TxSteps, type Step } from "./TxSteps";

export type Owner = { loan: Loan; s: LoanState; price: number; funds: Funds; account: string; onDone: () => void };

/** A typed USDC amount: its base units, or why it can't be used. */
function readAmount(text: string, max: bigint, maxWhy: string): { value?: bigint; error?: string } {
  if (text.trim() === "") return { value: 0n };
  try {
    const value = web.parseUnits(text, 6);
    if (value > max) return { value, error: maxWhy };
    return { value };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
const asText = (v: bigint) => web.formatUnits(v, 6, 6).replace(/,/g, "").replace(/\.?0+$/, "");
/** The typed amount in base units, or undefined while it isn't a valid number. */
function tryUnits(text: string) {
  try {
    return web.parseUnits(text, 6);
  } catch {
    return undefined;
  }
}

function AmountField({ label, text, setText, chips, hint, error }: { label: string; text: string; setText: (t: string) => void; chips: { label: string; value: bigint }[]; hint: ReactNode; error?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={`amount ${error ? "invalid" : ""}`}>
        <input id={id} inputMode="decimal" autoComplete="off" placeholder="0.00" value={text} onChange={(e) => setText(e.target.value)} aria-invalid={!!error} aria-describedby={`${id}-hint`} />
        <span>USDC</span>
      </div>
      <div className="chips">
        {chips.map((c) => (
          <button type="button" key={c.label} className={`chip-btn ${text !== "" && tryUnits(text) === c.value ? "on" : ""}`} onClick={() => setText(asText(c.value))}>
            {c.label}
          </button>
        ))}
      </div>
      <small id={`${id}-hint`} className={error ? "bad" : "muted"}>
        {error ?? hint}
      </small>
    </div>
  );
}

type Policy = { trigger: bigint; target: bigint };

function PolicyField({ value, onChange }: { value: { preset: string; trigger: string; target: string }; onChange: (v: { preset: string; trigger: string; target: string }) => void }) {
  return (
    <div className="field">
      <span className="field-label" id="policy-label">
        When to rescue
      </span>
      <div className="presets" role="radiogroup" aria-labelledby="policy-label">
        {[...PRESETS, { key: "custom", name: "Custom", trigger: 0n, target: 0n, note: "Pick your own numbers" }].map((p) => (
          <button
            type="button"
            role="radio"
            aria-checked={value.preset === p.key}
            key={p.key}
            className={`preset ${value.preset === p.key ? "on" : ""}`}
            onClick={() => onChange(p.key === "custom" ? { ...value, preset: "custom" } : { preset: p.key, trigger: hfText(p.trigger), target: hfText(p.target) })}
          >
            <b>{p.name}</b>
            <span className="num">{p.key === "custom" ? "…" : `${hfText(p.trigger)} → ${hfText(p.target)}`}</span>
            <small>{p.note}</small>
          </button>
        ))}
      </div>
      {value.preset === "custom" && (
        <div className="lookup" style={{ marginTop: 4 }}>
          <label>
            Rescue below health factor
            <input inputMode="decimal" value={value.trigger} onChange={(e) => onChange({ ...value, trigger: e.target.value })} />
          </label>
          <label>
            Lift it back up to
            <input inputMode="decimal" value={value.target} onChange={(e) => onChange({ ...value, target: e.target.value })} />
          </label>
        </div>
      )}
    </div>
  );
}

function readPolicy(v: { trigger: string; target: string }): { value?: Policy; error?: string } {
  try {
    const trigger = web.parseUnits(v.trigger, 18);
    const target = web.parseUnits(v.target, 18);
    const error = web.policyError(trigger, target);
    return error ? { error: `Health factors: ${error}.` } : { value: { trigger, target } };
  } catch {
    return { error: "Health factors are numbers like 1.3 and 1.8." };
  }
}

function initialPolicy(current: Policy | undefined) {
  const match = PRESETS.find((p) => current && p.trigger === current.trigger && p.target === current.target);
  if (current && current.trigger > 0n && !match) return { preset: "custom", trigger: hfText(current.trigger, 4).replace(/0+$/, "").replace(/\.$/, ""), target: hfText(current.target, 4).replace(/0+$/, "").replace(/\.$/, "") };
  const p = match ?? PRESETS[1];
  return { preset: p.key, trigger: hfText(p.trigger), target: hfText(p.target) };
}

function Preview({ rows, warning, empty }: { rows?: PlanRow[]; warning?: string; empty: string }) {
  return (
    <div className="plan">
      <span className="field-label">What this does</span>
      {rows ? (
        <ul>
          {rows.map((r) => (
            <li key={r.label} className={r.tone}>
              <span>{r.label}</span>
              <b className="num">{r.value}</b>
              <small>{r.sub}</small>
            </li>
          ))}
        </ul>
      ) : (
        <p className="small muted">{empty}</p>
      )}
      {warning && <p className="result warn small">{warning}</p>}
      <p className="small muted">Assumes only the BTC price moves. Your cirBTC is never touched: a rescue repays debt with the buffer's USDC.</p>
    </div>
  );
}

function stepFor(tx: web.OwnerTx, amount: bigint, policy?: Policy): Step {
  switch (tx.kind) {
    case "approve":
      return { tx, title: `Allow Loan Shield to take ${asText(amount)} USDC`, detail: "A USDC approval for exactly this amount, nothing more" };
    case "deposit":
      return { tx, title: `Deposit ${asText(amount)} USDC into your buffer`, detail: "It stays yours: withdraw it whenever you like" };
    case "setPolicy":
      return { tx, title: `Rescue below ${hfText(policy!.trigger)}, back up to ${hfText(policy!.target)}`, detail: "Sets your policy for the cirBTC / USDC market" };
    case "withdraw":
      return { tx, title: `Withdraw ${asText(amount)} USDC to your wallet` };
    case "clearPolicy":
      return { tx, title: "Turn rescues off for this market", detail: "After this, rescue reverts with NoPolicy() whoever calls it" };
  }
}

/**
 * Add USDC and/or set the policy. `mode` picks the fields: "protect" both (the first time), "add" only the amount,
 * "policy" only the trigger and target.
 */
export function ProtectForm({ owner, mode, onCancel }: { owner: Owner; mode: "protect" | "add" | "policy"; onCancel?: () => void }) {
  const { loan, s, price, funds, account, onDone } = owner;
  const current = s.trigger > 0n ? { trigger: s.trigger, target: s.target } : undefined;
  const [policyText, setPolicyText] = useState(() => initialPolicy(current));
  const policy = mode === "add" ? { value: current } : readPolicy(policyText);
  const can = spendable(funds.balance);
  const [amountText, setAmountText] = useState(() => {
    if (mode === "policy") return "";
    const p = current ?? PRESETS[1];
    const suggested = suggestedTopUp(s, p.trigger, p.target);
    return suggested > 0n ? asText(suggested < can ? suggested : can) : "";
  });
  const amount = mode === "policy" ? { value: 0n } : readAmount(amountText, can, `Your wallet has ${usdc(funds.balance)}; keep about 0.10 USDC of it for gas.`);
  const [review, setReview] = useState<Step[]>();

  const next = policy.value && amount.value !== undefined ? { buffer: s.buffer + amount.value, ...policy.value } : undefined;
  const preview = next ? protectPreview(s, price, next) : undefined;
  const plan = useMemo(() => {
    if (!policy.value || amount.value === undefined || amount.error) return undefined;
    try {
      return web.planProtect({ shield: loan.shield, market: loan.market, amount: amount.value, allowance: funds.allowance, ...policy.value, current });
    } catch {
      return undefined;
    }
  }, [policy.value?.trigger, policy.value?.target, amount.value, amount.error, funds.allowance, loan.shield, loan.market, current?.trigger, current?.target]);

  const nextRescue = policy.value ? suggestedTopUp(s, policy.value.trigger, policy.value.target) : 0n;
  const chips = [
    ...(nextRescue > 0n ? [{ label: `Next rescue · ${usdc(nextRescue)}`, value: nextRescue }] : []),
    { label: "25%", value: can / 4n },
    { label: "50%", value: can / 2n },
    { label: "Max", value: can },
  ];
  const problem = policy.error ?? amount.error ?? (plan && plan.length === 0 ? (mode === "add" ? "Enter an amount to add." : "That's already your policy.") : undefined);

  if (review) {
    return (
      <TxSteps
        steps={review}
        account={account}
        onCancel={() => {
          setReview(undefined);
          onCancel?.();
        }}
        onDone={onDone}
      />
    );
  }
  return (
    <form
      className="protect"
      onSubmit={(e) => {
        e.preventDefault();
        if (plan?.length && !problem) setReview(plan.map((tx) => stepFor(tx, amount.value ?? 0n, policy.value)));
      }}
    >
      <div className="protect-fields">
        {mode !== "policy" && (
          <AmountField
            label={mode === "add" ? "USDC to add" : "Standby USDC"}
            text={amountText}
            setText={setAmountText}
            chips={chips}
            error={amount.error}
            hint={
              <>
                Wallet {usdc(funds.balance)}
                {s.buffer > 0n ? ` · already in your buffer ${usdc(s.buffer)}` : ""}. It waits in the shield until a rescue needs it.
              </>
            }
          />
        )}
        {mode !== "add" && <PolicyField value={policyText} onChange={setPolicyText} />}
      </div>
      <Preview rows={preview?.rows} warning={preview?.warning} empty={s.debt === 0n ? "You have no debt in this market yet. Protection starts working once you borrow." : "Fix the numbers on the left to see the effect."} />
      <div className="protect-foot">
        {problem && <span className="bad small">{problem}</span>}
        <div className="btn-row">
          {onCancel && (
            <button type="button" className="btn ghost" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" className="btn primary" disabled={!plan?.length || !!problem}>
            Review {plan?.length ? `${plan.length} step${plan.length > 1 ? "s" : ""}` : ""} <IconArrow />
          </button>
        </div>
      </div>
    </form>
  );
}

export function WithdrawForm({ owner, onCancel }: { owner: Owner; onCancel: () => void }) {
  const { loan, s, price, account, onDone } = owner;
  const [text, setText] = useState("");
  const amount = readAmount(text, s.buffer, `Your buffer holds ${usdc(s.buffer)}.`);
  const [review, setReview] = useState<Step[]>();
  const left = amount.value !== undefined && !amount.error ? s.buffer - amount.value : s.buffer;
  const preview = s.trigger > 0n ? protectPreview(s, price, { buffer: left, trigger: s.trigger, target: s.target }) : undefined;
  if (review) return <TxSteps steps={review} account={account} onCancel={onCancel} onDone={onDone} />;
  const ok = !!amount.value && !amount.error;
  return (
    <form
      className="protect"
      onSubmit={(e) => {
        e.preventDefault();
        if (ok) setReview([stepFor(web.ownerTx.withdraw(loan.shield, amount.value!), amount.value!)]);
      }}
    >
      <div className="protect-fields">
        <AmountField
          label="USDC to withdraw"
          text={text}
          setText={setText}
          chips={[
            { label: "50%", value: s.buffer / 2n },
            { label: "All", value: s.buffer },
          ]}
          error={amount.error}
          hint={`Your buffer holds ${usdc(s.buffer)}. Withdrawals go straight back to your wallet.`}
        />
      </div>
      <Preview rows={preview?.rows} warning={left === 0n && s.trigger > 0n ? "With the whole buffer withdrawn, a rescue has nothing to repay with." : undefined} empty="No debt or no policy, so nothing else changes." />
      <div className="protect-foot">
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={!ok}>
            Review <IconArrow />
          </button>
        </div>
      </div>
    </form>
  );
}

function TurnOffForm({ owner, onCancel }: { owner: Owner; onCancel: () => void }) {
  const { loan, s, account, onDone } = owner;
  const [alsoWithdraw, setAlsoWithdraw] = useState(s.buffer > 0n);
  const [review, setReview] = useState<Step[]>();
  if (review) return <TxSteps steps={review} account={account} onCancel={onCancel} onDone={onDone} />;
  return (
    <form
      className="protect single"
      onSubmit={(e) => {
        e.preventDefault();
        const steps = [stepFor(web.ownerTx.clearPolicy(loan.shield, loan.market), 0n)];
        if (alsoWithdraw && s.buffer > 0n) steps.push(stepFor(web.ownerTx.withdraw(loan.shield, s.buffer), s.buffer));
        setReview(steps);
      }}
    >
      <p>Rescues stop for this loan. Morpho's normal liquidation rules apply on their own again. You can turn protection back on at any time.</p>
      {s.buffer > 0n && (
        <label className="check">
          <input type="checkbox" checked={alsoWithdraw} onChange={(e) => setAlsoWithdraw(e.target.checked)} />
          Also withdraw the {usdc(s.buffer)} buffer to my wallet
        </label>
      )}
      <div className="btn-row">
        <button type="button" className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn primary">
          Review <IconArrow />
        </button>
      </div>
    </form>
  );
}

const ACTIONS = [
  { key: "add", label: "Add USDC" },
  { key: "withdraw", label: "Withdraw" },
  { key: "policy", label: "Change policy" },
  { key: "off", label: "Turn off" },
] as const;

/** The owner's controls for a protected loan. */
export function ManagePanel({ owner }: { owner: Owner }) {
  const [open, setOpen] = useState<(typeof ACTIONS)[number]["key"]>();
  // Each opening is a fresh form: reopening a tab mid-animation must not bring back a finished one.
  const [opened, setOpened] = useState(0);
  const close = () => setOpen(undefined);
  const done = () => owner.onDone();
  const o = { ...owner, onDone: done };
  return (
    <section className="card manage">
      <div className="card-head">
        <h3>Manage protection</h3>
        <span className="small muted">
          Buffer {usdc(owner.s.buffer)} · policy {hfText(owner.s.trigger)} → {hfText(owner.s.target)}
        </span>
      </div>
      <div className="seg-tabs" role="tablist" aria-label="Manage protection">
        {ACTIONS.map((a) => (
          <button key={a.key} type="button" role="tab" aria-selected={open === a.key} className={open === a.key ? "on" : ""} onClick={() => {
              setOpened((n) => n + 1);
              setOpen(open === a.key ? undefined : a.key);
            }}>
            {a.label}
          </button>
        ))}
      </div>
      <AnimatePresence initial={false} mode="wait">
        {open && (
          <motion.div key={`${open}${opened}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25 }} style={{ overflow: "hidden" }}>
            <div style={{ paddingTop: 20 }}>
              {open === "add" && <ProtectForm owner={o} mode="add" onCancel={close} />}
              {open === "policy" && <ProtectForm owner={o} mode="policy" onCancel={close} />}
              {open === "withdraw" && <WithdrawForm owner={o} onCancel={close} />}
              {open === "off" && <TurnOffForm owner={o} onCancel={close} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** Whether this site's hosted keeper (app/api/webhook.ts and the 5-minute sweep) watches loans on `loan.shield`. */
const hostedKeeper = (loan: Loan) => !onFork && loan.shield.toLowerCase() === DEFAULTS.shield.toLowerCase();

type AlertsPhase =
  | { at: "idle" | "finding" | "signing" | "sending" | "none" }
  | { at: "done"; when: number; fresh: boolean }
  | { at: "failed"; error: string };

// Borrow Kit has no endpoint that reads a loan's alert address back, so the page remembers what it sent from this
// browser. Storage can be blocked (private windows); the page then just offers the button again.
const alertsKey = (loan: Loan, account: string) => `loan-shield:alerts:${loan.shield}:${account}:${loan.market}`.toLowerCase();
const sentAlerts = {
  get(key: string): number | undefined {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null");
      return saved?.webhookUrl === KEEPER_WEBHOOK && typeof saved.at === "number" ? saved.at : undefined;
    } catch {
      return undefined;
    }
  },
  set(key: string, loanId: string) {
    try {
      localStorage.setItem(key, JSON.stringify({ loanId, webhookUrl: KEEPER_WEBHOOK, at: Date.now() }));
    } catch {
      // Not remembered; Borrow Kit has it either way.
    }
  },
};
const circleFetch: typeof fetch = (input, init) => fetch(input, init);
const dateText = (ms: number) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Points the owner's Borrow Kit health-band alerts at the hosted keeper's webhook: one EIP-712 signature, checked by
 * Circle, and no transaction. Kept apart from the transaction steps, so a Borrow Kit outage can't affect protection.
 */
function KeeperAlerts({ loan, account, hosted }: { loan: Loan; account: string; hosted: boolean }) {
  const key = alertsKey(loan, account);
  const [phase, setPhase] = useState<AlertsPhase>(() => {
    const when = sentAlerts.get(key);
    return when ? { at: "done", when, fresh: false } : { at: "idle" };
  });
  const busy = phase.at === "finding" || phase.at === "signing" || phase.at === "sending";

  async function send() {
    try {
      setPhase({ at: "finding" });
      const found = await web.findBorrowKitLoan(circleFetch, account, loan.market);
      if (!found) return setPhase({ at: "none" });
      // Borrow Kit refuses a deadline more than 300 s away; the signature is good for 4 minutes.
      const deadline = Math.floor(Date.now() / 1000) + web.WEBHOOK_DEADLINE_SECONDS;
      const typed = web.webhookRegistration({ loanId: found.loanId, owner: account, webhookUrl: KEEPER_WEBHOOK, deadline });
      setPhase({ at: "signing" });
      const signature = await signTypedData(typed);
      setPhase({ at: "sending" });
      await web.postWebhookRegistration(circleFetch, { loanId: found.loanId, webhookUrl: KEEPER_WEBHOOK, deadline, signature });
      sentAlerts.set(key, found.loanId);
      setPhase({ at: "done", when: Date.now(), fresh: true });
    } catch (err) {
      setPhase({ at: "failed", error: walletError(err) });
    }
  }

  const button = (label: string, ghost = false) => (
    <button type="button" className={`btn sm ${ghost ? "ghost" : "primary"}`} onClick={send} disabled={busy}>
      {label}
    </button>
  );
  return (
    <div className="keeper-alerts">
      <p className="small">
        <b>Wake it sooner.</b> Borrow Kit can alert a web address each time your loan crosses a health band (SAFE, WARN, URGENT, IMMINENT,
        LIQUIDATABLE). Send those alerts to this keeper and it checks your loan as soon as one arrives{hosted ? ", without waiting for its next pass" : ""}. It's
        one signature in your wallet: no transaction, no gas. Borrow Kit keeps one alert address per loan, so this replaces any you set before.
      </p>
      <div style={{ marginTop: 12 }} aria-live="polite">
        {phase.at === "idle" && button("Send alerts to the keeper")}
        {busy && (
          <p className="small muted">
            {phase.at === "finding" ? "Finding your Borrow Kit loan…" : phase.at === "signing" ? "Sign the message in your wallet. It costs no gas." : "Sending it to Borrow Kit…"}
          </p>
        )}
        {phase.at === "none" && (
          <p className="result warn">
            Borrow Kit has no open loan for this wallet in this market, so it has no alerts to send (a loan opened on Morpho directly has none).
            {hosted ? " The keeper's 5-minute check still covers your loan." : ""}
          </p>
        )}
        {phase.at === "done" && (
          <>
            <p className="result good" role="status">
              <IconCheck /> <span>{phase.fresh ? "Borrow Kit confirmed it: this loan's alerts now go to the keeper." : `You sent this loan's alerts to the keeper from this browser on ${dateText(phase.when)}.`}</span>
            </p>
            <div style={{ marginTop: 10 }}>{button("Send them again", true)}</div>
          </>
        )}
        {phase.at === "failed" && (
          <>
            <p className="result bad">Not sent: {phase.error}</p>
            <div style={{ marginTop: 10 }}>{button("Try again")}</div>
          </>
        )}
      </div>
    </div>
  );
}

/** Who sends the rescue for this loan: what the hosted keeper covers, and how to run another keeper. */
export function WhoWatches({ loan, account }: { loan: Loan; account: string }) {
  const hosted = hostedKeeper(loan);
  const keeperCommand = (
    <CodeBlock label="in loan-shield/app, with KEEPER_PRIVATE_KEY in .env" code={`SHIELD_ADDRESS=${loan.shield} WATCH=${loan.borrower}:${loan.market} npm run keeper`} />
  );
  const keeperNote = (
    <p className="small muted" style={{ marginTop: 10 }}>
      It checks every 30 seconds and sends only when the contract's <code>preview</code> says Ready.{" "}
      <Ext href={`${REPO}#run-it-on-mainnet-operator-steps`}>Setup steps</Ext>
    </p>
  );
  return (
    <section className="card">
      <div className="card-head">
        <h3>Who sends the rescue</h3>
        <span className={`pill ${hosted ? "good" : "warn"}`}>{hosted ? "Hosted keeper" : onFork ? "Local fork" : "Run a keeper"}</span>
      </div>
      <p className="small">
        Anyone can: <code>rescue</code> needs no permission, and it can only repay your own loan from your own buffer.{" "}
        {hosted
          ? "This site's keeper finds every loan with protection on from the contract's own events and checks each one about every 5 minutes (on GitHub's scheduler, which can start late). When the contract says a rescue is due, the keeper sends it and pays the gas. It skips rescues under 0.01 USDC; anyone else can still send those."
          : onFork
            ? "No hosted keeper watches a local fork: run the repo's keeper against it. The alert button below talks to Borrow Kit just as it does on mainnet."
            : `This site's keeper watches the Loan Shield contract at ${short(DEFAULTS.shield)} only. To have this loan watched, run the repo's keeper with a gas-only key:`}
      </p>
      {(hosted || onFork) && loan.market.toLowerCase() === web.CIRBTC_MARKET.toLowerCase() && <KeeperAlerts loan={loan} account={account} hosted={hosted} />}
      {hosted || onFork ? (
        <details className="advanced" style={{ marginTop: 16 }}>
          <summary>Run your own keeper too</summary>
          <div style={{ marginTop: 12 }}>
            {keeperCommand}
            {keeperNote}
          </div>
        </details>
      ) : (
        <div style={{ marginTop: 14 }}>
          {keeperCommand}
          {keeperNote}
        </div>
      )}
    </section>
  );
}
