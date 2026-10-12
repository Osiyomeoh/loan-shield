// Turns Loan Shield on for your loan: deposit standby USDC, then set the trigger and target health factors.
// Signs with PRIVATE_KEY from your .env; SHIELD_ADDRESS is the deployed LoanShield.
//   npm run protect -- <buffer usdc> <trigger> <target> [marketId]          plan only
//   npm run protect -- <buffer usdc> <trigger> <target> [marketId] --yes    send
// A buffer of 0 only updates the policy.
import { erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loanShieldAbi } from "../src/abi.js";
import { publicClient, readPreview, walletClient } from "../src/chain.js";
import { args, formatUsdc, main, ownerKey, shieldAddress, stopUnlessConfirmed, txLink, usage, usdc, wad } from "../src/cli.js";
import { arc, CIRBTC_MARKET, formatWad, parseMarketId, USDC } from "../src/config.js";

main(async () => {
  const { positional, yes } = args();
  if (positional.length < 3) usage("npm run protect -- <buffer usdc> <trigger> <target> [marketId] [--yes]");
  const amount = usdc(positional[0]!, "buffer usdc");
  const trigger = wad(positional[1]!, "trigger");
  const target = wad(positional[2]!, "target");
  const marketId = parseMarketId(positional[3] ?? CIRBTC_MARKET);
  // Same bounds the contract enforces in setPolicy, checked here to fail before sending anything.
  if (trigger <= 10n ** 18n || target <= trigger || target > 10n * 10n ** 18n) {
    throw new Error("need 1 < trigger < target <= 10");
  }

  const shield = shieldAddress();
  const account = privateKeyToAccount(ownerKey());
  const client = publicClient();
  const wallet = walletClient(account);
  const owner = { borrower: account.address, marketId };

  const [balance, buffer, hf] = await Promise.all([
    client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [account.address] }),
    client.readContract({ address: shield, abi: loanShieldAbi, functionName: "buffer", args: [account.address] }),
    client.readContract({ address: shield, abi: loanShieldAbi, functionName: "healthFactor", args: [account.address, marketId] }),
  ]);
  console.log(`Wallet ${account.address}: ${formatUsdc(balance)}; shield buffer ${formatUsdc(buffer)}; loan HF ${formatWad(hf)}`);
  if (amount > 0n) console.log(`1. approve exactly ${formatUsdc(amount)} to ${shield}\n2. deposit ${formatUsdc(amount)}`);
  console.log(`${amount > 0n ? 3 : 1}. setPolicy: rescue below ${formatWad(trigger)}, back up to ${formatWad(target)}`);
  if (hf < trigger) console.log(`   Note: the loan's HF ${formatWad(hf)} is already below this trigger, so anyone can rescue it right after.`);
  if (stopUnlessConfirmed(yes, `npm run protect -- ${positional.slice(0, 4).join(" ")}`)) return;

  const send = async (label: string, request: Parameters<typeof wallet.writeContract>[0]) => {
    const hash = await wallet.writeContract(request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`${label} reverted: ${txLink(hash)}`);
    console.log(`${label}: ${txLink(hash)}`);
  };
  if (amount > 0n) {
    await send("approve", { address: USDC, abi: erc20Abi, functionName: "approve", args: [shield, amount], account, chain: arc });
    await send("deposit", { address: shield, abi: loanShieldAbi, functionName: "deposit", args: [amount], account, chain: arc });
  }
  await send("setPolicy", { address: shield, abi: loanShieldAbi, functionName: "setPolicy", args: [marketId, trigger, target], account, chain: arc });

  const p = await readPreview(client, shield, owner);
  console.log(`Rescue now? ${p.status}` + (p.status === "Ready" ? `: would repay ${formatUsdc(p.repayAssets)}, HF → ${formatWad(p.healthFactorAfter)}` : ""));
});
