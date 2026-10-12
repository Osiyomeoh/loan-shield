// The web page's dependency-free chain reader (public/shield.js), checked against viem and the compiled ABI.
import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeErrorResult,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  maxUint256,
  parseAbi,
  toFunctionSelector,
  type AbiFunction,
} from "viem";
import { loanShieldAbi } from "../src/abi.js";
import { CIRBTC_MARKET as APP_MARKET, MORPHO as APP_MORPHO, STATUS as APP_STATUS } from "../src/config.js";
import * as web from "../public/shield.js";
import { ADA, TUNDE, WAD } from "./fakes.js";

const SHIELD = "0x5555555555555555555555555555555555555555";
const morphoAbi = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128, uint128, uint128, uint128, uint128, uint128)",
  "function idToMarketParams(bytes32 id) view returns (address, address, address, address, uint256)",
  "function price() view returns (uint256)",
  "function decimals() view returns (uint8)",
]);

test("selectors, error selectors and the Rescued topic match the compiled contract", () => {
  const fn = (name: string) => loanShieldAbi.find((x) => x.type === "function" && x.name === name) as AbiFunction;
  for (const name of ["buffer", "policy", "healthFactor", "preview", "rescue"] as const) {
    assert.equal(web.SELECTORS[name], toFunctionSelector(fn(name)), name);
  }
  for (const name of ["position", "market", "idToMarketParams", "price", "decimals"] as const) {
    assert.equal(web.SELECTORS[name], toFunctionSelector(morphoAbi.find((x) => x.name === name)!), name);
  }
  const errors = loanShieldAbi.filter((x) => x.type === "error");
  assert.equal(Object.keys(web.ERRORS).length, errors.length, "every contract error is decodable");
  for (const e of errors) {
    const selector = toFunctionSelector(`${e.name}(${e.inputs.map((i) => i.type).join(",")})`);
    assert.equal(web.ERRORS[selector as keyof typeof web.ERRORS], e.name);
  }
  assert.equal(web.RESCUED_TOPIC, encodeEventTopics({ abi: loanShieldAbi, eventName: "Rescued" })[0]);
  assert.deepEqual(web.STATUS, [...APP_STATUS]);
  assert.equal(web.MORPHO, APP_MORPHO);
  assert.equal(web.CIRBTC_MARKET, APP_MARKET);
});

test("encodeCall matches viem's calldata", () => {
  assert.equal(
    web.encodeCall(web.SELECTORS.preview, TUNDE.borrower, TUNDE.marketId),
    encodeFunctionData({ abi: loanShieldAbi, functionName: "preview", args: [TUNDE.borrower, TUNDE.marketId] }),
  );
  assert.equal(
    web.encodeCall(web.SELECTORS.position, TUNDE.marketId, TUNDE.borrower),
    encodeFunctionData({ abi: morphoAbi, functionName: "position", args: [TUNDE.marketId, TUNDE.borrower] }),
  );
  assert.throws(() => web.encodeCall(web.SELECTORS.buffer, "not hex"));
  assert.throws(() => web.word("0x" + "1".repeat(65)));
});

test("decodeFields reads viem-encoded results and refuses short data", () => {
  const preview = { status: 3, healthFactor: 2n * WAD, trigger: (15n * WAD) / 10n, target: (18n * WAD) / 10n, repayAssets: 0n, repayShares: 0n, healthFactorAfter: 2n * WAD };
  const data = encodeFunctionResult({ abi: loanShieldAbi, functionName: "preview", result: preview });
  const f = web.decodeFields(data, ["status", "healthFactor", "trigger", "target", "repayAssets", "repayShares", "healthFactorAfter"]);
  assert.deepEqual(f, { ...preview, status: 3n });
  assert.throws(() => web.decodeFields("0x" + "00".repeat(32), ["a", "b"]), /expected 2 words/);
  assert.throws(() => web.decodeWords("0x"), /not ABI words/);
  assert.throws(() => web.decodeWords("0x1234"), /not ABI words/);
});

