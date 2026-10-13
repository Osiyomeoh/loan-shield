// What the dashboard says about a loan, as plain data: its verdict, headline, price ladder, next steps and the
// rescue-vs-liquidation comparison. Pure functions of the chain reads, unit-tested from app/test/view.test.ts.
import * as web from "../../../public/shield.js";
import { drop, hfText, usd, usdc } from "./format.js";

export type MarketState = Awaited<ReturnType<typeof web.readMarket>>;
export type LoanState = Awaited<ReturnType<typeof web.readLoan>>;
export type Outlook = NonNullable<ReturnType<typeof web.outlook>>;
export type Verdict = "safe" | "due" | "empty" | "unfunded" | "none" | "nodebt" | "unknown";
export type Tone = "good" | "warn" | "bad" | "now" | "dash" | "";

/** The page's one-word reading of the contract's preview status. */
export function verdict(s: Pick<LoanState, "preview" | "buffer">): Verdict {
  const status = s.preview.status;
  if (status === "NotInDanger") return s.buffer === 0n ? "unfunded" : "safe";
  const map: Record<string, Verdict> = { Ready: "due", EmptyBuffer: "empty", NoPolicy: "none", NoDebt: "nodebt" };
  return map[status] ?? "unknown";
}

export const PILLS: Record<Verdict, { label: string; tone: Tone }> = {
  safe: { label: "Protected", tone: "good" },
  due: { label: "Rescue due", tone: "warn" },
  empty: { label: "Buffer empty", tone: "bad" },
  unfunded: { label: "Unfunded", tone: "warn" },
  none: { label: "Not protected", tone: "" },
  nodebt: { label: "No debt", tone: "" },
  unknown: { label: "Unknown", tone: "" },
};

/** The dashboard's headline and the sentence under it. */
export function headline(s: LoanState, o: Outlook | undefined, price: number, v: Verdict): { title: string; text: string } {
  const p = s.preview;
  const liq = o ? `${usd(o.liquidationPrice)} (${drop(o.liquidationPrice, price)})` : "";
  switch (v) {
    case "safe": {
      if (!o || o.rescuePrice === undefined) return { title: "Protected", text: "" };
      return {
        title: o.rescuePrice < price ? `BTC can fall ${drop(o.rescuePrice, price).slice(1)} before the first rescue` : "Protected",
        text:
          `Below ${usd(o.rescuePrice)}, anyone can trigger a rescue that repays from the ${usdc(s.buffer)} buffer. ` +
          `Without the shield this loan is liquidatable at ${usd(o.liquidationPrice)}; ` +
          (o.protectedPrice === 0 ? "the buffer can repay the whole debt." : `with the whole buffer used, at ${usd(o.protectedPrice)}.`),
      };
    }
    case "due":
      return {
        title: "A rescue is due now",
        text: `Health factor ${hfText(s.healthFactor)} is below the trigger ${hfText(s.trigger)}. Anyone can send it: it repays ${usdc(p.repayAssets)} from the buffer and lifts the health factor to ${hfText(p.healthFactorAfter)}.`,
      };
    case "empty":
      return {
        title: "In danger, and the buffer is empty",
        text: `Health factor ${hfText(s.healthFactor)} is below the trigger ${hfText(s.trigger)}, but there is no standby USDC to repay with. The owner needs to top it up.${liq ? ` Liquidation at ${liq}.` : ""}`,
      };
    case "unfunded":
      return {
        title: "Policy set, but the buffer is empty",
        text: `${o?.rescuePrice !== undefined ? `A rescue would be allowed below ${usd(o.rescuePrice)}, but there` : "There"} is no USDC to repay with.${liq ? ` Liquidation at ${liq}.` : ""}`,
      };
    case "none":
      return { title: "No shield policy for this loan", text: `The shield will never touch this borrower's buffer for this market.${liq ? ` Liquidation at ${liq}.` : ""}` };
    case "nodebt":
      return { title: "Nothing to protect", text: "This borrower has no debt in this market." };
    default:
      return { title: `Status ${p.status}`, text: "" };
  }
}

