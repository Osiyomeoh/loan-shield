import type { ReactNode } from "react";
import { Link } from "react-router";
import { REPO } from "../config";
import { IconArrow, IconCheck } from "../components/Icons";
import { Explorer, Ext } from "../components/Links";
import { Reveal } from "../components/Reveal";
import { PageHero, SectionHead } from "../components/Section";
import { useKeeper } from "../lib/live";
import { SOURCES } from "../lib/sources";
import { useTitle } from "../lib/useTitle";

const RESCUE_TX = "0x6a2633b3fe07f715a94da58e37e00fe903eb02ee986c9775a44fd0ea491cea3f";
const CLAIMS = `${REPO}/blob/main/CLAIMS.md`;

const FLOW: { title: string; text: ReactNode; formulas: string[] }[] = [
  {
    title: "Park standby USDC",
    text: (
      <>
        Approve the contract, then <code>deposit</code> USDC into your own buffer. It sits there untouched until a rescue needs it, and you can <code>withdraw</code> it at any time.
      </>
    ),
    formulas: ["deposit(amount)  →  buffer[you] += amount", "withdraw(amount) →  back to you, any time"],
  },
  {
    title: "Choose a trigger and a target",
    text: (
      <>
        <code>setPolicy</code> names the market and two health factors: rescues may start below the trigger, and each one lifts the loan back to the target. The contract only accepts markets whose loan token is USDC.
      </>
    ),
    formulas: ["setPolicy(market, trigger, target)", "1.00 < trigger < target ≤ 10.00"],
  },
  {
    title: "Someone watches the loan",
    text: (
      <>
        <code>preview</code> says exactly what a rescue would do in the current block. This site's keeper checks every loan with protection on about every 5 minutes, and a Borrow Kit health-band alert from your loan wakes it at once. It sends only when <code>preview</code> says Ready and a dry run succeeds.
      </>
    ),
    formulas: ["preview(borrower, market)  →  Ready?", "eth_call rescue  →  succeeds?  →  send"],
  },
  {
    title: "The rescue repays just enough",
    text: (
      <>
        Anyone may call <code>rescue</code>. The contract accrues interest, checks that health is below your trigger, repays from your buffer to reach your target, and reverts unless health improved. Your BTC is never touched.
      </>
    ),
    formulas: ["repay = debt × (target − HF) ÷ target, rounded up", "capped at your buffer"],
  },
];

const MATH: { label: string; formula: string }[] = [
  { label: "Health factor (Morpho's formula)", formula: "HF = collateral × price × LLTV ÷ debt" },
  { label: "BTC price at liquidation", formula: "price now ÷ HF" },
  { label: "BTC price where rescues start", formula: "price now × trigger ÷ HF" },
  { label: "Liquidation price once the buffer is spent", formula: "liquidation price × (debt − buffer) ÷ debt" },
  { label: "USDC a rescue repays", formula: "debt × (target − HF) ÷ target" },
];

