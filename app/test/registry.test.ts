import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type AbiEvent, type Address, type Hex, type Log } from "viem";
import { loanShieldAbi } from "../src/abi.js";
import { SHIELD_DEPLOYMENT } from "../src/config.js";
import { applyPolicyEvents, blockRanges, decodeShieldLog, firstBlock, scanShieldEvents, summarize, type ShieldEvent } from "../src/registry.js";
import { ADA, TUNDE, WAD } from "./fakes.js";

const SHIELD: Address = "0x00000000000000000000000000000000000051e1";
const KEEPER: Address = "0x3333333333333333333333333333333333333333";
const USDC = (amount: string) => BigInt(Math.round(Number(amount) * 1e6));

/** A log encoded exactly as the contract emits it, from the compiled ABI. */
function shieldLog(eventName: string, args: Record<string, unknown>, blockNumber: bigint, logIndex = 0, abi: readonly unknown[] = loanShieldAbi): Log {
  const event = abi.find((x) => (x as AbiEvent).type === "event" && (x as AbiEvent).name === eventName) as AbiEvent;
  const topics = encodeEventTopics({ abi: [event], eventName, args } as never) as [Hex, ...Hex[]];
  const plain = event.inputs.filter((i) => !i.indexed);
  return {
    address: SHIELD,
    blockHash: `0x${"ab".repeat(32)}`,
    blockNumber,
    data: encodeAbiParameters(plain, plain.map((i) => args[i.name!])),
    logIndex,
    removed: false,
    topics,
    transactionHash: `0x${blockNumber.toString(16).padStart(60, "0")}${logIndex.toString(16).padStart(4, "0")}`,
    transactionIndex: 0,
  };
}

const deposited = (owner: Address, amount: bigint, block: bigint, i = 0) => shieldLog("Deposited", { owner, amount }, block, i);
const withdrawn = (owner: Address, amount: bigint, block: bigint, i = 0) => shieldLog("Withdrawn", { owner, amount }, block, i);
const policySet = (owner: Address, id: Hex, trigger: bigint, target: bigint, block: bigint, i = 0) =>
  shieldLog("PolicySet", { owner, id, trigger, target }, block, i);
const policyCleared = (owner: Address, id: Hex, block: bigint, i = 0) => shieldLog("PolicyCleared", { owner, id }, block, i);
const rescued = (borrower: Address, id: Hex, assets: bigint, block: bigint, i = 0) =>
  shieldLog("Rescued", { borrower, id, caller: KEEPER, assets, shares: assets * 10n ** 6n, healthFactorBefore: WAD, healthFactorAfter: (WAD * 18n) / 10n }, block, i);

const decodeAll = (logs: Log[]) => logs.map((l) => decodeShieldLog(l)!);

test("blockRanges covers [from, to] in inclusive chunks of at most 10,000 blocks", () => {
  assert.deepEqual(blockRanges(0n, 25_000n), [
    { fromBlock: 0n, toBlock: 9_999n },
    { fromBlock: 10_000n, toBlock: 19_999n },
    { fromBlock: 20_000n, toBlock: 25_000n },
  ]);
  assert.deepEqual(blockRanges(5n, 5n), [{ fromBlock: 5n, toBlock: 5n }]);
  assert.deepEqual(blockRanges(6n, 5n), []);
});

test("decodes every LoanShield event from its encoded log", () => {
  const [d, w, s, c, r] = decodeAll([
    deposited(TUNDE.borrower, USDC("2"), 10n),
    withdrawn(TUNDE.borrower, USDC("0.5"), 11n),
    policySet(TUNDE.borrower, TUNDE.marketId, (WAD * 13n) / 10n, (WAD * 18n) / 10n, 12n),
    policyCleared(TUNDE.borrower, TUNDE.marketId, 13n),
    rescued(TUNDE.borrower, TUNDE.marketId, USDC("1.253229"), 14n, 3),
  ]);
  assert.deepEqual(
    { ...d, transactionHash: undefined },
    { name: "Deposited", owner: TUNDE.borrower, amount: 2_000_000n, blockNumber: 10n, logIndex: 0, transactionHash: undefined },
  );
  assert.equal(w!.name === "Withdrawn" && w!.amount, 500_000n);
  assert.equal(s!.name === "PolicySet" && s!.trigger, 1_300_000_000_000_000_000n);
  assert.equal(c!.name === "PolicyCleared" && c!.id, TUNDE.marketId);
  assert.equal(r!.name === "Rescued" && r!.caller, KEEPER);
  assert.equal(r!.name === "Rescued" && r!.assets, 1_253_229n);
  assert.equal(r!.logIndex, 3);
});

test("logs that aren't LoanShield events, and pending logs, are dropped", () => {
  const transfer = shieldLog("Transfer", { from: TUNDE.borrower, to: ADA.borrower, value: 1n }, 10n, 0, erc20Abi);
  assert.equal(decodeShieldLog(transfer), undefined);
  assert.equal(decodeShieldLog({ ...deposited(TUNDE.borrower, 1n, 10n), blockNumber: null } as unknown as Log), undefined);
});