export type LadderRow = { tone: Tone; what: string; why: string; price: number; change: string };

/** The BTC prices that matter for this loan, highest first. */
export function ladder(s: Pick<LoanState, "trigger" | "buffer" | "debt">, o: Outlook, price: number): LadderRow[] {
  const shielded = o.rescuePrice !== undefined && s.buffer > 0n;
  const rows: LadderRow[] = [{ tone: "now", what: "BTC now", why: "Morpho market oracle", price, change: "" }];
  if (o.rescuePrice !== undefined) {
    rows.push({
      tone: "warn",
      what: `Rescues start (health factor ${hfText(s.trigger)})`,
      why: s.buffer > 0n ? `Anyone can make the shield repay from the ${usdc(s.buffer)} buffer` : "Allowed, but the buffer is empty",
      price: o.rescuePrice,
      change: drop(o.rescuePrice, price),
    });
  }
  if (shielded) {
    rows.push({ tone: "dash", what: "Liquidation without the shield", why: "Where Morpho could liquidate if nothing repaid", price: o.liquidationPrice, change: drop(o.liquidationPrice, price) });
    rows.push(
      o.protectedPrice === 0
        ? { tone: "good", what: "Liquidation once the buffer is spent", why: "None: the buffer is larger than the debt", price: 0, change: "" }
        : {
            tone: "bad",
            what: "Liquidation once the buffer is spent",
            why: `Once rescues have repaid all ${usdc(s.buffer)}, ${usdc(s.debt - s.buffer)} of debt is left`,
            price: o.protectedPrice,
            change: drop(o.protectedPrice, price),
          },
    );
  } else {
    rows.push({ tone: "bad", what: "Liquidation (health factor 1.00)", why: "Morpho lets a liquidator take collateral below this", price: o.liquidationPrice, change: drop(o.liquidationPrice, price) });
  }
  return rows.sort((a, b) => b.price - a.price);
}

/** How much of the next rescue the buffer covers, or undefined when there is no next rescue to cover. */
export function coverage(s: LoanState, o: Outlook | undefined): { cover: number; text: string } | undefined {
  if (!o || o.rescuePrice === undefined || s.preview.status === "Ready" || o.needed === 0n) return undefined;
  const cover = Math.min(1, Number(s.buffer) / Number(o.needed));
  return {
    cover,
    text: cover >= 1 ? `covers the next rescue (${usdc(o.needed)})` : `covers ${(cover * 100).toFixed(0)}% of the next rescue (${usdc(o.needed)})`,
  };
}

export type Step = { tone: Tone; title: string; text: string };

