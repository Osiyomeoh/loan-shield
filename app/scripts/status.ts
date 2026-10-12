// Read-only: a loan's state from three sources side by side. No key needed.
//   npm run status -- <borrower> [marketId]
// Reads SHIELD_ADDRESS from .env if present (shield columns are skipped without it).
import { BorrowKit } from "@circle-fin/borrow-kit";
import { erc20Abi, formatUnits, parseAbi } from "viem";
import { loanShieldAbi } from "../src/abi.js";
import { publicClient, readPreview } from "../src/chain.js";
import { args, formatUsdc, main, usage } from "../src/cli.js";
import { CIRBTC, CIRBTC_MARKET, formatWad, MORPHO, parseAddress, parseMarketId, rpcUrl, USDC } from "../src/config.js";

const morphoAbi = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
]);

main(async () => {
  const { positional } = args();
  if (!positional[0]) usage("npm run status -- <borrower> [marketId]");
  const borrower = parseAddress(positional[0], "borrower");
  const marketId = parseMarketId(positional[1] ?? CIRBTC_MARKET);
  const client = publicClient();

  const [[, borrowShares, collateral], usdcBalance, cirbtcBalance, block] = await Promise.all([
    client.readContract({ address: MORPHO, abi: morphoAbi, functionName: "position", args: [marketId, borrower] }),
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [borrower] }),
    client.readContract({ address: CIRBTC, abi: erc20Abi, functionName: "balanceOf", args: [borrower] }),
    client.getBlockNumber(),
  ]);
  console.log(`Block ${block} via ${new URL(rpcUrl()).host}`);
  console.log(`Wallet ${borrower}: ${formatUsdc(usdcBalance)}, ${formatUnits(cirbtcBalance, 8)} cirBTC`);
  console.log(`Morpho position in ${marketId}: ${formatUnits(collateral, 8)} cirBTC collateral, ${borrowShares} borrow shares`);

  const shieldEnv = process.env.SHIELD_ADDRESS?.trim();
  if (shieldEnv) {
    const shield = parseAddress(shieldEnv, "SHIELD_ADDRESS");
    const [buffer, [trigger, target], hf, p] = await Promise.all([
      client.readContract({ address: shield, abi: loanShieldAbi, functionName: "buffer", args: [borrower] }),
      client.readContract({ address: shield, abi: loanShieldAbi, functionName: "policy", args: [borrower, marketId] }),
      client.readContract({ address: shield, abi: loanShieldAbi, functionName: "healthFactor", args: [borrower, marketId] }),
      readPreview(client, shield, { borrower, marketId }),
    ]);
    console.log(`\nLoan Shield ${shield}`);
    console.log(`  health factor (Morpho's formula, interest accrued): ${formatWad(hf)}`);
    console.log(`  buffer: ${formatUsdc(buffer)}`);
    console.log(trigger === 0n ? "  policy: none" : `  policy: rescue below ${formatWad(trigger)}, back up to ${formatWad(target)}`);
    console.log(`  rescue now? ${p.status}` + (p.status === "Ready" ? `: repays ${formatUsdc(p.repayAssets)}, HF → ${formatWad(p.healthFactorAfter)}` : ""));
  } else {
    console.log("\n(SHIELD_ADDRESS not set: skipping Loan Shield reads)");
  }

  try {
    const { loans } = await new BorrowKit().getLoans({ walletAddress: borrower, chain: "Arc" });
    const loan = loans.find((l) => l.marketId.toLowerCase() === marketId);
    console.log(`\nBorrow Kit getLoans: ${loans.length} loan(s) for this wallet`);
    if (loan) {
      console.log(`  loan ${loan.loanId} (${loan.status}, data ${loan.dataStatus})`);
      console.log(`  health factor ${loan.healthFactor ?? "–"} (${loan.healthFactorBand ?? "–"}), liquidation price ${loan.liquidationPrice?.amount ?? "–"} ${loan.liquidationPrice?.token ?? ""}`);
      console.log(`  borrowed ${loan.borrowed?.amount ?? "–"} ${loan.borrowed?.token ?? ""}, collateral ${loan.collateral?.amount ?? "–"} ${loan.collateral?.token ?? ""}`);
    }
  } catch (err) {
    console.log(`\nBorrow Kit getLoans failed: ${err instanceof Error ? err.message : String(err)}`);
  }
});
