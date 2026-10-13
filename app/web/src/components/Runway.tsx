import { motion } from "motion/react";
import { usd } from "../lib/format";
import type { LadderRow, LoanState, Outlook } from "../lib/view";

/** BTC price from $0 to a little above today: where rescues start, where liquidation is, with and without the shield. */
export function Runway({ s, o, price, rows }: { s: Pick<LoanState, "buffer">; o: Outlook; price: number; rows: LadderRow[] }) {
  const shielded = o.rescuePrice !== undefined && s.buffer > 0n;
  const end = Math.max(price, o.rescuePrice ?? 0) * 1.12;
  const x = (p: number) => Math.max(0, Math.min(100, (p / end) * 100));
  const segs = shielded
    ? [
        { cls: "bad", a: 0, b: o.protectedPrice },
        { cls: "shield", a: o.protectedPrice, b: o.rescuePrice ?? 0 },
        { cls: "good", a: o.rescuePrice ?? 0, b: end },
      ]
    : [
        { cls: "bad", a: 0, b: o.liquidationPrice },
        { cls: "good", a: o.liquidationPrice, b: end },
      ];

  return (
    <div>
      <div className="runway" role="img" aria-label={rows.map((r) => `${r.what}: ${usd(r.price)}`).join("; ")}>
        {segs.map((sg, i) => (
          <motion.div
            key={sg.cls}
            className={`seg ${sg.cls}`}
            style={{ left: `${x(sg.a)}%`, width: `${x(sg.b) - x(sg.a)}%`, originX: 0 }}
            initial={{ scaleX: 0 }}
            whileInView={{ scaleX: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.9, delay: 0.15 * i, ease: [0.22, 1, 0.36, 1] }}
          />
        ))}
        {shielded && <div className="tick" style={{ left: `${x(o.liquidationPrice)}%` }} title="Liquidation without the shield" />}
        <motion.div className="nowdot" style={{ left: `${x(price)}%` }} initial={{ scale: 0 }} whileInView={{ scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.6, type: "spring" }}>
          <span>BTC {usd(price)}</span>
        </motion.div>
      </div>
      <div className="axis">
        <span>$0</span>
        <span>{usd(end)}</span>
      </div>
      <ol className="ladder">
        {rows.map((r, i) => (
          <motion.li key={r.what} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.08 * i }}>
            <span className={`sw ${r.tone}`} />
            <span className="what">
              {r.what}
              <small>{r.why}</small>
            </span>
            <span className="price">
              {r.price === 0 && r.tone === "good" ? "–" : usd(r.price)}
              {r.change && <small>{r.change}</small>}
            </span>
          </motion.li>
        ))}
      </ol>
    </div>
  );
}
