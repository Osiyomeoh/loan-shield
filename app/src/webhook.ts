import { getAddress, isAddress, type Hex } from "viem";
import { checkAndRescue, describe, type ShieldChain } from "./keeper.js";
import type { Position } from "./config.js";

/**
 * Remembers notification ids that were fully handled. Borrow Kit delivers at least once, so the same crossing
 * can arrive twice. Memory only: a serverless platform may run several instances, so a duplicate can still get
 * through. That is safe, because the second check finds the loan already rescued (`NotInDanger`).
 */
export class RecentIds {
  private readonly ids = new Set<string>();
  constructor(private readonly capacity = 1_000) {}

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    this.ids.add(id);
    if (this.ids.size > this.capacity) this.ids.delete(this.ids.values().next().value!);
  }
}

export interface WebhookDeps {
  chain: ShieldChain;
  /** Loans checked on every notification, from this keeper's own configuration (`WATCH`). */
  watch: readonly Position[];
  /**
   * Markets in which the wallet a notification names is also checked (`ALERT_MARKETS`, default the cirBTC market).
   * Empty: only `watch` is checked, whatever the notification says.
   */
  markets: readonly Hex[];
  seen: RecentIds;
  /** False when no keeper key is configured: check and report, but never send. */
  send: boolean;
  /** Skip rescues that would repay less than this, in USDC base units (see `checkAndRescue`). */
  minRepay?: bigint;
  log?: (line: string) => void;
}

export interface WebhookResponse {
  status: number;
  body: { ok: boolean; duplicate?: boolean; error?: string; results?: string[] };
}

/**
 * Fields of a Borrow Kit `morpho.healthBandCrossed` notification. The wallet only chooses which loans get read;
 * nothing in the payload decides whether a rescue is sent.
 */
function describeNotification(payload: Record<string, unknown>): { eventId?: string; wallet?: Position["borrower"]; summary: string } {
  const n = payload.notification;
  if (typeof n !== "object" || n === null) return { summary: `no notification object (fields: ${Object.keys(payload).join(",")})` };
  const { event_id, loan_id, previous_threshold, threshold, walletAddress } = n as Record<string, unknown>;
  const eventId = typeof event_id === "string" && event_id.length > 0 ? event_id : undefined;
  const wallet = typeof walletAddress === "string" && isAddress(walletAddress, { strict: false }) ? getAddress(walletAddress) : undefined;
  const claimed = `claims ${wallet ?? "(no wallet)"}'s loan ${String(loan_id)} went ${String(previous_threshold)} → ${String(threshold)}`;
  return { eventId, wallet, summary: `${String(payload.notificationType)} ${eventId ?? "(no event_id)"}: ${claimed}` };
}

/** `watch`, then the alert wallet in each of `markets`, without repeats. */
function positionsToCheck(deps: WebhookDeps, wallet: Position["borrower"] | undefined): Position[] {
  const positions = [...deps.watch];
  if (wallet) for (const marketId of deps.markets) positions.push({ borrower: wallet, marketId });
  const seen = new Set<string>();
  return positions.filter(({ borrower, marketId }) => {
    const key = `${borrower.toLowerCase()}:${marketId.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Handles a Borrow Kit loan notification. Circle's Borrow Kit README: "A permissionless receiver cannot yet verify
 * that a notification came from Circle, so treat one as a prompt to check the loan, not as its state." So the
 * payload is only a wake-up. The handler reads, on-chain, every loan in its own watch list plus the loan of the
 * wallet the notification names (in each configured market), and rescues only those the contract itself reports
 * as `Ready`. Any wallet can point its Borrow Kit alerts here; the contract only lets a rescue repay a loan from
 * that borrower's own buffer, toward the borrower's own policy. Anyone can POST here too: the most a forged
 * request can do is make the keeper read the chain, or send a rescue the contract says is due anyway.
 *
 * Deduplication follows the same README: on `notification.event_id`, recorded only after the notification was
 * handled without errors, so a failed check is retried on redelivery. The key also holds the wallet, so a forged
 * request reusing a real event_id with another wallet can't mark the real alert as handled.
 */
export async function handleWebhook(rawBody: string, deps: WebhookDeps): Promise<WebhookResponse> {
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { status: 400, body: { ok: false, error: "body is not JSON" } };
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return { status: 400, body: { ok: false, error: "body is not a JSON object" } };
  }

  const { eventId, wallet, summary } = describeNotification(payload as Record<string, unknown>);
  const key = eventId && `${eventId}:${wallet ?? ""}`;
  if (key && deps.seen.has(key)) {
    deps.log?.(`webhook ${eventId}: already handled, ignored`);
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  deps.log?.(`webhook ${summary} (unverified; checking the chain)`);

  const results: string[] = [];
  let failed = false;
  for (const position of positionsToCheck(deps, wallet)) {
    let line: string;
    try {
      line = describe(position, await checkAndRescue(deps.chain, position, { send: deps.send, minRepay: deps.minRepay }));
    } catch (err) {
      failed = true;
      line = `${position.borrower}: check failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    deps.log?.(line);
    results.push(line);
  }

  if (failed) return { status: 502, body: { ok: false, error: "a check failed; redeliver", results } };
  if (key) deps.seen.add(key);
  return { status: 200, body: { ok: true, results } };
}
