// The React site's display helpers (web/src/lib): formatting, and what the dashboard says about a loan.
import assert from "node:assert/strict";
import test from "node:test";
import * as web from "../public/shield.js";
import { compact, dollars, drop, hfText, short, usd, usdc, wadNumber } from "../web/src/lib/format.js";
import { compareRows, coverage, headline, ladder, ltvText, steps, verdict, type LoanState, type MarketState } from "../web/src/lib/view.js";
import { WAD } from "./fakes.js";

const PRICE = 100_000;
const USDC = 1_000_000n;

// The cirBTC / USDC market's shape: 86% LLTV, 6-decimal USDC, 8-decimal cirBTC.
const market: MarketState = {
  totalSupplyAssets: 195_020_000n * USDC,
  totalBorrowAssets: 193_850_000n * USDC,
  totalBorrowShares: 0n,
  lltv: (WAD * 86n) / 100n,
  price: 0n,
  loanDecimals: 6,
  collateralDecimals: 8,
};

// 0.02 cirBTC ($2,000) against 1,000 USDC: LTV 50%, health factor 0.86 × 2,000 / 1,000 = 1.72.
function loan(over: Partial<LoanState> = {}): LoanState {
  return {
    collateral: 2_000_000n,
    debt: 1_000n * USDC,
    healthFactor: (WAD * 172n) / 100n,
    buffer: 300n * USDC,
    trigger: (WAD * 130n) / 100n,
    target: (WAD * 180n) / 100n,
    preview: { status: "NotInDanger", repayAssets: 0n, repayShares: 0n, healthFactorAfter: 0n },
    liquidationPrice: undefined,
    ...over,
  };
}
const outlookOf = (s: LoanState) => web.outlook(s, PRICE)!;

test("format: USDC, dollars and health factors round the way the page promises", () => {
  assert.equal(usdc(1_253_229n), "1.2532 USDC", "small amounts keep 4 decimals");
  assert.equal(usdc(123_456_789n), "123.45 USDC", "from 100 USDC up, 2 decimals, rounded down");
  assert.equal(usd(83_794), "$83,794");
  assert.equal(dollars(4.5), "$4.50");
  assert.equal(dollars(1_234), "$1,234");
  assert.equal(compact(195_020_000n * USDC), "195.02M");
  assert.equal(hfText(1_799_993_800_000_000_000n), "1.79", "never rounds a health factor up");
  assert.equal(hfText(web.MAX_UINT256), "∞");
  assert.equal(wadNumber(web.MAX_UINT256), Infinity);
  assert.equal(wadNumber(WAD + WAD / 2n), 1.5);
  assert.equal(drop(75_000, PRICE), "−25.0%");
  assert.equal(drop(110_000, PRICE), "above today's price");
  assert.equal(short("0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04"), "0x11f8…8b04");
});

test("verdict maps every preview status, and a zero buffer reads as unfunded", () => {
  const v = (status: string, buffer = 1n) => verdict({ preview: { status, repayAssets: 0n, repayShares: 0n, healthFactorAfter: 0n }, buffer });
  assert.equal(v("NotInDanger"), "safe");
  assert.equal(v("NotInDanger", 0n), "unfunded");
  assert.equal(v("Ready"), "due");
  assert.equal(v("EmptyBuffer"), "empty");
  assert.equal(v("NoPolicy"), "none");
  assert.equal(v("NoDebt"), "nodebt");
  assert.equal(v("unknown(9)"), "unknown");
});

test("ladder: a protected loan shows the rescue, bare liquidation and spent-buffer prices, highest first", () => {
  const s = loan();
  const rows = ladder(s, outlookOf(s), PRICE);
  assert.deepEqual(
    rows.map((r) => [r.tone, Math.round(r.price), r.change]),
    [
      ["now", 100_000, ""],
      ["warn", 75_581, "−24.4%"],
      ["dash", 58_140, "−41.9%"],
      ["bad", 40_698, "−59.3%"],
    ],
  );
  assert.match(rows[1]!.why, /300\.00 USDC buffer/);
  assert.match(rows[3]!.why, /700\.00 USDC of debt is left/);
});