test("decodeRevert names LoanShield errors and ignores anything else", () => {
  const hf = (179n * WAD) / 100n;
  const trigger = (15n * WAD) / 10n;
  const data = encodeErrorResult({ abi: loanShieldAbi, errorName: "NotInDanger", args: [hf, trigger] });
  assert.deepEqual(web.decodeRevert(data), { name: "NotInDanger", args: [hf, trigger] });
  assert.deepEqual(web.decodeRevert(encodeErrorResult({ abi: loanShieldAbi, errorName: "NoPolicy" })), { name: "NoPolicy", args: [] });
  assert.equal(web.decodeRevert("0x08c379a0" + "00".repeat(32)), undefined, "Error(string) is not a LoanShield error");
  assert.equal(web.decodeRevert(undefined), undefined);
  assert.equal(web.decodeRevert("0x12"), undefined);
});

test("number formatting rounds down and shows Morpho's no-debt health factor as ∞", () => {
  assert.equal(web.formatWad(maxUint256), "∞");
  assert.equal(web.formatWad((199999n * WAD) / 100000n), "1.9999");
  assert.equal(web.formatUnits(1_234_567_891n, 6, 2), "1,234.56");
  assert.equal(web.formatUnits(5n, 6, 0), "0");
  assert.equal(web.formatUnits(195_004_920_923_524n, 6, 0), "195,004,920");
});

test("toAssetsUp is Morpho's SharesMathLib rounding (up, with virtual shares)", () => {
  assert.equal(web.toAssetsUp(0n, 0n, 0n), 0n);
  assert.equal(web.toAssetsUp(1_000_000n, 0n, 0n), 1n);
  // 193.99M USDC over 1.9378e20 shares at block 25,626,000: 1e6 shares are worth just over 1 base unit, rounded up.
  assert.equal(web.toAssetsUp(1_000_000n, 193_989_958_998_204n, 193_782_698_639_518_145_650n), 2n);
});

test("liquidation incentive at LLTV 0.86 is Morpho's 1.0438 (the 4.38% penalty)", () => {
  assert.ok(Math.abs(web.liquidationIncentive(86n * 10n ** 16n) - 1.043841336116910229) < 1e-12);
  assert.equal(web.liquidationIncentive(0n), 1.15);
});

/** A JSON-RPC endpoint backed by a handler, so the reader is exercised through the same fetch path a browser uses. */
function fakeRpc(handler: (method: string, params: any[]) => unknown) {
  const calls: { method: string; params: any[] }[] = [];
  const fetchImpl = (async (_url: string, init: { body: string }) => {
    const { id, method, params } = JSON.parse(init.body);
    calls.push({ method, params });
    try {
      return Response.json({ jsonrpc: "2.0", id, result: handler(method, params) });
    } catch (err) {
      return Response.json({ jsonrpc: "2.0", id, error: { code: 3, message: "execution reverted", data: (err as { data?: string }).data } });
    }
  }) as unknown as typeof fetch;
  return { rpc: web.createRpc("http://rpc.test", fetchImpl), calls };
}
const revert = (data: string) => Object.assign(new Error("revert"), { data });

test("simulateRescue turns a revert into its LoanShield error and a success into the returned amounts", async () => {
  const hf = (179n * WAD) / 100n;
  const trigger = (15n * WAD) / 10n;
  const healthy = fakeRpc(() => {
    throw revert(encodeErrorResult({ abi: loanShieldAbi, errorName: "NotInDanger", args: [hf, trigger] }));
  });
  assert.deepEqual(await web.simulateRescue(healthy.rpc, { shield: SHIELD, ...loan(TUNDE) }), { ok: false, name: "NotInDanger", args: [hf, trigger] });
  assert.equal(healthy.calls[0]?.params[0].data, web.encodeCall(web.SELECTORS.rescue, TUNDE.borrower, TUNDE.marketId));
  assert.equal(healthy.calls[0]?.params[0].from, undefined, "simulated without a sender");

  const due = fakeRpc(() => encodeFunctionResult({ abi: loanShieldAbi, functionName: "rescue", result: [2_200_000n, (22n * WAD) / 10n] }));
  assert.deepEqual(await web.simulateRescue(due.rpc, { shield: SHIELD, ...loan(TUNDE) }), { ok: true, assets: 2_200_000n, healthFactorAfter: (22n * WAD) / 10n });

  const broken = fakeRpc(() => {
    throw revert("0x08c379a0");
  });
  await assert.rejects(web.simulateRescue(broken.rpc, { shield: SHIELD, ...loan(TUNDE) }), /execution reverted/);
});