/** "What happens next", as the price falls from here. */
export function steps(s: LoanState, o: Outlook | undefined, price: number, v: Verdict, m: MarketState): Step[] {
  const keep = `Your ${web.formatUnits(s.collateral, m.collateralDecimals, 6)} cirBTC is not touched.`;
  const fall = (to: number) => `If BTC falls to ${usd(to)} (${drop(to, price)})`;
  const items: Step[] = [];
  if (v === "safe" && o && o.rescuePrice !== undefined) {
    const partial = o.needed > s.buffer;
    items.push({ tone: "now", title: `Now · BTC ${usd(price)}`, text: `Health factor ${hfText(s.healthFactor)} is above the trigger ${hfText(s.trigger)}, so the contract refuses any rescue and the buffer stays put.` });
    items.push({
      tone: "warn",
      title: fall(o.rescuePrice),
      text:
        `Anyone can call rescue. It repays about ${usdc(o.nextRepay)} from your buffer and lifts the health factor to about ${o.nextHealthAfter === undefined ? "–" : hfText(o.nextHealthAfter)}` +
        (partial ? ` (target ${hfText(s.target)}: the buffer is ${usdc(o.needed - s.buffer)} short of a full rescue). ` : `, your target. `) +
        keep,
    });
    items.push(
      o.protectedPrice === 0
        ? { tone: "good", title: "If BTC keeps falling", text: "Further rescues repay from what's left. The buffer can repay the whole debt, so the loan can't be liquidated while rescues keep up." }
        : { tone: "bad", title: fall(o.protectedPrice), text: `The buffer is spent after repeated rescues, and Morpho's rules allow liquidation. Without the shield that point is ${usd(o.liquidationPrice)}.` },
    );
  } else if (v === "due") {
    const p = s.preview;
    items.push({ tone: "warn", title: "Now: rescue due", text: `Health factor ${hfText(s.healthFactor)} is below the trigger ${hfText(s.trigger)}. Any keeper can send the rescue: it repays ${usdc(p.repayAssets)} from the buffer and lifts the health factor to ${hfText(p.healthFactorAfter)}. ${keep}` });
    if (o) {
      items.push(
        o.protectedPrice === 0
          ? { tone: "good", title: "If BTC keeps falling", text: "Further rescues repay from what's left of the buffer, which covers the whole debt." }
          : { tone: "bad", title: fall(o.protectedPrice), text: "The buffer is spent after repeated rescues, and Morpho's rules allow liquidation." },
      );
    }
  } else if (v === "empty" || v === "unfunded") {
    items.push({ tone: v === "empty" ? "bad" : "warn", title: "Now", text: `The policy is set (${hfText(s.trigger)} → ${hfText(s.target)}) but the buffer is empty, so no rescue can repay anything. The owner can top it up at any time.` });
    if (o) items.push({ tone: "bad", title: fall(o.liquidationPrice), text: "Morpho's rules allow liquidation." });
  } else if (v === "none") {
    items.push({ tone: "", title: "No policy", text: "The owner hasn't opted this market in, so rescue reverts with NoPolicy() whoever calls it." });
    if (o) items.push({ tone: "bad", title: fall(o.liquidationPrice), text: "Morpho's rules allow liquidation." });
  } else {
    items.push({ tone: "good", title: "No debt", text: "There is nothing to repay, so rescue reverts with NoDebt()." });
  }
  return items;
}

/** Rescue vs Morpho liquidation, for this loan. */
export function compareRows(s: LoanState, m: MarketState): { label: string; us: string; them: string }[] {
  const lif = web.liquidationIncentive(m.lltv);
  const bonusPct = `${((lif - 1) * 100).toFixed(2)}% bonus`;
  const bonus = (Number(s.debt) / 10 ** m.loanDecimals) * (lif - 1);
  return [
    { label: "Can happen when", us: s.trigger === 0n ? "Never (no policy)" : `Health factor below ${hfText(s.trigger)}`, them: "Health factor below 1.00" },
    { label: "Debt repaid by", us: "Your standby USDC", them: "A liquidator" },
    { label: "Your cirBTC", us: "Not touched", them: `Taken: worth ${lif.toFixed(4)}× the debt repaid` },
    { label: "Extra cost", us: "None. The caller pays the gas", them: s.debt === 0n ? bonusPct : `${bonusPct}: up to $${bonus.toFixed(bonus < 10 ? 4 : 2)} on this debt` },
    { label: "Who can send it", us: "Anyone", them: "Anyone" },
  ];
}

/** Loan-to-value against the market's maximum, e.g. "LTV 47.8% of 86% max". */
export function ltvText(s: LoanState, m: MarketState, price: number): string {
  if (s.debt === 0n) return "no loan";
  const btc = Number(s.collateral) / 10 ** m.collateralDecimals;
  return `LTV ${((Number(s.debt) / 10 ** m.loanDecimals / (btc * price)) * 100).toFixed(1)}% of ${(Number(m.lltv) / 1e16).toFixed(0)}% max`;
}
