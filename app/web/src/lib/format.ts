// Display formatting shared by the pages. Pure functions, unit-tested from app/test/view.test.ts.
import * as web from "../../../public/shield.js";

/** USDC base units (6 decimals): 4 decimals for the small amounts a demo uses, 2 from 100 USDC up. */
export const usdc = (v: bigint) => `${web.formatUnits(v, 6, v >= 100_000_000n ? 2 : 4)} USDC`;
/** Whole dollars: "$83,794". */
export const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
/** A dollar value, with cents while it is small (a demo loan's collateral is worth a few dollars). */
export const dollars = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: n < 1000 ? 2 : 0, maximumFractionDigits: n < 1000 ? 2 : 0 })}`;
/** Market totals in USDC, shortened: "195.02M". */
export const compact = (v: bigint) => (Number(v) / 1e6).toLocaleString("en-US", { notation: "compact", maximumFractionDigits: 2 });
/** A WAD health factor, rounded down (so 1.7999 shows as 1.79, never optimistically as 1.80). */
export const hfText = (v: bigint, digits = 2) => web.formatWad(v, digits);
export const short = (hex: string) => `${hex.slice(0, 6)}…${hex.slice(-4)}`;
/** Fall from today's price to `p`, as "−27.8%"; a price above today's reads "above today's price". */
export const drop = (p: number, now: number) => (p > now ? "above today's price" : `−${((1 - p / now) * 100).toFixed(1)}%`);
/** A WAD as a plain number, for charts. Morpho's "no debt" (uint max) becomes Infinity. */
export const wadNumber = (v: bigint) => (v === web.MAX_UINT256 ? Infinity : Number(v) / 1e18);
