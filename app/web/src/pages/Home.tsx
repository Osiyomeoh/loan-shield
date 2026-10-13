import { motion } from "motion/react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { DEFAULTS, REPO, web } from "../config";
import { CountUp } from "../components/CountUp";
import { HealthRing } from "../components/HealthRing";
import { HeroVisual } from "../components/HeroVisual";
import { IconArrow, IconBolt, IconCheck, IconClose, IconCoins, IconShield, IconWallet } from "../components/Icons";
import { Explorer, Ext } from "../components/Links";
import { LiveChip } from "../components/LiveChip";
import { Marquee } from "../components/Marquee";
import { Photo } from "../components/Photo";
import { Reveal } from "../components/Reveal";
import { SectionHead } from "../components/Section";
import { SplitWords } from "../components/Split";
import { TiltCard } from "../components/TiltCard";
import { compact, hfText, short, usd, usdc } from "../lib/format";
import { useLive } from "../lib/live";
import { useShieldStats } from "../lib/stats";
import { PHOTOS, type Photo as PhotoT } from "../lib/photos";
import { useTitle } from "../lib/useTitle";
import { PILLS, verdict } from "../lib/view";
import { SOURCES } from "../lib/sources";

const Skel = ({ w = "6ch" }: { w?: string }) => <span className="skel" style={{ width: w }} />;
/** A decimal USDC string from /api/stats, shown like the rest of the site: 4 decimals under 100, else 2. */
function usdcAmount(text: string) {
  const v = web.parseUnits(text, 6);
  return web.formatUnits(v, 6, v >= 100_000_000n ? 2 : 4);
}

function Floating({ className, delay, children }: { className: string; delay: number; children: ReactNode }) {
  return (
    <motion.div
      className={`float-card ${className}`}
      initial={{ opacity: 0, y: 24, scale: 0.96 }}
      animate={{ opacity: 1, y: [0, -8, 0], scale: 1 }}
      transition={{ opacity: { delay, duration: 0.6 }, scale: { delay, duration: 0.6 }, y: { delay, duration: 6, repeat: Infinity, ease: "easeInOut" } }}
    >
      {children}
    </motion.div>
  );
}

const HOW = [
  {
    icon: IconCoins,
    title: "Park standby USDC",
    text: "Deposit USDC into your own buffer in the shield. It stays yours: you can withdraw it whenever you like.",
    code: "deposit(amount)",
  },
  {
    icon: IconShield,
    title: "Set a trigger and a target",
    text: "Say when to step in and how far to lift the loan, for example: rescue below health factor 1.30, back up to 1.80.",
    code: "setPolicy(market, trigger, target)",
  },
  {
    icon: IconBolt,
    title: "Anyone can rescue",
    text: "Below your trigger, any keeper can call rescue. It repays just enough of your debt from your buffer to reach the target. Above it, the call reverts.",
    code: "rescue(borrower, market)",
  },
];

const PEOPLE: { photo: PhotoT; tag: string; title: string; text: string }[] = [
  {
    photo: PHOTOS.calm,
    tag: "BTC holders",
    title: "Borrow and keep your BTC",
    text: "Borrow USDC against cirBTC. If the price slides, your own standby USDC repays first, and your collateral stays put.",
  },
  {
    photo: PHOTOS.worried,
    tag: "Busy people",
    title: "No dashboard to babysit",
    text: "Set the policy once. Rescue is permissionless, so any keeper can send it, and a Borrow Kit health alert can wake one up.",
  },
  {
    photo: PHOTOS.team,
    tag: "Teams and treasuries",
    title: "Rules anyone can audit",
    text: "The buffer, the policy and every rescue are on-chain. The contract has no owner, no pause and no upgrade path.",
  },
  {
    photo: PHOTOS.builder,
    tag: "Wallets and builders",
    title: "Add protection to loans",
    text: "One contract covers every USDC market on Arc's Morpho. The reader is one dependency-free JavaScript file.",
  },
];

