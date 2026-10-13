import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import { arc } from "viem/chains";

export { arc };

// Arc mainnet (chain 5042). Same addresses as test/fork/ArcFork.sol; see README "Addresses".
export const MORPHO: Address = "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD";
export const USDC: Address = "0x3600000000000000000000000000000000000000";
export const CIRBTC: Address = "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0";
/** The USDC/cirBTC Morpho market (LLTV 0.86) that Borrow Kit lends from. */
export const CIRBTC_MARKET: Hex = "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d";
/** USDC's ERC-20 interface on Arc uses 6 decimals; native gas balances use 18. */
export const USDC_DECIMALS = 6;
export const EXPLORER = "https://explorer.arc.io";
/** The LoanShield deployment on Arc mainnet (README "Addresses"); event scans start at its block. */
export const SHIELD_DEPLOYMENT = { address: "0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04" as Address, block: 25_712_043n };
/**
 * The hosted keeper (webhook and sweep) skips rescues repaying under 0.01 USDC. It pays the gas for loans it doesn't
 * own: the mainnet rescue cost it 178,980 gas, 0.0036 USDC at 20 gwei (README, "Live on Arc mainnet").
 */
export const HOSTED_MIN_REPAY = 10_000n;

export const STATUS = ["Ready", "NoPolicy", "NoDebt", "NotInDanger", "EmptyBuffer"] as const;
export type Status = (typeof STATUS)[number];

/** A loan to protect: a borrower's position in one Morpho market. */
export interface Position {
  borrower: Address;
  marketId: Hex;
}

export function rpcUrl(env: NodeJS.ProcessEnv = process.env): string {
  return env.ARC_RPC_URL || arc.rpcUrls.default.http[0];
}

export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

export function parseAddress(value: string, what: string): Address {
  if (!isAddress(value, { strict: false })) throw new Error(`${what} is not an address: ${value}`);
  return getAddress(value);
}

export function parseMarketId(value: string, what = "market id"): Hex {
  if (!isHex(value) || value.length !== 66) throw new Error(`${what} is not a 32-byte hex id: ${value}`);
  return value.toLowerCase() as Hex;
}

export function parsePrivateKey(value: string, what: string): Hex {
  const key = value.startsWith("0x") ? value : `0x${value}`;
  if (!isHex(key) || key.length !== 66) throw new Error(`${what} is not a 32-byte private key`);
  return key as Hex;
}

/** Parses `WATCH`, a comma-separated list of `borrower:marketId` pairs. Duplicates are dropped. */
export function parseWatchList(value: string): Position[] {
  const seen = new Set<string>();
  const positions: Position[] = [];
  for (const entry of value.split(",").map((s) => s.trim()).filter(Boolean)) {
    const parts = entry.split(":");
    if (parts.length !== 2) throw new Error(`WATCH entry must be borrower:marketId, got: ${entry}`);
    const position = {
      borrower: parseAddress(parts[0]!, "WATCH borrower"),
      marketId: parseMarketId(parts[1]!, "WATCH market id"),
    };
    const key = `${position.borrower}:${position.marketId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    positions.push(position);
  }
  return positions;
}

/** Parses a comma-separated list of market ids. Unset or empty means the cirBTC market; "none" means no markets. */
export function parseMarketList(value: string | undefined): Hex[] {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return [CIRBTC_MARKET];
  if (trimmed.toLowerCase() === "none") return [];
  return [...new Set(trimmed.split(",").map((s) => s.trim()).filter(Boolean).map((id) => parseMarketId(id)))];
}

/** Formats a WAD (1e18) health factor, e.g. 1376000000000000000n → "1.3760". */
export function formatWad(value: bigint, digits = 4): string {
  if (value === 2n ** 256n - 1n) return "∞";
  const scaled = (value * 10n ** BigInt(digits)) / 10n ** 18n;
  const s = scaled.toString().padStart(digits + 1, "0");
  return `${s.slice(0, -digits)}.${s.slice(-digits)}`;
}
