import assert from "node:assert/strict";
import { test } from "node:test";
import { handleWebhook, RecentIds, type WebhookDeps } from "../src/webhook.js";
import { ADA, FakeChain, healthy, inDanger, TUNDE } from "./fakes.js";

/** Shaped like the `morpho.healthBandCrossed` example in the Borrow Kit README. */
function notification(fields: { eventId?: string; wallet?: string; threshold?: string } = {}): string {
  return JSON.stringify({
    subscriptionId: "5d0f3b2a-8c41-5e7b-b9d2-3a6e1f4c7b80",
    notificationId: crypto.randomUUID(),
    notificationType: "morpho.healthBandCrossed",
    notification: {
      domain: "26",
      event_id: fields.eventId ?? crypto.randomUUID(),
      loan_id: "11111111-1111-4111-8111-111111111111",
      previous_threshold: "SAFE",
      resourceId: "11111111-1111-4111-8111-111111111111",
      source_block_number: 64491952,
      threshold: fields.threshold ?? "WARN",
      walletAddress: fields.wallet ?? TUNDE.borrower,
    },
    timestamp: "2026-10-12T20:00:53.974328260Z",
    version: 2,
  });
}

function deps(chain: FakeChain, watch = [TUNDE]): WebhookDeps & { lines: string[] } {
  const lines: string[] = [];
  return { chain, watch, seen: new RecentIds(), send: true, log: (l) => lines.push(l), lines };
}

test("claim 9: a forged 'LIQUIDATABLE' notification sends nothing while the chain says healthy", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy });
  const res = await handleWebhook(notification({ threshold: "LIQUIDATABLE" }), deps(chain));
  assert.equal(res.status, 200);
  assert.equal(chain.sent.length, 0);
  assert.match(res.body.results![0]!, /healthy/);
});

test("claim 9: a notification naming another wallet can't redirect the keeper", async () => {
  const stranger = "0x9999999999999999999999999999999999999999";
  // The stranger's loan would be "Ready" if anyone asked, but it isn't on this keeper's watch list.
  const chain = new FakeChain({ [TUNDE.borrower]: healthy, [stranger]: inDanger });
  await handleWebhook(notification({ wallet: stranger, threshold: "LIQUIDATABLE" }), deps(chain));
  assert.equal(chain.sent.length, 0);
});

test("claim 9: garbage, arrays and non-JSON bodies are rejected without touching the chain", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  chain.failPreview = true; // any chain read would throw
  for (const body of ["not json", "[1,2]", "null", "42"]) {
    const res = await handleWebhook(body, deps(chain));
    assert.equal(res.status, 400, body);
  }
  assert.equal(chain.sent.length, 0);
});

test("a real alert for a loan in danger sends exactly one rescue", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  const d = deps(chain);
  const res = await handleWebhook(notification({ threshold: "URGENT" }), d);
  assert.equal(res.status, 200);
  assert.deepEqual(chain.sent, [TUNDE]);
  assert.match(d.lines[0]!, /unverified; checking the chain/);
});

test("an alert checks every watched loan, whatever loan it names", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy, [ADA.borrower]: inDanger });
  await handleWebhook(notification({ wallet: TUNDE.borrower }), deps(chain, [TUNDE, ADA]));
  assert.deepEqual(chain.sent, [ADA]);
});

test("a redelivered event_id is handled once", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  const d = deps(chain);
  const body = notification({ eventId: "2f1c7a9e-5b3d-5e8f-9a64-0c7d3b1e8f25" });
  await handleWebhook(body, d);
  const again = await handleWebhook(body, d);
  assert.equal(again.body.duplicate, true);
  assert.equal(chain.sent.length, 1);
});

test("an event_id is only recorded after a successful check, so a failed one is retried", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  const d = deps(chain);
  const body = notification({ eventId: "retry-me" });
  chain.failPreview = true;
  const failed = await handleWebhook(body, d);
  assert.equal(failed.status, 502, "non-2xx so Circle redelivers");
  chain.failPreview = false;
  const retried = await handleWebhook(body, d);
  assert.equal(retried.body.duplicate, undefined);
  assert.equal(chain.sent.length, 1);
});

test("a notification without event_id is still checked (and simply not deduplicated)", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  const res = await handleWebhook(JSON.stringify({ hello: "world" }), deps(chain));
  assert.equal(res.status, 200);
  assert.equal(chain.sent.length, 1);
});

test("without a keeper key the webhook reports but never sends", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  const res = await handleWebhook(notification(), { ...deps(chain), send: false });
  assert.equal(chain.sent.length, 0);
  assert.match(res.body.results![0]!, /not sent: no keeper key/);
});

test("RecentIds forgets the oldest id past its capacity", () => {
  const ids = new RecentIds(2);
  ids.add("a");
  ids.add("b");
  ids.add("c");
  assert.equal(ids.has("a"), false);
  assert.equal(ids.has("b") && ids.has("c"), true);
});
