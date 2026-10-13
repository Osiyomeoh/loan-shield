import { motion } from "motion/react";
import { useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { DEFAULTS, onFork, rpc, rpcUrl, web } from "../config";
import { CountUp } from "../components/CountUp";
import { HealthRing } from "../components/HealthRing";
import { IconArrow, IconBolt, IconCheck, IconCoins, IconPlay, IconShield, IconUsers } from "../components/Icons";
import { Explorer } from "../components/Links";
import { Reveal } from "../components/Reveal";
import { Runway } from "../components/Runway";
import { dollars, hfText, short, usdc } from "../lib/format";
import { isValidLoan, useKeeper, useLive, type Loan, type Rescue } from "../lib/live";
import { compareRows, coverage, headline, ladder, ltvText, PILLS, steps, verdict, type LoanState, type MarketState, type Outlook } from "../lib/view";
import { useTitle } from "../lib/useTitle";

const SAFETY = [
  "USDC in the shield leaves only two ways: back to its owner, or as a repayment of the owner's own loan.",
  "A repayment can happen only while the loan's health factor is below the owner's trigger. It repays only enough to reach the owner's target.",
  "Health is Morpho's own formula, oracle and rounding, after interest. Below 1.00 here is exactly what Morpho lets a liquidator take.",
  "The contract has no owner, no pause and no upgrade path. Anyone can call a rescue, and no one can redirect the money.",
];

function useLoanFromUrl(): Loan {
  const [params] = useSearchParams();
  return {
    shield: params.get("shield") ?? DEFAULTS.shield,
    borrower: params.get("borrower") ?? DEFAULTS.borrower,
    market: params.get("market") ?? DEFAULTS.market,
  };
}

function Hero({ loan, s, o, price, isDemo }: { loan: Loan; s: LoanState; o: Outlook | undefined; price: number; isDemo: boolean }) {
  const v = verdict(s);
  const pill = PILLS[v];
  const { title, text } = headline(s, o, price, v);
  return (
    <section className={`card dash-hero ${pill.tone ? `s-${pill.tone}` : ""}`} aria-live="polite">
      <div>
        <span className={`pill ${pill.tone}`}>{pill.label}</span>
        {isDemo && <span className="tag">Demo loan</span>}
        <motion.h1 key={title} className="headline" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          {title}
        </motion.h1>
        {text && <p className="subline">{text}</p>}
        <p className="meta">
          <span>
            Borrower <Explorer path={`address/${loan.borrower}`}>{short(loan.borrower)}</Explorer>
          </span>
          <span>
            Shield <Explorer path={`address/${loan.shield}`}>{short(loan.shield)}</Explorer>
          </span>
          <span>{loan.market.toLowerCase() === web.CIRBTC_MARKET ? "cirBTC / USDC market" : `market ${short(loan.market)}`}</span>
        </p>
      </div>
      <HealthRing hf={s.healthFactor} trigger={s.trigger} target={s.target} size={280} />
    </section>
  );
}

function Tiles({ s, o, price, m }: { s: LoanState; o: Outlook | undefined; price: number; m: MarketState }) {
  const btc = Number(s.collateral) / 10 ** m.collateralDecimals;
  const cov = coverage(s, o);
  const tiles = [
    { icon: IconShield, label: "Collateral", val: `${web.formatUnits(s.collateral, m.collateralDecimals, 6)} cirBTC`, sub: `≈ ${dollars(btc * price)} at the oracle price` },
    { icon: IconCoins, label: "Debt", val: usdc(s.debt), sub: ltvText(s, m, price) },
    {
      icon: IconBolt,
      label: "Standby buffer",
      val: usdc(s.buffer),
      sub: cov ? cov.text : s.preview.status === "Ready" ? `the due rescue uses ${usdc(s.preview.repayAssets)}` : "standby, owner can withdraw",
      meter: cov,
    },
    {
      icon: IconUsers,
      label: "Policy",
      val: s.trigger === 0n ? "none" : `${hfText(s.trigger)} → ${hfText(s.target)}`,
      sub: s.trigger === 0n ? "the shield won't act" : "rescue below the trigger, back up to the target",
    },
  ];
  return (
    <div className="tiles">
      {tiles.map((t, i) => (
        <Reveal key={t.label} delay={i * 0.06} className="card tile">
          <div className="label">
            <t.icon /> {t.label}
          </div>
          <div className="val">{t.val}</div>
          <div className="sub">{t.sub}</div>
          {t.meter && (
            <div className="meter">
              <motion.i
                className={t.meter.cover >= 1 ? "" : t.meter.cover > 0 ? "warn" : "bad"}
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: t.meter.cover }}
                viewport={{ once: true }}
                transition={{ duration: 1, ease: [0.22, 1, 0.36, 1] }}
              />
            </div>
          )}
        </Reveal>
      ))}
    </div>
  );
}

