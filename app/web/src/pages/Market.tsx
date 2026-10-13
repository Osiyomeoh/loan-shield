import { useMemo, useState, type CSSProperties } from "react";
import { Link } from "react-router";
import { DEFAULTS, web } from "../config";
import { CountUp } from "../components/CountUp";
import { IconArrow } from "../components/Icons";
import { Explorer, Ext } from "../components/Links";
import { Reveal } from "../components/Reveal";
import { Runway } from "../components/Runway";
import { PageHero, SectionHead } from "../components/Section";
import { compact, short, usd } from "../lib/format";
import { useLive } from "../lib/live";
import { SOURCES } from "../lib/sources";
import { useTitle } from "../lib/useTitle";
import { ladder } from "../lib/view";

const ORACLE = "0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab";
const DEBTS = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000];
const toWad = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 12n;

function Slider({ label, value, min, max, step, onChange, show, hint }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; show: string; hint?: string }) {
  return (
    <label className="control">
      <span className="control-top">
        {label}
        <output>{show}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ "--fill": `${max > min ? ((value - min) / (max - min)) * 100 : 0}%` } as CSSProperties} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Planner({ price, lltv }: { price: number; lltv: number }) {
  const [debtIdx, setDebtIdx] = useState(2);
  const [ltv, setLtv] = useState(50);
  const [bufferPct, setBufferPct] = useState(30);
  const [trigger, setTrigger] = useState(1.3);
  const [target, setTarget] = useState(1.8);
  const debtUsd = DEBTS[debtIdx] ?? 1_000;
  const maxLtv = Math.floor(lltv * 100) - 1;

  const plan = useMemo(() => {
    const debt = BigInt(debtUsd) * 1_000_000n;
    const buffer = (debt * BigInt(bufferPct)) / 100n;
    const healthFactor = toWad(lltv / (ltv / 100));
    const t = toWad(trigger);
    const g = toWad(Math.max(target, trigger + 0.05));
    const o = web.outlook({ debt, buffer, healthFactor, trigger: t, target: g }, price);
    return o && { o, s: { debt, buffer, trigger: t }, hf: lltv / (ltv / 100) };
  }, [debtUsd, ltv, bufferPct, trigger, target, lltv, price]);

  const lif = 1 / (1 - 0.3 * (1 - lltv));
  const bonusOnDebt = debtUsd * (Math.min(1.15, lif) - 1);
  if (!plan) return null;
  const { o, s, hf } = plan;
  const dropTo = (p: number) => Math.max(0, (1 - p / price) * 100);
  const due = hf < trigger;

  return (
    <div className="planner">
      <div className="card">
        <Slider label="Debt" value={debtIdx} min={0} max={DEBTS.length - 1} step={1} onChange={setDebtIdx} show={usd(debtUsd)} />
        <Slider label="Loan-to-value" value={ltv} min={10} max={maxLtv} step={1} onChange={setLtv} show={`${ltv}%`} hint={`Health factor ${hf.toFixed(2)}. This market liquidates at ${(lltv * 100).toFixed(0)}%.`} />
        <Slider label="Standby buffer" value={bufferPct} min={0} max={100} step={5} onChange={setBufferPct} show={`${bufferPct}% of debt`} hint={`${usd((debtUsd * bufferPct) / 100)} of USDC set aside`} />
        <Slider label="Trigger" value={trigger} min={1.05} max={2.5} step={0.05} onChange={(n) => { setTrigger(n); if (target < n + 0.05) setTarget(Math.round((n + 0.05) * 100) / 100); }} show={trigger.toFixed(2)} hint="Rescues are allowed below this health factor" />
        <Slider label="Target" value={target} min={Math.round((trigger + 0.05) * 100) / 100} max={3} step={0.05} onChange={setTarget} show={target.toFixed(2)} hint="Each rescue lifts the health factor back to this" />
      </div>
      <div className="card">
        <div className="grid2" style={{ gap: 24 }}>
          <div>
            <span className="small muted">BTC can fall, without the shield</span>
            <div className="big-out">
              <CountUp value={dropTo(o.liquidationPrice)} format={(n) => `${n.toFixed(1)}%`} duration={0.6} />
            </div>
            <span className="small muted">to {usd(o.liquidationPrice)}</span>
          </div>
          <div>
            <span className="small muted">with the shield, before liquidation</span>
            <div className="big-out grad">
              <CountUp value={dropTo(o.protectedPrice)} format={(n) => `${n.toFixed(1)}%`} duration={0.6} />
            </div>
            <span className="small muted">{o.protectedPrice === 0 ? "the buffer covers the whole debt" : `to ${usd(o.protectedPrice)}`}</span>
          </div>
        </div>
        {due && <p className="result warn">At this loan-to-value the health factor is already below the trigger, so a rescue would be due right away.</p>}
        <Runway s={s} o={o} price={price} rows={ladder(s, o, price)} />
        <p className="note">
          A liquidator repaying all {usd(debtUsd)} of this debt would take {usd(debtUsd + bonusOnDebt)} of BTC: {usd(bonusOnDebt)} more than the debt. Computed with Loan Shield's <code>outlook</code> and Morpho's incentive formula at today's oracle price. Assumes only the price moves: no interest, and each rescue lands before a liquidator.
        </p>
      </div>
    </div>
  );
}

