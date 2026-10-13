import type { ReactNode } from "react";
import { Link } from "react-router";
import { DEFAULTS, REPO, web } from "../config";
import { IconArrow, IconCheck, IconClose, IconCoins, IconLock, IconShield } from "../components/Icons";
import { Ext } from "../components/Links";
import { Reveal } from "../components/Reveal";
import { PageHero, SectionHead } from "../components/Section";
import { TiltCard } from "../components/TiltCard";
import { useLive } from "../lib/live";
import { SOURCES } from "../lib/sources";
import { useTitle } from "../lib/useTitle";

type Cell = { text: ReactNode; mark?: "yes" | "no" | "meh"; refs?: number[] };

const Mark = ({ cell }: { cell: Cell }) => {
  const icon = cell.mark === "yes" ? <IconCheck /> : cell.mark === "no" ? <IconClose /> : null;
  return (
    <span className={cell.mark ?? ""}>
      {icon}
      <span>
        {cell.text}
        {cell.refs?.map((r) => (
          <sup key={r} className="ref">
            {r}
          </sup>
        ))}
      </span>
    </span>
  );
};

const REFS = [SOURCES.defisaver, SOURCES.summerCompare, SOURCES.summerBlog, SOURCES.morpho, { href: `${REPO}/blob/main/CLAIMS.md`, label: "Loan Shield CLAIMS.md (claims 6 and 7)" }];

export default function Compare() {
  useTitle("Compare");
  const { market } = useLive(DEFAULTS);
  const bonus = market ? `${((web.liquidationIncentive(market.lltv) - 1) * 100).toFixed(2)}%` : "4.38%";

  const rows: { label: string; cells: [Cell, Cell, Cell, Cell] }[] = [
    {
      label: "How it protects the loan",
      cells: [
        { text: "Repays debt from USDC you set aside", mark: "yes" },
        { text: "Sells collateral to repay debt", refs: [1] },
        { text: "Stop-Loss, Auto-Sell and Trailing Stop-Loss, which sell collateral", refs: [2, 3] },
        { text: "None: a liquidator repays debt and takes collateral", mark: "no", refs: [4] },
      ],
    },
    {
      label: "Your collateral",
      cells: [
        { text: "Not touched", mark: "yes" },
        { text: "Sold", mark: "no", refs: [1] },
        { text: "Sold", mark: "no", refs: [2] },
        { text: `Taken, worth the debt repaid plus a ${bonus} bonus on this market`, mark: "no", refs: [4, 5] },
      ],
    },
    {
      label: "Needs a swap",
      cells: [
        { text: "No: USDC repays USDC debt", mark: "yes" },
        { text: "Yes: collateral into the debt asset", refs: [1] },
        { text: "Yes: through 1inch, with Balancer flash loans", refs: [2, 3] },
        { text: "Up to the liquidator" },
      ],
    },
    {
      label: "Extra cost",
      cells: [
        { text: "None. The caller pays gas: about 0.0036 USDC for the live rescue", mark: "yes", refs: [5] },
        { text: "0.3% service fee plus the transaction fee", refs: [1] },
        { text: "Not stated in the cited pages", mark: "meh" },
        { text: `${bonus} of the repaid debt, paid in your collateral`, mark: "no", refs: [5] },
      ],
    },
    {
      label: "Who can trigger it",
      cells: [
        { text: "Anyone, only while health factor is below your trigger", mark: "yes" },
        { text: "Not stated in the cited pages", mark: "meh" },
        { text: "Not stated in the cited pages", mark: "meh" },
        { text: "Anyone, once health factor is below 1.00", refs: [4] },
      ],
    },
  ];

  return (
    <>
      <PageHero
        eyebrow="Compare"
        title={
          <>
            Protection that doesn't <span className="grad">sell your BTC.</span>
          </>
        }
        aside={
          <p className="muted">
            Every competitor fact links to its source. Where a page didn't say, we say so instead of guessing. Checked on 2026-10-13.
          </p>
        }
      >
        The leading liquidation-protection tools keep a loan alive by selling collateral before a liquidator can. Loan Shield repays with USDC you set aside, so you keep the BTC you borrowed against.
      </PageHero>

      <section className="container section tight" style={{ paddingTop: 12 }}>
        <Reveal className="table-wrap">
          <table className="compare full">
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col" className="us">Loan Shield</th>
                <th scope="col">DeFi Saver liquidation protection</th>
                <th scope="col">Summer.fi automations</th>
                <th scope="col">No protection (Morpho liquidation)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  {r.cells.map((c, i) => (
                    <td key={i} className={i === 0 ? "us" : ""}>
                      <Mark cell={c} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </Reveal>
        <Reveal>
          <ol className="sources">
            {REFS.map((s, i) => (
              <li key={s.href}>
                {i + 1}. <Ext href={s.href}>{s.label}</Ext>
              </li>
            ))}
          </ol>
        </Reveal>
      </section>

      <section className="container section" style={{ paddingTop: 40 }}>
        <SectionHead eyebrow="Why it matters" title="Selling collateral fixes the loan and breaks the plan." />
        <div className="grid3">
          {[
            { icon: IconShield, title: "You keep your exposure", text: "You borrowed against BTC because you wanted to keep it. A rescue lowers the debt instead, so the BTC you hold doesn't change." },
            { icon: IconCoins, title: "No swap, no slippage", text: "USDC repays USDC debt directly on Morpho. There's no trade to route, no price impact and no flash loan." },
            { icon: IconLock, title: "Rules, not a service", text: "The contract has no owner, no pause and no upgrade path. It can only spend your buffer on your own debt, below your trigger." },
          ].map((c, i) => (
            <Reveal key={c.title} delay={i * 0.08} style={{ height: "100%" }}>
              <TiltCard className="how-card">
                <div className="ico-lg" style={{ marginTop: 0 }}>
                  <c.icon />
                </div>
                <h3>{c.title}</h3>
                <p>{c.text}</p>
              </TiltCard>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="container section tight" style={{ paddingTop: 0 }}>
        <Reveal className="card">
          <div className="card-head">
            <h3>The trade-off, honestly</h3>
          </div>
          <ul className="checks">
            <li>
              <IconCheck /> <span>A rescue needs USDC in the buffer. If the buffer runs short the rescue is partial, and an empty buffer means <code>EmptyBuffer()</code>. Once it's spent, Morpho's normal liquidation rules apply again.</span>
            </li>
            <li>
              <IconCheck /> <span>Someone has to send the rescue in time. Anyone can, and the repo ships a keeper and a webhook receiver; more independent keepers make a miss less likely.</span>
            </li>
            <li>
              <IconCheck /> <span>USDC parked in the buffer isn't earning anything while it waits. Selling-based tools don't need that capital up front.</span>
            </li>
          </ul>
          <div className="btn-row" style={{ marginTop: 22 }}>
            <Link to="/demo" className="btn primary sm">
              See it on a live loan <IconArrow />
            </Link>
            <Link to="/how-it-works" className="btn ghost sm">
              How it works
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
