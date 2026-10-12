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
  /** The loans this keeper protects, from its own configuration (`WATCH`), never from the request. */
  watch: readonly Position[];
  seen: RecentIds;
  /** False when no keeper key is configured: check and report, but never send. */
  send: boolean;
  log?: (line: string) => void;
}

export interface WebhookResponse {
  status: number;
  body: { ok: boolean; duplicate?: boolean; error?: string; results?: string[] };
}

/** Fields of a Borrow Kit `morpho.healthBandCrossed` notification that are logged. None of them decide anything. */
function describeNotification(payload: Record<string, unknown>): { eventId?: string; summary: string } {
  const n = payload.notification;
  if (typeof n !== "object" || n === null) return { summary: `no notification object (fields: ${Object.keys(payload).join(",")})` };
  const { event_id, loan_id, previous_threshold, threshold } = n as Record<string, unknown>;
  const eventId = typeof event_id === "string" && event_id.length > 0 ? event_id : undefined;
  const claimed = `claims loan ${String(loan_id)} went ${String(previous_threshold)} → ${String(threshold)}`;
  return { eventId, summary: `${String(payload.notificationType)} ${eventId ?? "(no event_id)"}: ${claimed}` };
}

/**
 * Handles a Borrow Kit loan notification. Circle's Borrow Kit README: "A permissionless receiver cannot yet verify
 * that a notification came from Circle, so treat one as a prompt to check the loan, not as its state." So the
 * payload is only a wake-up: its contents (wallet, loan, band) never decide anything. The handler re-reads every
 * loan in its own watch list on-chain and rescues only those the contract itself reports as `Ready`. Anyone can
 * POST here; the most a forged request can do is make the keeper read the chain.
 *
 * Deduplication follows the same README: on `notification.event_id`, recorded only after the notification was
 * handled without errors, so a failed check is retried on redelivery.
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

  const { eventId, summary } = describeNotification(payload as Record<string, unknown>);
  if (eventId && deps.seen.has(eventId)) {
    deps.log?.(`webhook ${eventId}: already handled, ignored`);
    return { status: 200, body: { ok: true, duplicate: true } };
  }
  deps.log?.(`webhook ${summary} (unverified; checking the chain)`);

  const results: string[] = [];
  let failed = false;
  for (const position of deps.watch) {
    let line: string;
    try {
      line = describe(position, await checkAndRescue(deps.chain, position, { send: deps.send }));
    } catch (err) {
      failed = true;
      line = `${position.borrower}: check failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    deps.log?.(line);
    results.push(line);
  }

  if (failed) return { status: 502, body: { ok: false, error: "a check failed; redeliver", results } };
  if (eventId) deps.seen.add(eventId);
  return { status: 200, body: { ok: true, results } };
}