export default function Market() {
  useTitle("Market");
  const { market, block } = useLive(DEFAULTS);
  const price = market ? web.collateralPrice(market) : undefined;
  const lltv = market ? Number(market.lltv) / 1e18 : undefined;
  const bonus = market ? web.liquidationIncentive(market.lltv) - 1 : undefined;
  const util = market && market.totalSupplyAssets > 0n ? Number((market.totalBorrowAssets * 10_000n) / market.totalSupplyAssets) / 100 : undefined;
  const skel = <span className="skel" style={{ width: "5ch" }} />;

  return (
    <>
      <PageHero
        eyebrow="Market"
        title={
          <>
            The cirBTC / USDC market, <span className="grad">live.</span>
          </>
        }
        aside={<p className="muted">{block !== undefined ? `Read from Arc mainnet at block ${block.toLocaleString("en-US")}. Refreshes every 20 seconds.` : "Reading from Arc mainnet…"}</p>}
      >
        Borrow Kit lends USDC against cirBTC from this Morpho Blue market on Arc. These figures come straight from Morpho and the market's oracle.
      </PageHero>

      <section className="container section tight" style={{ paddingTop: 8 }}>
        <Reveal>
          <dl className="stats">
            <div>
              <dt>BTC price (market oracle)</dt>
              <dd>{price !== undefined ? <CountUp value={price} format={(n) => usd(n)} /> : skel}</dd>
            </div>
            <div>
              <dt>Liquidation threshold (LLTV)</dt>
              <dd>{lltv !== undefined ? `${(lltv * 100).toFixed(0)}%` : skel}</dd>
            </div>
            <div>
              <dt>Liquidation bonus</dt>
              <dd>{bonus !== undefined ? <CountUp value={bonus * 100} format={(n) => `${n.toFixed(2)}%`} /> : skel}</dd>
            </div>
            <div>
              <dt>Supplied</dt>
              <dd>{market ? <>{compact(market.totalSupplyAssets)}<small>USDC</small></> : skel}</dd>
            </div>
            <div>
              <dt>Borrowed</dt>
              <dd>{market ? <>{compact(market.totalBorrowAssets)}<small>USDC</small></> : skel}</dd>
            </div>
            <div>
              <dt>Utilization</dt>
              <dd>{util !== undefined ? <CountUp value={util} format={(n) => `${n.toFixed(1)}%`} /> : skel}</dd>
            </div>
          </dl>
        </Reveal>
        {bonus !== undefined && (
          <Reveal>
            <p className="note">
              When a loan here is liquidated, Morpho pays the liquidator a {(bonus * 100).toFixed(2)}% bonus in the borrower's collateral: ${(bonus * 1000).toFixed(2)} for every $1,000 of debt repaid. A rescue repays the same debt from the borrower's own standby USDC and costs nothing extra.{" "}
              <Ext href={SOURCES.morpho.href}>Morpho's liquidation rules</Ext>
            </p>
          </Reveal>
        )}
      </section>

      <section className="container section" style={{ paddingTop: 40 }}>
        <SectionHead eyebrow="Plan a loan" title="How far can BTC fall before you lose it?">
          Move the sliders to see where rescues start and where liquidation sits, with and without a buffer, at today's BTC price. Nothing here is sent anywhere.
        </SectionHead>
        {price !== undefined && lltv !== undefined ? <Planner price={price} lltv={lltv} /> : <div className="card skel" style={{ height: 420, display: "block" }} />}
      </section>

      <section className="container section tight" style={{ paddingTop: 0 }}>
        <Reveal className="card">
          <div className="card-head">
            <h3>Contracts</h3>
            <Link to="/developers" className="link small">
              All addresses
            </Link>
          </div>
          <div className="addr-list">
            <div className="addr">
              <span className="k">Morpho Blue</span>
              <span className="v">
                <Explorer path={`address/${web.MORPHO}`}>{web.MORPHO}</Explorer>
              </span>
              <span />
            </div>
            <div className="addr">
              <span className="k">Market id</span>
              <span className="v">{web.CIRBTC_MARKET}</span>
              <span />
            </div>
            <div className="addr">
              <span className="k">Oracle</span>
              <span className="v">
                <Explorer path={`address/${ORACLE}`}>{short(ORACLE)}</Explorer>
              </span>
              <span />
            </div>
          </div>
          <div className="btn-row" style={{ marginTop: 22 }}>
            <Link to="/app" className="btn primary sm">
              See a protected loan in this market <IconArrow />
            </Link>
          </div>
        </Reveal>
      </section>
    </>
  );
}