test("readMarket and readLoan decode what Morpho and the shield return", async () => {
  const oracle = "0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab";
  const usdc = "0x3600000000000000000000000000000000000000";
  const cirbtc = "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0";
  const price = 60_000n * 10n ** 34n; // $60,000 per BTC at Morpho's oracle scale for 6 / 8 decimals
  const { rpc } = fakeRpc((method, [tx]) => {
    assert.equal(method, "eth_call");
    const to = tx.to.toLowerCase();
    const sel = tx.data.slice(0, 10);
    if (to === oracle.toLowerCase()) return encodeFunctionResult({ abi: morphoAbi, functionName: "price", result: price });
    if (to === usdc) return encodeFunctionResult({ abi: morphoAbi, functionName: "decimals", result: 6 });
    if (to === cirbtc.toLowerCase()) return encodeFunctionResult({ abi: morphoAbi, functionName: "decimals", result: 8 });
    if (sel === web.SELECTORS.market) return encodeFunctionResult({ abi: morphoAbi, functionName: "market", result: [1000n, 0n, 500n, 500_000_000n, 0n, 0n] });
    if (sel === web.SELECTORS.idToMarketParams) return encodeFunctionResult({ abi: morphoAbi, functionName: "idToMarketParams", result: [usdc, cirbtc, oracle, SHIELD, 86n * 10n ** 16n] });
    if (sel === web.SELECTORS.position) return encodeFunctionResult({ abi: morphoAbi, functionName: "position", result: [0n, 300_000_000n, 1_000_000n] });
    if (sel === web.SELECTORS.healthFactor) return encodeFunctionResult({ abi: loanShieldAbi, functionName: "healthFactor", result: 2n * WAD });
    if (sel === web.SELECTORS.buffer) return encodeFunctionResult({ abi: loanShieldAbi, functionName: "buffer", result: 5_000_000n });
    if (sel === web.SELECTORS.policy) return encodeFunctionResult({ abi: loanShieldAbi, functionName: "policy", result: [(15n * WAD) / 10n, (18n * WAD) / 10n] });
    if (sel === web.SELECTORS.preview) {
      return encodeFunctionResult({
        abi: loanShieldAbi,
        functionName: "preview",
        result: { status: 3, healthFactor: 2n * WAD, trigger: (15n * WAD) / 10n, target: (18n * WAD) / 10n, repayAssets: 0n, repayShares: 0n, healthFactorAfter: 2n * WAD },
      });
    }
    throw new Error(`unexpected call ${to} ${sel}`);
  });

  const m = await web.readMarket(rpc);
  assert.deepEqual([m.totalSupplyAssets, m.totalBorrowAssets, m.lltv, m.loanDecimals, m.collateralDecimals], [1000n, 500n, 86n * 10n ** 16n, 6, 8]);
  assert.equal(web.collateralPrice(m), 60_000);

  const l = await web.readLoan(rpc, { shield: SHIELD, ...loan(TUNDE) }, m);
  assert.equal(l.collateral, 1_000_000n);
  assert.equal(l.debt, web.toAssetsUp(300_000_000n, 500n, 500_000_000n));
  assert.equal(l.buffer, 5_000_000n);
  assert.deepEqual([l.trigger, l.target, l.healthFactor], [(15n * WAD) / 10n, (18n * WAD) / 10n, 2n * WAD]);
  assert.equal(l.preview.status, "NotInDanger");
  assert.equal(l.liquidationPrice, 30_000, "HF 2 at $60k: liquidatable at $30k");
});

test("readMarket refuses a market that doesn't exist", async () => {
  const { rpc } = fakeRpc(() => "0x" + "00".repeat(32 * 6));
  await assert.rejects(web.readMarket(rpc, "0x" + "ab".repeat(32)), /no Morpho market/);
});

