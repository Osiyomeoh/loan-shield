import assert from "node:assert/strict";
import { test } from "node:test";
import { formatWad, parseWatchList } from "../src/config.js";
import { checkAndRescue, describe } from "../src/keeper.js";
import { ADA, FakeChain, healthy, inDanger, TUNDE } from "./fakes.js";

test("sends nothing while the chain says the loan is healthy", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: healthy });
  const outcome = await checkAndRescue(chain, TUNDE);
  assert.equal(outcome.kind, "skipped");
  assert.equal(chain.sent.length, 0);
  assert.match(describe(TUNDE, outcome), /healthy \(HF 1\.7900 ≥ trigger 1\.5000\)/);
});

test("sends nothing for any status other than Ready", async () => {
  for (const status of ["NoPolicy", "NoDebt", "NotInDanger", "EmptyBuffer"] as const) {
    const chain = new FakeChain({ [TUNDE.borrower]: { ...inDanger, status } });
    assert.equal((await checkAndRescue(chain, TUNDE)).kind, "skipped", status);
    assert.equal(chain.sent.length, 0, status);
  }
});

test("sends exactly one rescue when the chain says Ready", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  const outcome = await checkAndRescue(chain, TUNDE);
  assert.equal(outcome.kind, "rescued");
  assert.deepEqual(chain.sent, [TUNDE]);
  // A second check finds the loan back at target and sends nothing.
  assert.equal((await checkAndRescue(chain, TUNDE)).kind, "skipped");
  assert.equal(chain.sent.length, 1);
});

test("without a keeper key it reports the rescue but sends nothing", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  const outcome = await checkAndRescue(chain, TUNDE, { send: false });
  assert.equal(outcome.kind, "would-rescue");
  assert.equal(chain.sent.length, 0);
});

test("a lost race (dry run reverts after preview said Ready) sends nothing", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  chain.dryRun = { ok: false, error: "NotInDanger" };
  const outcome = await checkAndRescue(chain, TUNDE);
  assert.deepEqual(outcome, { kind: "lost-race", error: "NotInDanger" });
  assert.equal(chain.sent.length, 0);
});

test("a rescue that reverts on-chain is reported, not hidden", async () => {
  const chain = new FakeChain({ [TUNDE.borrower]: inDanger });
  chain.receipt = "reverted";
  const outcome = await checkAndRescue(chain, TUNDE);
  assert.equal(outcome.kind, "reverted");
  assert.match(describe(TUNDE, outcome), /reverted on-chain/);
});

test("RPC errors propagate instead of being treated as 'healthy'", async () => {
  const chain = new FakeChain();
  chain.failPreview = true;
  await assert.rejects(checkAndRescue(chain, TUNDE), /RPC unavailable/);
});

test("parseWatchList parses, checksums and dedupes borrower:marketId pairs", () => {
  const list = `${TUNDE.borrower}:${TUNDE.marketId}, ${ADA.borrower.toLowerCase()}:${ADA.marketId.toUpperCase().replace("0X", "0x")},${TUNDE.borrower}:${TUNDE.marketId}`;
  assert.deepEqual(parseWatchList(list), [TUNDE, ADA]);
  assert.deepEqual(parseWatchList(""), []);
});

test("parseWatchList rejects malformed entries", () => {
  assert.throws(() => parseWatchList(TUNDE.borrower), /borrower:marketId/);
  assert.throws(() => parseWatchList(`0x1234:${TUNDE.marketId}`), /not an address/);
  assert.throws(() => parseWatchList(`${TUNDE.borrower}:0x1234`), /32-byte hex id/);
});

test("formatWad", () => {
  assert.equal(formatWad(1_376_000_000_000_000_000n), "1.3760");
  assert.equal(formatWad(980_400_000_000_000_000n), "0.9804");
  assert.equal(formatWad(2n ** 256n - 1n), "∞");
});