const FAQ: { q: string; a: ReactNode }[] = [
  {
    q: "Is my BTC ever sold?",
    a: "No. A rescue calls Morpho's repay with USDC from your buffer. Your collateral stays where it is, so a rescue lowers the debt instead of shrinking your BTC.",
  },
  {
    q: "Who sends the rescue, and who pays for it?",
    a: (
      <>
        Anyone can send it, and the sender pays the gas in USDC, Arc's gas token. The live rescue used 178,980 gas, about 0.0036 USDC (<Ext href={CLAIMS}>CLAIMS.md, claim 7</Ext>). The repo's keeper sends it from a wallet that holds only gas money.
      </>
    ),
  },
  {
    q: "Could someone drain my buffer?",
    a: "No. USDC leaves your buffer only when you withdraw it, or as a repayment of your own debt in the market you chose, while health is below your trigger, and only enough to reach your target. Any other call reverts. A rescue turns buffer USDC into an equal amount of repaid debt, so it can't lose you money.",
  },
  {
    q: "What if the buffer runs short?",
    a: (
      <>
        The rescue repays whatever the buffer covers, which still lifts health part of the way. With nothing left, <code>rescue</code> reverts with <code>EmptyBuffer()</code>, and Morpho's normal liquidation rules apply again. Top the buffer up with <code>deposit</code> at any time.
      </>
    ),
  },
  {
    q: "What if nobody sends a rescue in time?",
    a: "The contract makes a rescue possible; it can't send one by itself. If health falls below 1.00 before anyone rescues, a liquidator can act. This site runs a keeper for every protected loan, and the repo ships the same keeper for anyone to run: any number of independent keepers can watch the same loan.",
  },
  {
    q: "Is the contract source verified?",
    a: (
      <>
        Verification on explorer.arc.io is still planned. The deployed runtime code matches this repo's build byte for byte, apart from the two constructor addresses (Morpho Blue and USDC). See the <Ext href={`${REPO}#status`}>README status table</Ext>.
      </>
    ),
  },
  {
    q: "Which loans can it protect?",
    a: (
      <>
        Loans in a Morpho Blue market on Arc whose loan token is USDC. The demo and this site use the cirBTC / USDC market behind Borrow Kit. For any other market, <code>setPolicy</code> reverts with <code>UnsupportedMarket</code>.
      </>
    ),
  },
  {
    q: "Do I need a wallet to use this site?",
    a: (
      <>
        Not to read: it reads the chain over Arc's public RPC. To protect your own loan, connect the wallet that borrowed on <Link to="/app" className="link">My loan</Link>. The page builds each transaction (a USDC approval for the exact amount, the deposit, the policy), checks it would succeed, and hands it to your wallet to show and sign. The site never sees a key. The command line works too: <code>npm run protect -- &lt;buffer usdc&gt; &lt;trigger&gt; &lt;target&gt;</code> sends nothing without <code>--yes</code>.
      </>
    ),
  },
];

type Row = { part: string; detail: string; status: string; tone: "good" | "warn" | "" };

