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

const STRANGER = { borrower: "0x9999999999999999999999999999999999999999", marketId: TUNDE.marketId } as const;

function deps(chain: FakeChain, watch = [TUNDE]): WebhookDeps & { lines: string[] } {
  const lines: string[] = [];
  return { chain, watch, markets: [TUNDE.marketId], seen: new RecentIds(), send: true, log: (l) => lines.push(l), lines };
}

test("claim 9: a forged 'LIQUIDATABLE' notification sends nothing while the chain says healthy", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy });
  const res = await handleWebhook(notification({ threshold: "LIQUIDATABLE" }), deps(chain));
  assert.equal(res.status, 200);
  assert.equal(chain.sent.length, 0);
  assert.match(res.body.results![0]!, /healthy/);
});

test("claim 9: a forged alert naming a wallet without a policy only reads the chain", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy }); // the stranger has no policy: preview says NoPolicy
  const res = await handleWebhook(notification({ wallet: STRANGER.borrower, threshold: "LIQUIDATABLE" }), deps(chain));
  assert.equal(res.status, 200);
  assert.equal(chain.sent.length, 0);
  assert.match(res.body.results![1]!, /NoPolicy, no rescue/);
});

test("claim 9: a forged 'LIQUIDATABLE' alert naming a healthy protected wallet sends nothing", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy, [STRANGER.borrower]: healthy });
  await handleWebhook(notification({ wallet: STRANGER.borrower, threshold: "LIQUIDATABLE" }), deps(chain));
  assert.equal(chain.sent.length, 0);
});

test("an alert for a wallet outside the watch list rescues its loan when the contract says Ready", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy, [STRANGER.borrower]: inDanger });
  const res = await handleWebhook(notification({ wallet: STRANGER.borrower, threshold: "URGENT" }), deps(chain));
  assert.equal(res.status, 200);
  assert.deepEqual(chain.sent, [STRANGER]);
  assert.equal(res.body.results!.length, 2, "the watch list and the alert's wallet");
});

test("the alert's wallet is checked in every configured market", async () => {
  const other = "0x00000000000000000000000000000000000000000000000000000000000000aa" as const;
  const res = await handleWebhook(notification({ wallet: STRANGER.borrower }), {
    ...deps(new FakeChain(), []),
    markets: [TUNDE.marketId, other],
  });
  assert.deepEqual(res.body.results, [
    `${STRANGER.borrower} in ${TUNDE.marketId.slice(0, 10)}…: NoPolicy, no rescue`,
    `${STRANGER.borrower} in ${other.slice(0, 10)}…: NoPolicy, no rescue`,
  ]);
});

test("with no alert markets configured, only the watch list is checked", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy, [STRANGER.borrower]: inDanger });
  const res = await handleWebhook(notification({ wallet: STRANGER.borrower }), { ...deps(chain), markets: [] });
  assert.equal(chain.sent.length, 0);
  assert.equal(res.body.results!.length, 1);
});

test("a wallet on the watch list is checked once, however the alert spells it", async () => {
  const watched = { borrower: "0xAbCdEf0000000000000000000000000000000001", marketId: TUNDE.marketId } as const;
  for (const wallet of [watched.borrower, watched.borrower.toLowerCase()]) {
    const res = await handleWebhook(notification({ wallet }), deps(new FakeChain(), [watched]));
    assert.equal(res.body.results!.length, 1, wallet);
  }
});

test("an alert whose walletAddress isn't an address checks only the watch list", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy });
  for (const wallet of ["0xnope", "", "1111111111111111111111111111111111111111"]) {
    const res = await handleWebhook(notification({ wallet }), { ...deps(chain), watch: [ADA] });
    assert.equal(res.body.results!.length, 1, wallet);
  }
});

test("a dust rescue under the keeper's minimum is skipped", async () => {
  const chain = new FakeChain({ [STRANGER.borrower]: { ...inDanger, repayAssets: 9_999n } });
  const res = await handleWebhook(notification({ wallet: STRANGER.borrower }), { ...deps(chain, []), minRepay: 10_000n });
  assert.equal(chain.sent.length, 0);
  assert.match(res.body.results![0]!, /repays 0\.009999 USDC, under this keeper's 0\.01 USDC minimum, not sent/);
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

test("a forged alert reusing a real event_id with another wallet doesn't mark the real alert handled", async () => {
  const chain = new FakeChain({ [STRANGER.borrower]: inDanger });
  const d = deps(chain, []);
  const eventId = "6b2e8d1f-3c4a-5f7b-8e9d-1a2b3c4d5e6f";
  await handleWebhook(notification({ eventId, wallet: TUNDE.borrower }), d); // forged: same id, other wallet
  const real = await handleWebhook(notification({ eventId, wallet: STRANGER.borrower }), d);
  assert.equal(real.body.duplicate, undefined);
  assert.deepEqual(chain.sent, [STRANGER]);
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