function History({ events, deployedAt }: { events: Rescue[]; deployedAt: bigint }) {
  const when = (t?: number) => (t === undefined ? "" : new Date(t * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }));
  return (
    <section className="card">
      <div className="card-head">
        <h3>Rescue history</h3>
        <span className="small muted">searched every block since the deploy ({deployedAt.toLocaleString("en-US")})</span>
      </div>
      {events.length === 0 ? (
        <p className="empty">No rescues yet.</p>
      ) : (
        <ol className="timeline">
          {[...events].reverse().map((e) => (
            <motion.li key={e.transactionHash} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <span className="ico">
                <IconShield />
              </span>
              <div>
                <div className="t1">
                  Repaid {usdc(e.assets)} · health factor {web.formatWad(e.healthFactorBefore)} → {web.formatWad(e.healthFactorAfter)}
                </div>
                <div className="t2">
                  {e.time !== undefined && <span>{when(e.time)}</span>}
                  <span>
                    block <Explorer path={`block/${e.blockNumber}`}>{e.blockNumber.toLocaleString("en-US")}</Explorer>
                  </span>
                  <span>
                    sent by <Explorer path={`address/${e.caller}`}>{short(e.caller)}</Explorer>
                  </span>
                  <span>
                    tx <Explorer path={`tx/${e.transactionHash}`}>{short(e.transactionHash)}</Explorer>
                  </span>
                </div>
              </div>
            </motion.li>
          ))}
        </ol>
      )}
    </section>
  );
}

type Sim = { tone: "" | "good" | "warn" | "bad"; text: string };

