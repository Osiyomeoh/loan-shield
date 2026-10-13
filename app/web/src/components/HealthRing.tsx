import { motion } from "motion/react";
import { wadNumber } from "../lib/format";
import { CountUp } from "./CountUp";

const START = 135;
const SWEEP = 270;

function point(cx: number, cy: number, r: number, deg: number) {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
}
function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = point(cx, cy, r, from);
  const [x2, y2] = point(cx, cy, r, to);
  return `M ${x1} ${y1} A ${r} ${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2} ${y2}`;
}
/** Health factors rounded down to 2 decimals, like the rest of the site. */
const hf2 = (n: number) => (Number.isFinite(n) ? (Math.floor(n * 100) / 100).toFixed(2) : "∞");

/**
 * The health factor on a 270° gauge from 0.80 up: red below 1.00 (liquidatable), amber below the trigger
 * (a rescue may run), green above it, with ticks at the trigger and the target.
 */
export function HealthRing({ hf, trigger, target, size = 260 }: { hf: bigint; trigger: bigint; target: bigint; size?: number }) {
  const now = wadNumber(hf);
  const t = trigger === 0n ? undefined : wadNumber(trigger);
  const g = target === 0n ? undefined : wadNumber(target);
  const lo = 0.8;
  const hi = Math.max(2.5, (g ?? 0) * 1.2, Number.isFinite(now) ? now * 1.08 : 0);
  const frac = (v: number) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
  const deg = (v: number) => START + SWEEP * frac(v);
  const c = 100;
  const r = 82;
  const tone = !Number.isFinite(now) ? "good" : now < 1 ? "bad" : t !== undefined && now < t ? "warn" : "good";
  const label = (v: number, text: string, cls: string) => {
    const [x, y] = point(c, c, r + 15, deg(v));
    const [x1, y1] = point(c, c, r - 9, deg(v));
    const [x2, y2] = point(c, c, r + 8, deg(v));
    return (
      <g className={`ring-mark ${cls}`}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} />
        <text x={x} y={y} textAnchor={x < c - 4 ? "end" : x > c + 4 ? "start" : "middle"} dominantBaseline="middle">{text}</text>
      </g>
    );
  };

  return (
    <div className={`ring ring-${tone}`} style={{ width: size, maxWidth: "100%" }}>
      <svg viewBox="-30 -12 260 224" role="img" aria-label={`Health factor ${hf2(now)}. Liquidatable below 1.00${t !== undefined ? `, rescue below ${hf2(t)}, target ${hf2(g ?? 0)}` : ""}.`}>
        <defs>
          <linearGradient id="ringg" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor="var(--tone-a)" />
            <stop offset="1" stopColor="var(--tone-b)" />
          </linearGradient>
          <filter id="ringglow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" />
          </filter>
        </defs>
        <path d={arc(c, c, r, START, START + SWEEP)} className="ring-track" />
        <path d={arc(c, c, r, deg(lo), deg(1))} className="ring-zone bad" />
        {t !== undefined && <path d={arc(c, c, r, deg(1), deg(t))} className="ring-zone warn" />}
        <path d={arc(c, c, r, deg(t ?? 1), START + SWEEP)} className="ring-zone good" />
        <motion.path
          d={arc(c, c, r, START, START + SWEEP)}
          className="ring-glow"
          filter="url(#ringglow)"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: frac(now) }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
        />
        <motion.path
          d={arc(c, c, r, START, START + SWEEP)}
          className="ring-value"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: frac(now) }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
        />
        {label(1, "1.00", "liq")}
        {t !== undefined && label(t, hf2(t), "trig")}
        {g !== undefined && label(g, hf2(g), "targ")}
      </svg>
      <div className="ring-center">
        <span className="ring-caption">Health factor</span>
        <CountUp className="ring-value-text" value={now} format={hf2} />
        <span className="ring-sub">{tone === "bad" ? "liquidatable" : tone === "warn" ? "below trigger" : "healthy"}</span>
      </div>
    </div>
  );
}
