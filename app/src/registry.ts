import { decodeEventLog, getAddress, type Address, type Hex, type Log, type PublicClient } from "viem";
import { loanShieldAbi } from "./abi.js";
import { SHIELD_DEPLOYMENT, type Position } from "./config.js";

/** The public Arc RPC answers `eth_getLogs` for at most 10,000 blocks per call. */
export const MAX_LOG_RANGE = 10_000n;

interface At {
  blockNumber: bigint;
  logIndex: number;
  transactionHash: Hex;
}

/** A decoded LoanShield event, in the contract's own field names. */
export type ShieldEvent = At &
  (
    | { name: "Deposited"; owner: Address; amount: bigint }
    | { name: "Withdrawn"; owner: Address; amount: bigint }
    | { name: "PolicySet"; owner: Address; id: Hex; trigger: bigint; target: bigint }
    | { name: "PolicyCleared"; owner: Address; id: Hex }
    | {
        name: "Rescued";
        borrower: Address;
        id: Hex;
        caller: Address;
        assets: bigint;
        shares: bigint;
        healthFactorBefore: bigint;
        healthFactorAfter: bigint;
      }
  );

/** Raw logs emitted by the shield in an inclusive block range. */
export type GetLogs = (range: { fromBlock: bigint; toBlock: bigint }) => Promise<Log[]>;

export function shieldLogs(client: PublicClient, shield: Address): GetLogs {
  return (range) => client.getLogs({ address: shield, ...range });
}

/** Splits `[from, to]` into inclusive ranges of at most `size` blocks. */
export function blockRanges(from: bigint, to: bigint, size = MAX_LOG_RANGE): { fromBlock: bigint; toBlock: bigint }[] {
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let start = from; start <= to; start += size) {
    ranges.push({ fromBlock: start, toBlock: start + size - 1n < to ? start + size - 1n : to });
  }
  return ranges;
}

/** Decodes one shield log; anything that isn't a LoanShield event is dropped. */
export function decodeShieldLog(log: Log): ShieldEvent | undefined {
  if (log.blockNumber === null || log.logIndex === null || log.transactionHash === null) return undefined;
  const at: At = { blockNumber: log.blockNumber, logIndex: log.logIndex, transactionHash: log.transactionHash };
  let decoded;
  try {
    decoded = decodeEventLog({ abi: loanShieldAbi, data: log.data, topics: log.topics });
  } catch {
    return undefined;
  }
  switch (decoded.eventName) {
    case "Deposited":
    case "Withdrawn":
      return { ...at, name: decoded.eventName, owner: getAddress(decoded.args.owner), amount: decoded.args.amount };
    case "PolicySet":
      return { ...at, name: "PolicySet", owner: getAddress(decoded.args.owner), id: decoded.args.id, trigger: decoded.args.trigger, target: decoded.args.target };
    case "PolicyCleared":
      return { ...at, name: "PolicyCleared", owner: getAddress(decoded.args.owner), id: decoded.args.id };
    case "Rescued":
      return { ...at, name: "Rescued", ...decoded.args, borrower: getAddress(decoded.args.borrower), caller: getAddress(decoded.args.caller) };
    default:
      return undefined;
  }
}

/**
 * Every LoanShield event in `[from, to]`, oldest first. Ranges are fetched a few at a time so a long history doesn't
 * trip the public RPC's rate limit (viem's HTTP transport retries 429s).
 */
export async function scanShieldEvents(getLogs: GetLogs, from: bigint, to: bigint, concurrency = 4): Promise<ShieldEvent[]> {
  const ranges = blockRanges(from, to);
  const events: ShieldEvent[] = [];
  for (let i = 0; i < ranges.length; i += concurrency) {
    const batch = await Promise.all(ranges.slice(i, i + concurrency).map(getLogs));
    for (const log of batch.flat()) {
      const event = decodeShieldLog(log);
      if (event) events.push(event);
    }
  }
  return events.sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
}

const policyKey = (owner: string, id: string) => `${owner.toLowerCase()}:${id.toLowerCase()}`;

/**
 * Loans with a policy in force: the latest `PolicySet` per (owner, market) not followed by a `PolicyCleared`.
 * Applies `events` (oldest first) to `book` and returns it, so a saved book can be brought up to date.
 */
export function applyPolicyEvents(events: readonly ShieldEvent[], book = new Map<string, Position>()): Map<string, Position> {
  for (const e of events) {
    if (e.name === "PolicySet") book.set(policyKey(e.owner, e.id), { borrower: e.owner, marketId: e.id });
    else if (e.name === "PolicyCleared") book.delete(policyKey(e.owner, e.id));
  }
  return book;
}

export interface ShieldStats {
  /** Loans with a policy in force whose owner has USDC in the shield. */
  loansProtected: number;
  /** Loans with a policy in force, with or without USDC behind them. */
  policies: number;
  /** USDC held for borrowers: deposits, less withdrawals and rescue repayments (6 decimals). */
  usdcOnStandby: bigint;
  rescues: number;
  /** USDC the shield has repaid to Morpho in rescues (6 decimals). */
  repaidByRescues: bigint;
}

/**
 * Totals from the shield's full event history. A rescue takes exactly its `assets` from the borrower's buffer
 * (`rescue` reverts with `UnexpectedRepay` otherwise), so the buffers can be rebuilt from events alone.
 */
export function summarize(events: readonly ShieldEvent[]): ShieldStats {
  const buffers = new Map<string, bigint>();
  const add = (owner: string, delta: bigint) => buffers.set(owner.toLowerCase(), (buffers.get(owner.toLowerCase()) ?? 0n) + delta);
  let rescues = 0;
  let repaidByRescues = 0n;
  for (const e of events) {
    if (e.name === "Deposited") add(e.owner, e.amount);
    else if (e.name === "Withdrawn") add(e.owner, -e.amount);
    else if (e.name === "Rescued") {
      add(e.borrower, -e.assets);
      rescues += 1;
      repaidByRescues += e.assets;
    }
  }
  const active = [...applyPolicyEvents(events).values()];
  return {
    loansProtected: active.filter((p) => (buffers.get(p.borrower.toLowerCase()) ?? 0n) > 0n).length,
    policies: active.length,
    usdcOnStandby: [...buffers.values()].reduce((sum, b) => sum + b, 0n),
    rescues,
    repaidByRescues,
  };
}

/**
 * The block to start scanning `shield`'s events from: the known deployment block for the mainnet shield, otherwise
 * the first block with code at the address (binary search, as on a local fork with a freshly deployed shield).
 */
export async function firstBlock(client: Pick<PublicClient, "getCode">, shield: Address, latest: bigint): Promise<bigint> {
  if (shield.toLowerCase() === SHIELD_DEPLOYMENT.address.toLowerCase()) return SHIELD_DEPLOYMENT.block;
  const hasCode = async (blockNumber: bigint) => ((await client.getCode({ address: shield, blockNumber })) ?? "0x") !== "0x";
  if (!(await hasCode(latest))) throw new Error(`no contract at ${shield}`);
  let low = 0n;
  let high = latest;
  while (low < high) {
    const mid = (low + high) / 2n;
    if (await hasCode(mid)) high = mid;
    else low = mid + 1n;
  }
  return low;
}
