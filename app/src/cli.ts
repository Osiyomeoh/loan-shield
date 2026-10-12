import { formatUnits, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EXPLORER, parseAddress, parsePrivateKey, requireEnv, USDC_DECIMALS } from "./config.js";

/** Positional arguments and flags after `npm run <script> --`. */
export function args(argv = process.argv.slice(2)): { positional: string[]; yes: boolean; flags: Set<string> } {
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  return { positional: argv.filter((a) => !a.startsWith("--")), yes: flags.has("--yes"), flags };
}

/** The wallet that owns the loan, from `PRIVATE_KEY` in your own gitignored `.env`. */
export function ownerKey(): `0x${string}` {
  return parsePrivateKey(requireEnv("PRIVATE_KEY"), "PRIVATE_KEY");
}

export function ownerAddress(): Address {
  return privateKeyToAccount(ownerKey()).address;
}

export function shieldAddress(): Address {
  return parseAddress(requireEnv("SHIELD_ADDRESS"), "SHIELD_ADDRESS");
}

export function usdc(amount: string, what = "amount"): bigint {
  if (!/^\d+(\.\d{1,6})?$/.test(amount)) throw new Error(`${what} must be a USDC amount like 12.5, got: ${amount}`);
  return parseUnits(amount, USDC_DECIMALS);
}

export function formatUsdc(amount: bigint): string {
  return `${formatUnits(amount, USDC_DECIMALS)} USDC`;
}

/** A health factor typed as a decimal ("1.5") to WAD. */
export function wad(value: string, what: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(value)) throw new Error(`${what} must be a number like 1.5, got: ${value}`);
  return parseUnits(value, 18);
}

export const txLink = (hash: string) => `${EXPLORER}/tx/${hash}`;

/** Scripts that sign print what they would do and stop, unless run with --yes. */
export function stopUnlessConfirmed(yes: boolean, rerun: string): boolean {
  if (yes) return false;
  console.log(`\nNothing was sent. To do it, run again with --yes:\n  ${rerun} --yes`);
  return true;
}

export function usage(text: string): never {
  console.error(`usage: ${text}`);
  process.exit(2);
}

export async function main(run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
