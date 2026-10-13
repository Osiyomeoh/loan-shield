import { formatUnits, type Hash } from "viem";
import { formatWad, USDC_DECIMALS, type Position, type Status } from "./config.js";

/** What `LoanShield.preview(borrower, id)` returns, with the status decoded. */
export interface Preview {
  status: Status;
  healthFactor: bigint;
  trigger: bigint;
  target: bigint;
  repayAssets: bigint;
  repayShares: bigint;
  healthFactorAfter: bigint;
}

/** The chain operations the keeper needs. `src/chain.ts` implements it with viem; tests use a fake. */
export interface ShieldChain {
  preview(position: Position): Promise<Preview>;
  /** Dry-runs `rescue` from the keeper's account; resolves with the revert's error name if it would revert. */
  simulateRescue(position: Position): Promise<{ ok: true } | { ok: false; error: string }>;
  sendRescue(position: Position): Promise<Hash>;
  waitForReceipt(hash: Hash): Promise<{ status: "success" | "reverted" }>;
}

export type Outcome =
  /** The chain says no rescue is due; nothing was sent. */
  | { kind: "skipped"; status: Status; healthFactor: bigint; trigger: bigint }
  /** A rescue was due, but there is no keeper key, so nothing was sent. */
  | { kind: "would-rescue"; preview: Preview }
  /** A rescue was due, but it would repay less than this keeper's `minRepay`; nothing was sent. */
  | { kind: "too-small"; preview: Preview; minRepay: bigint }
  /** Preview said Ready but the dry run reverted (usually another keeper rescued first); nothing was sent. */
  | { kind: "lost-race"; error: string }
  | { kind: "rescued"; hash: Hash; preview: Preview }
  /** The transaction was mined but reverted (state changed between dry run and inclusion). */
  | { kind: "reverted"; hash: Hash };

/**
 * Checks one loan on-chain and calls `rescue` only if the contract itself says a rescue is due.
 * Nothing from outside the chain (a webhook payload, a band, a price feed) can make it send a transaction:
 * the decision is `preview(...).status === "Ready"` read from the chain, then a dry run of `rescue`.
 * The contract enforces the same rules again on-chain, so even a wrong decision here could only waste gas.
 *
 * `minRepay` (USDC base units, 6 decimals) lets a keeper that pays gas for loans it doesn't own skip dust rescues:
 * the hosted keeper checks any loan an alert names or the sweep finds, and a rescue costs it gas however little it
 * repays. Rescue is permissionless, so a skipped loan can still be rescued by its owner or any other keeper.
 */
export async function checkAndRescue(
  chain: ShieldChain,
  position: Position,
  options: { send: boolean; minRepay?: bigint } = { send: true },
): Promise<Outcome> {
  const preview = await chain.preview(position);
  if (preview.status !== "Ready") {
    return { kind: "skipped", status: preview.status, healthFactor: preview.healthFactor, trigger: preview.trigger };
  }
  const minRepay = options.minRepay ?? 0n;
  if (preview.repayAssets < minRepay) return { kind: "too-small", preview, minRepay };
  if (!options.send) return { kind: "would-rescue", preview };

  const dryRun = await chain.simulateRescue(position);
  if (!dryRun.ok) return { kind: "lost-race", error: dryRun.error };

  const hash = await chain.sendRescue(position);
  const receipt = await chain.waitForReceipt(hash);
  return receipt.status === "success" ? { kind: "rescued", hash, preview } : { kind: "reverted", hash };
}

export function describe(position: Position, outcome: Outcome): string {
  const who = `${position.borrower} in ${position.marketId.slice(0, 10)}…`;
  switch (outcome.kind) {
    case "skipped":
      return outcome.status === "NotInDanger"
        ? `${who}: healthy (HF ${formatWad(outcome.healthFactor)} ≥ trigger ${formatWad(outcome.trigger)}), no rescue`
        : `${who}: ${outcome.status}, no rescue`;
    case "would-rescue":
      return `${who}: rescue due (HF ${formatWad(outcome.preview.healthFactor)} → ${formatWad(outcome.preview.healthFactorAfter)}), not sent: no keeper key`;
    case "too-small":
      return `${who}: rescue due but repays ${formatUnits(outcome.preview.repayAssets, USDC_DECIMALS)} USDC, under this keeper's ${formatUnits(outcome.minRepay, USDC_DECIMALS)} USDC minimum, not sent`;
    case "lost-race":
      return `${who}: rescue no longer due (${outcome.error}), not sent`;
    case "rescued":
      return `${who}: rescued, HF ${formatWad(outcome.preview.healthFactor)} → ${formatWad(outcome.preview.healthFactorAfter)}, tx ${outcome.hash}`;
    case "reverted":
      return `${who}: rescue tx reverted on-chain, tx ${outcome.hash}`;
  }
}

