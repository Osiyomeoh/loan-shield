// Buys cirBTC with USDC on Arc through Circle's Swap Kit (keyless). Signs with PRIVATE_KEY from your .env.
//   npm run buy-cirbtc -- <usdc amount>          estimate only
//   npm run buy-cirbtc -- <usdc amount> --yes    swap
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2";
import { SwapKit } from "@circle-fin/swap-kit";
import { args, main, ownerAddress, ownerKey, stopUnlessConfirmed, txLink, usage, usdc } from "../src/cli.js";

main(async () => {
  const { positional, yes } = args();
  if (!positional[0]) usage("npm run buy-cirbtc -- <usdc amount> [--yes]");
  usdc(positional[0], "usdc amount"); // validates the format
  const amountIn = positional[0];

  const kit = new SwapKit();
  const adapter = createViemAdapterFromPrivateKey({ privateKey: ownerKey() });
  const params = { from: { adapter, chain: "Arc" as const }, tokenIn: "USDC" as const, tokenOut: "cirBTC" as const, amountIn };

  console.log(`Wallet ${ownerAddress()}: swap ${amountIn} USDC → cirBTC on Arc`);
  const estimate = await kit.estimate(params);
  console.log(`Estimated output: ${estimate.estimatedOutput?.amount} ${estimate.estimatedOutput?.token}`);
  for (const fee of estimate.fees ?? []) console.log(`  fee: ${fee.amount} ${fee.token} (${fee.type})`);
  if (stopUnlessConfirmed(yes, `npm run buy-cirbtc -- ${amountIn}`)) return;

  const result = await kit.swap(params);
  console.log(`Swap ${result.progress.status}: ${result.amountOut ?? "?"} cirBTC received`);
  console.log(txLink(result.txHash));
});