test("scanShieldEvents asks for every range exactly once, a few at a time, and returns events oldest first", async () => {
  const asked: { fromBlock: bigint; toBlock: bigint }[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const logs = [
    deposited(TUNDE.borrower, 1n, 42_000n, 1),
    deposited(ADA.borrower, 2n, 42_000n, 0),
    deposited(TUNDE.borrower, 3n, 5n),
    deposited(ADA.borrower, 4n, 61_234n),
  ];
  const events = await scanShieldEvents(async (range) => {
    asked.push(range);
    maxInFlight = Math.max(maxInFlight, ++inFlight);
    await new Promise((r) => setTimeout(r, 1));
    inFlight--;
    // Newest first within a range, to check the sort.
    return logs.filter((l) => l.blockNumber! >= range.fromBlock && l.blockNumber! <= range.toBlock).reverse();
  }, 0n, 65_000n);
  assert.deepEqual(asked.map((r) => r.fromBlock), [0n, 10_000n, 20_000n, 30_000n, 40_000n, 50_000n, 60_000n]);
  assert.equal(asked.at(-1)!.toBlock, 65_000n);
  assert.ok(maxInFlight <= 4, `at most 4 requests at once, saw ${maxInFlight}`);
  assert.deepEqual(events.map((e) => (e.name === "Deposited" ? e.amount : 0n)), [3n, 2n, 1n, 4n]);
});

test("a policy is in force from its latest PolicySet until a PolicyCleared", () => {
  const events = decodeAll([
    policySet(TUNDE.borrower, TUNDE.marketId, WAD, 2n * WAD, 10n),
    policySet(ADA.borrower, ADA.marketId, WAD, 2n * WAD, 11n),
    policySet(TUNDE.borrower, TUNDE.marketId, (WAD * 13n) / 10n, 2n * WAD, 12n), // changed, still one policy
    policyCleared(ADA.borrower, ADA.marketId, 13n),
  ]);
  assert.deepEqual([...applyPolicyEvents(events).values()], [TUNDE]);
  const reopened = decodeAll([policySet(ADA.borrower, ADA.marketId, WAD, 2n * WAD, 14n)]);
  assert.deepEqual([...applyPolicyEvents([...events, ...reopened]).values()], [TUNDE, ADA]);
});

test("applying new events to a saved book gives the same result as a full scan", () => {
  const events = decodeAll([
    policySet(TUNDE.borrower, TUNDE.marketId, WAD, 2n * WAD, 10n),
    policySet(ADA.borrower, ADA.marketId, WAD, 2n * WAD, 11n),
    policyCleared(TUNDE.borrower, TUNDE.marketId, 20n),
    policySet(TUNDE.borrower, TUNDE.marketId, WAD, 2n * WAD, 30n),
  ]);
  for (let split = 0; split <= events.length; split++) {
    const saved = applyPolicyEvents(events.slice(0, split));
    const borrowers = (book: Map<string, { borrower: string }>) => [...book.values()].map((p) => p.borrower).sort();
    assert.deepEqual(borrowers(applyPolicyEvents(events.slice(split), saved)), borrowers(applyPolicyEvents(events)), `split at ${split}`);
  }
});

test("summarize rebuilds the mainnet demo history: 2 USDC in, one rescue of 1.253229, 0.746771 left", () => {
  // The transactions in README "Live on Arc mainnet", in order.
  const events = decodeAll([
    deposited(TUNDE.borrower, USDC("2"), 25_714_345n),
    policySet(TUNDE.borrower, TUNDE.marketId, (WAD * 11n) / 10n, (WAD * 15n) / 10n, 25_714_348n),
    policySet(TUNDE.borrower, TUNDE.marketId, (WAD * 13n) / 10n, (WAD * 18n) / 10n, 25_715_440n),
    rescued(TUNDE.borrower, TUNDE.marketId, USDC("1.253229"), 25_715_475n),
  ]);
  assert.deepEqual(summarize(events), {
    loansProtected: 1,
    policies: 1,
    usdcOnStandby: 746_771n,
    rescues: 1,
    repaidByRescues: 1_253_229n,
  });
});

test("a policy with no USDC behind it isn't counted as protected", () => {
  const events: ShieldEvent[] = decodeAll([
    deposited(TUNDE.borrower, USDC("3"), 10n),
    policySet(TUNDE.borrower, TUNDE.marketId, WAD, 2n * WAD, 11n),
    policySet(ADA.borrower, ADA.marketId, WAD, 2n * WAD, 12n), // never deposited
    withdrawn(TUNDE.borrower, USDC("3"), 13n), // emptied
    deposited(ADA.borrower, USDC("1"), 14n),
  ]);
  const stats = summarize(events);
  assert.equal(stats.policies, 2);
  assert.equal(stats.loansProtected, 1, "only ADA has USDC left");
  assert.equal(stats.usdcOnStandby, 1_000_000n);
  assert.equal(stats.rescues, 0);
});

test("firstBlock uses the known block for the mainnet shield and binary-searches any other", async () => {
  let calls = 0;
  const chain = {
    getCode: async ({ blockNumber }: { blockNumber?: bigint }) => {
      calls++;
      return blockNumber! >= 1_234_567n ? ("0x6080" as Hex) : undefined;
    },
  };
  assert.equal(await firstBlock(chain as never, SHIELD_DEPLOYMENT.address, 9_999_999n), 25_712_043n);
  assert.equal(calls, 0);
  assert.equal(await firstBlock(chain as never, SHIELD, 9_999_999n), 1_234_567n);
  assert.ok(calls < 30, `${calls} calls`);
  await assert.rejects(firstBlock(chain as never, SHIELD, 1_000n), /no contract/);
});