export default function HowItWorks() {
  useTitle("How it works");
  const keeper = useKeeper();
  const webhook: Row =
    keeper.state === "online" && keeper.sends
      ? { part: "Webhook receiver on Vercel", detail: "Live, and sending rescues", status: "live", tone: "good" }
      : { part: "Webhook receiver on Vercel", detail: "Live. It checks the chain and reports, and sends rescues once the keeper key is set", status: "report-only", tone: "warn" };

  const rows: Row[] = [
    { part: "LoanShield contract", detail: "39 tests: unit, fuzz, invariant, and fork tests against the real Arc mainnet market", status: "built", tone: "good" },
    { part: "Deployed on Arc mainnet", detail: "2026-10-13. Runtime code matches the repo's build byte for byte, apart from the constructor addresses", status: "deployed", tone: "good" },
    { part: "Live mainnet rescue", detail: "2026-10-13: repaid 1.253229 USDC from the buffer, HF 1.236 → 1.800", status: "done", tone: "good" },
    { part: "Keeper and webhook receiver", detail: "Unit tested, and run end to end on a local fork of Arc mainnet", status: "built", tone: "good" },
    webhook,
    { part: "register-webhook script (Borrow Kit)", detail: "Ran on Arc mainnet 2026-10-13: the demo loan's health-band alerts go to the hosted webhook", status: "done", tone: "good" },
    { part: "Source verified on explorer.arc.io", detail: "Not done yet", status: "planned", tone: "" },
    { part: "Turning protection on in the browser", detail: "My loan page: connect a wallet, and it signs each step. Tested end to end on a local fork of Arc mainnet", status: "built", tone: "good" },
    { part: "Hosted keeper for every protected loan", detail: "A sweep every 5 minutes finds each policy from the contract's events, and any wallet's Borrow Kit alert makes the webhook check that wallet's loan. Unit tested, and the sweep run against Arc mainnet", status: "built", tone: "good" },
    { part: "Sending Borrow Kit alerts to the keeper from the browser", detail: "My loan page: one wallet signature, no gas. Tested against Circle's SDK: same signature and request", status: "built", tone: "good" },
    { part: "Borrow Kit integrator fee", detail: "Needs a Circle API key", status: "planned", tone: "" },
  ];

  return (
    <>
      <PageHero
        eyebrow="How it works"
        title={
          <>
            Set it once. It repays <span className="grad">just enough.</span>
          </>
        }
        aside={
          <p className="muted">
            Everything below comes from the contract source and the README. Each claim has a command that proves it in <Ext href={CLAIMS}>CLAIMS.md</Ext>.
          </p>
        }
      >
        Loan Shield is standby USDC for your Borrow Kit loan. If the loan gets close to liquidation, it repays just enough of the debt to bring the loan back to a health factor you chose.
      </PageHero>

      <section className="container section tight" style={{ paddingTop: 12 }}>
        <div className="flow">
          {FLOW.map((s, i) => (
            <Reveal key={s.title} delay={i * 0.05} className="card flow-step">
              <span className="flow-no">{i + 1}</span>
              <div>
                <h3>{s.title}</h3>
                <p>{s.text}</p>
              </div>
              <div>
                {s.formulas.map((f) => (
                  <div key={f} className="formula">
                    {f}
                  </div>
                ))}
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 40 }}>
        <div className="grid2" style={{ gap: 28, alignItems: "start" }}>
          <Reveal className="card">
            <div className="card-head">
              <h3>The math</h3>
            </div>
            <p className="muted small" style={{ marginBottom: 18 }}>
              Health factor rises with the BTC price and falls with debt, so every threshold is a simple ratio. The site's planner and dashboard use these, assuming only the price moves.
            </p>
            <div className="stack" style={{ gap: 14 }}>
              {MATH.map((m) => (
                <div key={m.label}>
                  <span className="small muted">{m.label}</span>
                  <div className="formula" style={{ marginTop: 6 }}>
                    {m.formula}
                  </div>
                </div>
              ))}
            </div>
            <p className="note" style={{ marginTop: 18 }}>
              The live rescue lifted the demo loan from HF 1.236 to 1.800 by repaying 1.253229 USDC, exactly what <code>preview</code> had said it would (<Ext href={CLAIMS}>claim 8</Ext>).{" "}
              <Explorer path={`tx/${RESCUE_TX}`}>See the transaction</Explorer>
            </p>
          </Reveal>
          <Reveal className="card" delay={0.08}>
            <div className="card-head">
              <h3>What the contract guarantees</h3>
            </div>
            <ul className="checks">
              <li>
                <IconCheck /> <span>USDC in the shield leaves only two ways: back to its owner, or as a repayment of the owner's own loan.</span>
              </li>
              <li>
                <IconCheck /> <span>A repayment can happen only while the loan's health factor is below the owner's trigger, and only enough to reach the owner's target.</span>
              </li>
              <li>
                <IconCheck />{" "}
                <span>
                  Health is Morpho's own formula, oracle and rounding, after interest. Below 1.00 here is exactly what Morpho lets a liquidator take (<Ext href={SOURCES.morpho.href}>Morpho liquidation</Ext>).
                </span>
              </li>
              <li>
                <IconCheck /> <span>No owner, no pause, no upgrade path. Its only fixed addresses are Morpho Blue and USDC.</span>
              </li>
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 0 }}>
        <SectionHead eyebrow="Status" title="Built, and still planned.">
          Built means the code exists and a test that runs it passes. Planned means it doesn't exist or hasn't run yet.
        </SectionHead>
        <Reveal className="card">
          <ul className="status-list">
            {rows.map((r) => (
              <li key={r.part}>
                <span>
                  {r.part}
                  <small>{r.detail}</small>
                </span>
                <span className={`pill ${r.tone}`}>{r.status}</span>
              </li>
            ))}
          </ul>
        </Reveal>
      </section>

      <section className="container section" style={{ paddingTop: 0 }}>
        <SectionHead eyebrow="FAQ" title="Questions people ask." />
        <Reveal className="faq">
          {FAQ.map((f) => (
            <details key={f.q}>
              <summary>{f.q}</summary>
              <p>{f.a}</p>
            </details>
          ))}
        </Reveal>
        <div className="btn-row" style={{ marginTop: 32 }}>
          <Link to="/app" className="btn primary">
            Protect my loan <IconArrow />
          </Link>
          <Link to="/demo" className="btn ghost">
            See the live demo loan
          </Link>
        </div>
      </section>
    </>
  );
}