test("ladder: no policy shows only liquidation; a buffer larger than the debt removes it", () => {
  const bare = loan({ trigger: 0n, target: 0n });
  assert.deepEqual(
    ladder(bare, outlookOf(bare), PRICE).map((r) => r.what),
    ["BTC now", "Liquidation (health factor 1.00)"],
  );
  const covered = loan({ buffer: 1_500n * USDC });
  const last = ladder(covered, outlookOf(covered), PRICE).at(-1)!;
  assert.equal(last.tone, "good");
  assert.equal(last.price, 0);
});

test("headline: safe gives the fall before the first rescue; due quotes the contract's preview", () => {
  const s = loan();
  const safe = headline(s, outlookOf(s), PRICE, "safe");
  assert.equal(safe.title, "BTC can fall 24.4% before the first rescue");
  assert.match(safe.text, /Below \$75,581/);
  assert.match(safe.text, /liquidatable at \$58,140/);
  assert.match(safe.text, /at \$40,698\.$/);

  const due = loan({ healthFactor: (WAD * 1236n) / 1000n, preview: { status: "Ready", repayAssets: 1_253_229n, repayShares: 0n, healthFactorAfter: (WAD * 18n) / 10n } });
  const h = headline(due, outlookOf(due), PRICE, verdict(due));
  assert.equal(h.title, "A rescue is due now");
  assert.match(h.text, /Health factor 1\.23 is below the trigger 1\.30/);
  assert.match(h.text, /repays 1\.2532 USDC from the buffer and lifts the health factor to 1\.80/);
});

test("coverage: full, partial, and none while a rescue is already due", () => {
  // The first rescue lifts 1.30 to 1.80: 1,000 × 0.5 / 1.8 = 277.777778 USDC, rounded up.
  const s = loan();
  assert.equal(outlookOf(s).needed, 277_777_778n);
  assert.deepEqual(coverage(s, outlookOf(s)), { cover: 1, text: "covers the next rescue (277.77 USDC)" });
  const thin = loan({ buffer: 100n * USDC });
  assert.equal(coverage(thin, outlookOf(thin))?.text, "covers 36% of the next rescue (277.77 USDC)");
  const due = loan({ preview: { status: "Ready", repayAssets: 1n, repayShares: 0n, healthFactorAfter: 0n } });
  assert.equal(coverage(due, outlookOf(due)), undefined);
});

test("steps: a safe loan walks from now, to the first rescue, to the spent buffer", () => {
  const s = loan();
  const items = steps(s, outlookOf(s), PRICE, "safe", market);
  assert.deepEqual(
    items.map((i) => i.tone),
    ["now", "warn", "bad"],
  );
  assert.equal(items[0]!.title, "Now · BTC $100,000");
  assert.match(items[1]!.text, /repays about 277\.77 USDC from your buffer/);
  assert.match(items[1]!.text, /Your 0\.020000 cirBTC is not touched\./);
  assert.equal(items[2]!.title, "If BTC falls to $40,698 (−59.3%)");
});

test("compareRows and ltvText use Morpho's incentive and the market's LLTV", () => {
  const rows = Object.fromEntries(compareRows(loan(), market).map((r) => [r.label, r]));
  assert.equal(rows["Can happen when"]!.us, "Health factor below 1.30");
  assert.equal(rows["Your cirBTC"]!.them, "Taken: worth 1.0438× the debt repaid");
  assert.equal(rows["Extra cost"]!.them, "4.38% bonus: up to $43.84 on this debt");
  assert.equal(compareRows(loan({ trigger: 0n }), market)[0]!.us, "Never (no policy)");
  assert.equal(ltvText(loan(), market, PRICE), "LTV 50.0% of 86% max");
  assert.equal(ltvText(loan({ debt: 0n }), market, PRICE), "no loan");
});