export default function Home() {
  useTitle("Loan Shield · USDC that rescues your BTC loan on Arc");
  const { market, loan, history } = useLive(DEFAULTS);
  const stats = useShieldStats();
  const price = market ? web.collateralPrice(market) : undefined;
  const bonus = market ? web.liquidationIncentive(market.lltv) - 1 : undefined;
  const lltv = market ? Number(market.lltv) / 1e16 : undefined;
  const utilization = market && market.totalSupplyAssets > 0n ? Number((market.totalBorrowAssets * 10_000n) / market.totalSupplyAssets) / 100 : undefined;
  const last = history?.events.at(-1);
  const first = history?.events[0];
  const pill = loan ? PILLS[verdict(loan)] : undefined;

  const ticker: ReactNode[] = [
    <><span>BTC, market oracle</span><b>{price !== undefined ? usd(price) : <Skel />}</b></>,
    <><span>Max loan-to-value</span><b>{lltv !== undefined ? `${lltv.toFixed(0)}%` : <Skel w="3ch" />}</b></>,
    <><span>Liquidation bonus</span><b>{bonus !== undefined ? `${(bonus * 100).toFixed(2)}%` : <Skel w="4ch" />}</b></>,
    <><span>USDC supplied</span><b>{market ? compact(market.totalSupplyAssets) : <Skel />}</b></>,
    <><span>USDC borrowed</span><b>{market ? compact(market.totalBorrowAssets) : <Skel />}</b></>,
    <><span>Utilization</span><b>{utilization !== undefined ? `${utilization.toFixed(1)}%` : <Skel w="4ch" />}</b></>,
    <><span>Rescues on mainnet</span><b>{history ? history.events.length : <Skel w="2ch" />}</b></>,
    <><span>Contract</span><b>{short(DEFAULTS.shield)}</b></>,
    <><span>Owner, pause, upgrade</span><b>None</b></>,
  ];

  return (
    <>
      <section className="container hero">
        <div className="hero-copy">
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            <LiveChip />
          </motion.div>
          <h1 style={{ marginTop: 24 }}>
            <SplitWords text="Rescue your BTC loan" delay={0.1} /> <SplitWords className="grad" text="with USDC, not your BTC." delay={0.35} />
          </h1>
          <motion.p className="lead" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.7 }}>
            Loan Shield keeps standby USDC beside your Morpho loan on Arc. When the health factor drops below your trigger, anyone can make it repay just enough to reach your target. Your cirBTC stays put, and there is no fee.
          </motion.p>
          <motion.div className="btn-row" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.7 }}>
            <Link to="/app" className="btn primary lg">
              <IconWallet width={18} height={18} /> Protect my loan <IconArrow />
            </Link>
            <Link to="/demo" className="btn ghost lg">
              See the live demo loan
            </Link>
          </motion.div>
          <motion.ul className="trust" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.05, duration: 0.8 }}>
            {["Read live from Arc mainnet", "Reading needs no wallet", "No owner, no pause, no upgrade", "Open source, MIT"].map((t) => (
              <li key={t}>
                <IconCheck /> {t}
              </li>
            ))}
          </motion.ul>
        </div>

        <div className="hero-stage">
          <HeroVisual />
          <Floating className="fc-a" delay={0.9}>
            <div className="fc-label">Demo loan · health factor</div>
            <div className="fc-value">{loan ? hfText(loan.healthFactor) : <Skel w="4ch" />}</div>
            <div className="fc-sub">{loan ? (pill ? <span className={`pill ${pill.tone}`} style={{ marginTop: 6 }}>{pill.label}</span> : null) : <Skel w="10ch" />}</div>
          </Floating>
          <Floating className="fc-c" delay={1.1}>
            <div className="fc-label">Standby buffer</div>
            <div className="fc-value">{loan ? usdc(loan.buffer) : <Skel w="8ch" />}</div>
            <div className="fc-sub">{loan && loan.trigger > 0n ? `rescues below ${hfText(loan.trigger)}, back to ${hfText(loan.target)}` : " "}</div>
          </Floating>
          <Floating className="fc-b" delay={1.3}>
            <div className="fc-label">
              <IconCheck width={14} height={14} style={{ color: "var(--good)" }} /> Last rescue on Arc mainnet
            </div>
            <div className="fc-value">{last ? `Repaid ${usdc(last.assets)}` : history ? "None yet" : <Skel w="10ch" />}</div>
            <div className="fc-sub">{last ? `health factor ${hfText(last.healthFactorBefore)} → ${hfText(last.healthFactorAfter)}` : " "}</div>
          </Floating>
        </div>
      </section>

      <Marquee items={ticker} />

      <section className="section container">
        <div className="split-2">
          <Reveal className="photo-stack">
            <Photo photo={PHOTOS.night} ratio="4 / 5" />
            <motion.div className="card photo-badge" initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.4, duration: 0.7 }}>
              <div className="alert-card">
                <span className="ico">
                  <IconBolt />
                </span>
                <div>
                  <b>Health factor below 1.00</b>
                  <span>Morpho now lets anyone liquidate the loan and take its collateral.</span>
                </div>
              </div>
            </motion.div>
          </Reveal>
          <div>
            <SectionHead eyebrow="The problem" title="Liquidations don't wait for you to wake up." />
            <Reveal delay={0.05}>
              <p className="lead" style={{ marginTop: -28 }}>
                On Morpho, once a loan's health factor falls below 1.00, anyone can liquidate it: repay part of the debt and take collateral worth more than they paid.
                {bonus !== undefined && (
                  <>
                    {" "}On Arc's cirBTC market that bonus is {(bonus * 100).toFixed(2)}%, so every $1,000 of debt a liquidator repays costs you ${(bonus * 1000).toFixed(2)} of BTC on top.
                  </>
                )}{" "}
                <Ext href={SOURCES.morpho.href}>Morpho's liquidation rules</Ext>
              </p>
              <p className="lead">
                The usual fix is a bot that sells your collateral first. That still sells your BTC, and{" "}
                <Ext href={SOURCES.defisaver.href}>DeFi Saver</Ext> adds a 0.3% service fee on top. <Link to="/compare">See the comparison</Link>.
              </p>
            </Reveal>
            <div className="stat-row">
              <Reveal className="stat" delay={0.1}>
                <b>{bonus !== undefined ? <CountUp value={bonus * 100} format={(n) => `${n.toFixed(2)}%`} /> : <Skel />}</b>
                <span>liquidation bonus on this market</span>
              </Reveal>
              <Reveal className="stat" delay={0.18}>
                <b>{bonus !== undefined ? <CountUp value={bonus * 1000} format={(n) => `$${n.toFixed(2)}`} /> : <Skel />}</b>
                <span>of BTC lost per $1,000 repaid</span>
              </Reveal>
              <Reveal className="stat" delay={0.26}>
                <b>$0</b>
                <span>extra cost of a Loan Shield rescue</span>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <SectionHead eyebrow="How it works" title="Three steps. One small contract." center>
          The shield never holds your loan or your collateral. It holds standby USDC, and it can spend it only on your own debt, only when you said so.
        </SectionHead>
        <div className="grid3">
          {HOW.map((h, i) => (
            <Reveal key={h.title} delay={i * 0.1} style={{ height: "100%" }}>
              <TiltCard className="how-card">
                <span className="step-no">0{i + 1}</span>
                <div className="ico-lg">
                  <h.icon />
                </div>
                <h3>{h.title}</h3>
                <p>{h.text}</p>
                <code>{h.code}</code>
              </TiltCard>
            </Reveal>
          ))}
        </div>
        <Reveal className="btn-row" style={{ justifyContent: "center", marginTop: 36 }}>
          <Link to="/how-it-works" className="btn ghost">
            The details and the math <IconArrow />
          </Link>
        </Reveal>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <Reveal>
          <div className="card proof">
            <div>
              <span className="eyebrow">Proof, not a promise</span>
              <h2>A real loan, rescued on Arc mainnet.</h2>
              <div className="hf-jump" style={{ marginTop: 28 }} aria-label={first ? `Health factor ${hfText(first.healthFactorBefore)} to ${hfText(first.healthFactorAfter)}` : undefined}>
                {first ? (
                  <>
                    <span className="from">{hfText(first.healthFactorBefore)}</span>
                    <IconArrow />
                    <CountUp className="to" value={Number(first.healthFactorAfter) / 1e18} format={(n) => (Math.floor(n * 100) / 100).toFixed(2)} duration={1.8} />
                  </>
                ) : history ? (
                  <span className="muted">No rescues yet.</span>
                ) : (
                  <Skel w="8ch" />
                )}
              </div>
              <p className="muted small" style={{ marginTop: 8 }}>Health factor before and after, from the contract's Rescued event.</p>
              {first && (
                <dl>
                  <div>
                    <dt>Repaid from the buffer</dt>
                    <dd>{usdc(first.assets)}</dd>
                  </div>
                  <div>
                    <dt>Block</dt>
                    <dd>
                      <Explorer path={`block/${first.blockNumber}`}>{first.blockNumber.toLocaleString("en-US")}</Explorer>
                    </dd>
                  </div>
                  <div>
                    <dt>Sent by</dt>
                    <dd>
                      <Explorer path={`address/${first.caller}`}>{short(first.caller)}</Explorer>
                    </dd>
                  </div>
                  <div>
                    <dt>Transaction</dt>
                    <dd>
                      <Explorer path={`tx/${first.transactionHash}`}>{short(first.transactionHash)}</Explorer>
                    </dd>
                  </div>
                </dl>
              )}
              <p className="note">
                The keeper paid 178,980 gas for it, about 0.0036 USDC (<Ext href={`${REPO}/blob/main/CLAIMS.md`}>CLAIMS.md</Ext>, claim 7). The borrower's cirBTC was not touched.
              </p>
            </div>
            <div style={{ textAlign: "center" }}>
              {loan ? <HealthRing hf={loan.healthFactor} trigger={loan.trigger} target={loan.target} size={320} /> : <div style={{ aspectRatio: "1", maxWidth: 320, margin: "0 auto" }} className="skel" />}
              <p className="muted small" style={{ marginTop: 6 }}>The same loan right now, read live from Arc.</p>
              <Link to="/demo" className="btn ghost sm" style={{ marginTop: 14 }}>
                Open the live demo <IconArrow />
              </Link>
            </div>
          </div>
        </Reveal>
      </section>

      {stats !== null && (
        <section className="section container" style={{ paddingTop: 0 }}>
          <SectionHead eyebrow="Live on Arc mainnet" title="Every protected loan, counted from the chain.">
            Totals rebuilt from the contract's own events, not from a database. A loan counts as protected while its policy is on and USDC stands behind it.
          </SectionHead>
          <Reveal>
            <dl className="stats four" aria-busy={stats === undefined}>
              <div>
                <dt>Loans protected</dt>
                <dd>{stats ? stats.loansProtected : <Skel w="2ch" />}</dd>
              </div>
              <div>
                <dt>USDC on standby</dt>
                <dd>{stats ? <>{usdcAmount(stats.usdcOnStandby)}<small>USDC</small></> : <Skel />}</dd>
              </div>
              <div>
                <dt>Rescues sent</dt>
                <dd>{stats ? stats.rescues : <Skel w="2ch" />}</dd>
              </div>
              <div>
                <dt>Debt repaid by rescues</dt>
                <dd>{stats ? <>{usdcAmount(stats.repaidByRescues)}<small>USDC</small></> : <Skel />}</dd>
              </div>
            </dl>
            <p className="note">
              {stats ? (
                <>
                  Contract <Explorer path={`address/${stats.shield}`}>{short(stats.shield)}</Explorer>, up to block{" "}
                  <Explorer path={`block/${stats.block}`}>{stats.block.toLocaleString("en-US")}</Explorer>. Refreshed every 2 minutes.
                </>
              ) : (
                "Reading the contract's events…"
              )}
            </p>
          </Reveal>
        </section>
      )}

      <section className="section container" style={{ paddingTop: 0 }}>
        <SectionHead eyebrow="Who it's for" title="For anyone who borrows against BTC and has a life.">
          Illustrative use cases. The photos are Unsplash stock images, not Loan Shield users.
        </SectionHead>
        <div className="people">
          {PEOPLE.map((p, i) => (
            <Reveal key={p.tag} delay={i * 0.08}>
              <motion.article className="person" whileHover={{ y: -6 }} transition={{ type: "spring", stiffness: 300, damping: 24 }}>
                <Photo photo={p.photo} ratio="3 / 4" sizes="(max-width: 560px) 100vw, (max-width: 1080px) 50vw, 25vw" />
                <div className="person-body">
                  <span className="tag">{p.tag}</span>
                  <h3>{p.title}</h3>
                  <p>{p.text}</p>
                </div>
              </motion.article>
            </Reveal>
          ))}
        </div>
      </section>

      <section className="section container" style={{ paddingTop: 0 }}>
        <SectionHead eyebrow="Compared" title="Other tools protect a loan by selling your collateral." />
        <Reveal className="table-wrap">
          <table className="compare">
            <thead>
              <tr>
                <th scope="col"></th>
                <th scope="col" className="us">Loan Shield</th>
                <th scope="col">DeFi Saver<sup className="ref">1</sup></th>
                <th scope="col">Summer.fi<sup className="ref">2</sup></th>
                <th scope="col">No protection<sup className="ref">3</sup></th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Pays the debt with</th>
                <td className="us"><span className="yes"><IconCheck />Your standby USDC</span></td>
                <td><span className="no"><IconClose />Your collateral, sold</span></td>
                <td><span className="no"><IconClose />Your collateral, sold</span></td>
                <td><span className="no"><IconClose />Seized by a liquidator</span></td>
              </tr>
              <tr>
                <th scope="row">Your BTC</th>
                <td className="us"><span className="yes"><IconCheck />Not touched</span></td>
                <td>Sold</td>
                <td>Sold</td>
                <td>Taken, plus a bonus</td>
              </tr>
              <tr>
                <th scope="row">Extra cost</th>
                <td className="us"><span className="yes"><IconCheck />None (caller pays gas)</span></td>
                <td>0.3% service fee + gas</td>
                <td className="muted">Not in the cited pages</td>
                <td>{bonus !== undefined ? `${(bonus * 100).toFixed(2)}% bonus` : "Bonus"}</td>
              </tr>
            </tbody>
          </table>
        </Reveal>
        <Reveal className="btn-row" style={{ justifyContent: "space-between", alignItems: "center", marginTop: 18 }}>
          <ol className="sources" style={{ margin: 0 }}>
            <li>
              1. <Ext href={SOURCES.defisaver.href}>{SOURCES.defisaver.label}</Ext> · 2. <Ext href={SOURCES.summerCompare.href}>{SOURCES.summerCompare.label}</Ext> · 3. <Ext href={SOURCES.morpho.href}>{SOURCES.morpho.label}</Ext>
            </li>
          </ol>
          <Link to="/compare" className="btn ghost sm">
            Full comparison <IconArrow />
          </Link>
        </Reveal>
      </section>

      <section className="container">
        <Reveal>
          <div className="cta-band">
            <span className="eyebrow">Nothing to install</span>
            <h2>Protect your loan, or watch ours, block by block.</h2>
            <p className="lead">Every number comes straight from Arc mainnet into your browser. Reading needs no wallet. To protect your own loan, connect it: your wallet shows and signs every step.</p>
            <div className="btn-row">
              <Link to="/app" className="btn primary lg">
                <IconWallet width={18} height={18} /> Protect my loan <IconArrow />
              </Link>
              <Link to="/demo" className="btn ghost lg">
                See the live demo loan
              </Link>
            </div>
          </div>
        </Reveal>
      </section>
    </>
  );
}
