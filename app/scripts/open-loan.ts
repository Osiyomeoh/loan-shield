// Opens a Borrow Kit loan in the USDC/cirBTC market on Arc. Borrow Kit sizes the cirBTC collateral itself.
// Signs with PRIVATE_KEY from your .env.
//   npm run open-loan -- <usdc to borrow>          quote only
//   npm run open-loan -- <usdc to borrow> --yes    borrow
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2/next";
import { BorrowKit } from "@circle-fin/borrow-kit";
import { args, main, ownerAddress, ownerKey, stopUnlessConfirmed, txLink, usage, usdc } from "../src/cli.js";
import { CIRBTC_MARKET } from "../src/config.js";

main(async () => {
  const { positional, yes } = args();
  if (!positional[0]) usage("npm run open-loan -- <usdc to borrow> [--yes]");
  usdc(positional[0], "usdc to borrow");
  const borrowAmount = positional[0];
  const walletAddress = ownerAddress();
  const kit = new BorrowKit();

  const quote = await kit.getBorrowQuote({ chain: "Arc", marketId: CIRBTC_MARKET, walletAddress, borrowAmount });
  console.log(`Wallet ${walletAddress}: borrow ${quote.loanAssetAmount.amount} ${quote.loanAssetAmount.token}`);
  console.log(`  collateral pulled: ${quote.collateralAmount.amount} ${quote.collateralAmount.token}`);
  console.log(`  resulting health factor ${quote.resultingHealthFactor ?? "–"} (${quote.resultingBand}), LTV ${quote.resultingLtv ?? "–"}`);
  console.log(`  liquidation price ${quote.liquidationPrice?.amount ?? "–"} ${quote.liquidationPrice?.token ?? ""}, APY ${quote.borrowApy ?? "–"}`);
  for (const fee of quote.fees) console.log(`  fee: ${fee.amount.amount} ${fee.amount.token} (${fee.type})`);
  if (stopUnlessConfirmed(yes, `npm run open-loan -- ${borrowAmount}`)) return;

  const adapter = createViemAdapterFromPrivateKey({ privateKey: ownerKey() });
  const result = await kit.borrow({ from: { adapter, chain: "Arc" }, marketId: CIRBTC_MARKET, borrowAmount });
  console.log(`Loan ${result.loanId}: ${result.status}`);
  if (result.status === "confirmed") {
    console.log(`  borrowed ${result.amountBorrowed.amount} ${result.amountBorrowed.token}`);
    console.log(`  ${txLink(result.txHash)}`);
  } else if (result.status === "confirmed-details-unavailable") {
    console.log(`  ${txLink(result.txHash)} (confirmed; receipt details unavailable, do not retry)`);
  } else {
    console.log(`  batch ${result.batchId} submitted; outcome not yet known${result.error ? `: ${result.error.message}` : ""}`);
  }
  console.log("Borrow Kit reports the loan as PENDING until it is indexed; `npm run status` shows it once READY.");
});