test("rescueHistory splits the range into chunks the RPC accepts and decodes each Rescued log", async () => {
  const topics = encodeEventTopics({ abi: loanShieldAbi, eventName: "Rescued", args: { borrower: TUNDE.borrower, id: TUNDE.marketId, caller: ADA.borrower } });
  const data = encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], [2_200_000n, 2_100_000_000_000n, (16n * WAD) / 10n, (22n * WAD) / 10n]);
  const { rpc, calls } = fakeRpc((_method, [filter]) =>
    filter.fromBlock === "0x0" ? [{ blockNumber: "0x10", transactionHash: "0xabc", topics, data }] : [],
  );

  const events = await web.rescueHistory(rpc, { shield: SHIELD, ...loan(TUNDE), fromBlock: 0n, toBlock: 25_000n });
  assert.deepEqual(
    calls.map((c) => [c.params[0].fromBlock, c.params[0].toBlock]),
    [["0x0", "0x270f"], ["0x2710", "0x4e1f"], ["0x4e20", "0x61a8"]],
    "0–9,999, 10,000–19,999, 20,000–25,000",
  );
  assert.deepEqual(calls[0]?.params[0].topics, [web.RESCUED_TOPIC, topics[1], topics[2]], "filtered by borrower and market");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    blockNumber: 16n,
    transactionHash: "0xabc",
    borrower: TUNDE.borrower.toLowerCase(),
    market: TUNDE.marketId,
    caller: ADA.borrower.toLowerCase(),
    assets: 2_200_000n,
    shares: 2_100_000_000_000n,
    healthFactorBefore: (16n * WAD) / 10n,
    healthFactorAfter: (22n * WAD) / 10n,
  });
});

test("rescueHistory never asks for more than 10,000 blocks, at the boundaries too", async () => {
  for (const [fromBlock, toBlock] of [[0n, 9_999n], [0n, 10_000n], [5n, 20_004n], [7n, 7n]] as const) {
    const { rpc, calls } = fakeRpc(() => []);
    await web.rescueHistory(rpc, { shield: SHIELD, fromBlock, toBlock });
    const ranges = calls.map((c) => [BigInt(c.params[0].fromBlock), BigInt(c.params[0].toBlock)] as const);
    assert.equal(ranges[0]?.[0], fromBlock);
    assert.equal(ranges.at(-1)?.[1], toBlock);
    ranges.forEach(([from, to], i) => {
      assert.ok(to - from + 1n <= web.MAX_LOG_RANGE, `range ${from}–${to} spans ${to - from + 1n} blocks`);
      if (i > 0) assert.equal(from, ranges[i - 1]![1] + 1n, "contiguous, no gaps or overlaps");
    });
  }
});

test("findDeployBlock binary-searches the first block with code", async () => {
  const latest = 25_634_421n;
  for (const deployedAt of [0n, 1n, 2n, 25_626_123n, latest - 1n, latest]) {
    const { rpc, calls } = fakeRpc((method, [, block]) => {
      assert.equal(method, "eth_getCode");
      return BigInt(block) >= deployedAt ? "0x6080" : "0x";
    });
    assert.equal(await web.findDeployBlock(rpc, SHIELD, latest), deployedAt);
    assert.ok(calls.length <= 27, `${calls.length} reads`);
  }
  const { rpc } = fakeRpc(() => "0x");
  await assert.rejects(web.findDeployBlock(rpc, SHIELD, latest), /no contract/);
});

test("the RPC client waits and retries when rate-limited, and gives up after the last delay", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => void waits.push(ms);
  const answers = [
    () => new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
    () => new Response("", { status: 503 }),
    (id: number) => Response.json({ jsonrpc: "2.0", id, result: "0x10" }),
  ];
  let sent = 0;
  const flaky = (async (_url: string, init: { body: string }) => answers[sent++]!(JSON.parse(init.body).id)) as unknown as typeof fetch;
  assert.equal(await web.createRpc("http://rpc.test", flaky, sleep).blockNumber(), 16n);
  assert.deepEqual(waits, [3000, 1000], "Retry-After when longer than the backoff, then the backoff");

  waits.length = 0;
  sent = 0;
  const limited = (async () => (sent++, new Response("", { status: 429, headers: { "retry-after": "60" } }))) as unknown as typeof fetch;
  await assert.rejects(web.createRpc("http://rpc.test", limited, sleep).blockNumber(), /RPC eth_blockNumber: HTTP 429/);
  assert.equal(sent, web.RETRY_DELAYS_MS.length + 1);
  assert.deepEqual(waits, web.RETRY_DELAYS_MS.map(() => 10_000), "a long Retry-After is capped");

  sent = 0;
  const down = (async () => (sent++, new Response("", { status: 500 }))) as unknown as typeof fetch;
  await assert.rejects(web.createRpc("http://rpc.test", down, sleep).blockNumber(), /HTTP 500/);
  assert.equal(sent, 1, "other HTTP errors are not retried");
});

function loan(p: { borrower: string; marketId: string }) {
  return { borrower: p.borrower, market: p.marketId };
}