function DryRun({ loan }: { loan: Loan }) {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<Sim>();
  const run = async () => {
    setBusy(true);
    setOut({ tone: "", text: "Calling…" });
    try {
      const r = await web.simulateRescue(rpc, loan);
      if (r.ok) {
        setOut({ tone: "warn", text: `It would succeed: repay ${usdc(r.assets)} of this borrower's debt from their own buffer, health factor → ${web.formatWad(r.healthFactorAfter)}.` });
      } else {
        const a = r.args;
        const why: Record<string, () => string> = {
          NotInDanger: () => `Reverts NotInDanger(health factor ${web.formatWad(a[0] ?? 0n)}, trigger ${web.formatWad(a[1] ?? 0n)}). The loan is safe, so the buffer cannot move, whoever calls.`,
          NoPolicy: () => "Reverts NoPolicy(): the owner hasn't opted this market in.",
          NoDebt: () => "Reverts NoDebt(): nothing to repay.",
          EmptyBuffer: () => "Reverts EmptyBuffer(): the loan is in danger but there's no standby USDC.",
        };
        setOut({ tone: r.name === "NotInDanger" ? "good" : "", text: why[r.name]?.() ?? `Reverts ${r.name}(${a.join(", ")}).` });
      }
    } catch (err) {
      setOut({ tone: "bad", text: `RPC error: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <div className="card-head">
        <h3>Dry-run a rescue</h3>
      </div>
      <p className="small muted">
        Runs <code>rescue(borrower, market)</code> on Arc as an <code>eth_call</code>, exactly as a keeper would send it. Nothing is sent.
      </p>
      <button type="button" className="btn primary" style={{ marginTop: 16 }} onClick={run} disabled={busy}>
        <IconPlay /> {busy ? "Calling…" : "Dry-run rescue now"}
      </button>
      {out && (
        <motion.p key={out.text} className={`result ${out.tone}`} role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {out.text}
        </motion.p>
      )}
    </section>
  );
}

function Keeper() {
  const k = useKeeper();
  return (
    <section className="card">
      <div className="card-head">
        <h3>Keeper</h3>
        {k.state === "online" && <span className={`pill ${k.sends ? "good" : "warn"}`}>{k.sends ? "Sending" : "Report-only"}</span>}
      </div>
      {k.state === "loading" ? (
        <p className="small muted">Checking…</p>
      ) : k.state === "online" ? (
        <p className="small">
          Webhook receiver online: watching {k.watching} loan(s), {k.sends ? "sends rescues with a gas-only key" : "report-only for now (no keeper key set)"}. Borrow Kit health-band alerts only wake it up: it re-reads the chain and acts only if the contract says a rescue is due.
        </p>
      ) : (
        <p className="small muted">No keeper webhook on this host. Anyone can run one: rescue is permissionless and only ever repays the borrower's own loan.</p>
      )}
    </section>
  );
}

function Lookup({ loan, open }: { loan: Loan; open: boolean }) {
  const [, setParams] = useSearchParams();
  const [error, setError] = useState("");
  const submit = (ev: FormEvent<HTMLFormElement>) => {
    ev.preventDefault();
    const f = new FormData(ev.currentTarget);
    const shield = String(f.get("shield") ?? "").trim();
    const borrower = String(f.get("borrower") ?? "").trim();
    const market = String(f.get("market") ?? "").trim().toLowerCase();
    const bad = !web.isAddress(shield) ? "Contract must be a 0x address." : !web.isAddress(borrower) ? "Borrower must be a 0x address." : !web.isBytes32(market) ? "Market id must be 32 bytes of hex." : "";
    setError(bad);
    if (bad) return;
    const q = new URLSearchParams({ shield, borrower, market });
    if (onFork) q.set("rpc", rpcUrl);
    setParams(q);
  };
  return (
    <details className="card" open={open}>
      <summary>Check another protected loan</summary>
      <form className="lookup" onSubmit={submit} key={`${loan.shield}${loan.borrower}${loan.market}`}>
        <label>
          Loan Shield contract
          <input name="shield" defaultValue={loan.shield} placeholder="0x…" spellCheck={false} autoComplete="off" />
        </label>
        <label>
          Borrower
          <input name="borrower" defaultValue={loan.borrower} placeholder="0x…" spellCheck={false} autoComplete="off" />
        </label>
        <label className="wide">
          Morpho market id
          <input name="market" defaultValue={loan.market} spellCheck={false} autoComplete="off" />
        </label>
        <div className="row">
          <button type="submit" className="btn primary sm">
            Show loan <IconArrow />
          </button>
          {error && (
            <span className="bad small" role="alert">
              {error}
            </span>
          )}
        </div>
      </form>
    </details>
  );
}

export default function Dashboard() {
  useTitle("Live dashboard");
  const loan = useLoanFromUrl();
  const valid = isValidLoan(loan);
  const { market, loan: s, history, error, block } = useLive(loan);
  const isDemo = (["shield", "borrower", "market"] as const).every((k) => loan[k].toLowerCase() === DEFAULTS[k].toLowerCase());
  const price = market ? web.collateralPrice(market) : 0;
  const o = s ? web.outlook(s, price) : undefined;

  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <Reveal className="card-head" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Live dashboard</span>
          <h2 style={{ fontSize: "clamp(28px, 3.4vw, 42px)" }}>{isDemo ? "The demo loan, protected" : "A protected loan"}</h2>
        </div>
        <span className="small muted">
          {block !== undefined ? `Read at block ${block.toLocaleString("en-US")}, refreshed every 20 s` : "Reading from Arc…"} · nothing is sent
        </span>
      </Reveal>

      {!valid ? (
        <div className="stack">
          <p className="result bad">That link doesn't name a loan: the contract and borrower must be 0x addresses and the market a 32-byte id.</p>
          <Lookup loan={loan} open />
        </div>
      ) : !s || !market ? (
        <div className="stack">
          {error ? (
            <section className="card">
              <h3>Couldn't read this loan</h3>
              <p className="muted" style={{ marginTop: 8 }}>{error}</p>
            </section>
          ) : (
            <section className="card dash-hero" aria-busy="true">
              <div>
                <span className="skel" style={{ width: 90, height: 26 }} />
                <h1 className="headline">Reading the loan from Arc…</h1>
                <p className="subline">
                  <span className="skel" style={{ width: "80%" }} />
                </p>
              </div>
              <div className="skel" style={{ width: 240, height: 240, borderRadius: "50%" }} />
            </section>
          )}
          <Lookup loan={loan} open={!!error} />
        </div>
      ) : (
        <div className="stack">
          {error && <p className="result bad" role="status">Arc RPC error, showing the last good read: {error}</p>}
          <Hero loan={loan} s={s} o={o} price={price} isDemo={isDemo} />

          {o && (
            <Reveal>
              <section className="card">
                <div className="card-head">
                  <h3>How far BTC can fall</h3>
                  <span className="small muted">BTC price, market oracle</span>
                </div>
                <Runway s={s} o={o} price={price} rows={ladder(s, o, price)} />
                <p className="note">These prices assume only the BTC price moves: no interest, no top-ups or withdrawals. They also assume each rescue lands before a liquidator acts.</p>
              </section>
            </Reveal>
          )}

          <Tiles s={s} o={o} price={price} m={market} />

          <div className="grid2">
            <Reveal>
              <section className="card" style={{ height: "100%" }}>
                <div className="card-head">
                  <h3>What happens next</h3>
                </div>
                <ol className="steps">
                  {steps(s, o, price, verdict(s), market).map((st) => (
                    <li key={st.title} className={st.tone}>
                      <b>{st.title}</b>
                      <p>{st.text}</p>
                    </li>
                  ))}
                </ol>
              </section>
            </Reveal>
            <Reveal delay={0.08}>
              <section className="card" style={{ height: "100%" }}>
                <div className="card-head">
                  <h3>Rescue vs liquidation</h3>
                </div>
                <div className="table-scroll">
                <table className="compare">
                  <thead>
                    <tr>
                      <th scope="col"></th>
                      <th scope="col" className="us">Loan Shield rescue</th>
                      <th scope="col">Morpho liquidation</th>
                    </tr>
                  </thead>
                  <tbody>
                    {compareRows(s, market).map((r) => (
                      <tr key={r.label}>
                        <th scope="row">{r.label}</th>
                        <td className="us">{r.us}</td>
                        <td>{r.them}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </section>
            </Reveal>
          </div>

          {history ? (
            <History events={history.events} deployedAt={history.deployedAt} />
          ) : (
            <section className="card">
              <div className="card-head">
                <h3>Rescue history</h3>
              </div>
              <p className="empty">Searching every block since the deploy…</p>
            </section>
          )}

          <div className="grid2">
            <DryRun loan={loan} />
            <Keeper />
          </div>

          <section className="card">
            <div className="card-head">
              <h3>The market this loan borrows from</h3>
              <Link to="/market" className="link small">
                Market details
              </Link>
            </div>
            <dl className="stats">
              <div>
                <dt>BTC price (market oracle)</dt>
                <dd>
                  <CountUp value={price} format={(n) => `$${Math.round(n).toLocaleString("en-US")}`} />
                </dd>
              </div>
              <div>
                <dt>Liquidation threshold</dt>
                <dd>{(Number(market.lltv) / 1e16).toFixed(0)}%</dd>
              </div>
              <div>
                <dt>Liquidation bonus</dt>
                <dd>{((web.liquidationIncentive(market.lltv) - 1) * 100).toFixed(2)}%</dd>
              </div>
            </dl>
          </section>

          <section className="card">
            <div className="card-head">
              <h3>Why the buffer is safe</h3>
            </div>
            <ul className="checks">
              {SAFETY.map((t) => (
                <li key={t}>
                  <IconCheck /> <span>{t}</span>
                </li>
              ))}
            </ul>
          </section>

          <Lookup loan={loan} open={false} />
        </div>
      )}
    </div>
  );
}
