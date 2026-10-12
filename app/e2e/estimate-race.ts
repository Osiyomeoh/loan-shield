// LOCAL fork only: reproduces the gas-estimate gap behind withHeadroom in src/chain.ts, then runs the keeper's real
// sendRescue through it. Needs a loan that is due a rescue (SHIELD_ADDRESS, BORROWER, KEEPER_PRIVATE_KEY).
//   tsx e2e/estimate-race.ts
// Each round touches the market (accrueInterest) so its lastUpdate is that block's timestamp T, gets a rescue gas
// estimate in a block environment at T (Morpho sees no time elapsed and skips accrual), and has the rescue mined at
// T + 2, where accrual runs. Round 1 sends exactly the estimate and must run out of gas; round 2 calls sendRescue,
// which estimates the same way and adds headroom, and must rescue.
import { createTestClient, createWalletClient, http, parseAbi, parseEventLogs, type Hash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loanShieldAbi } from "../src/abi.js";
import { createShieldChain, publicClient } from "../src/chain.js";
import { arc, CIRBTC_MARKET, MORPHO, parseAddress, parsePrivateKey, requireEnv, rpcUrl } from "../src/config.js";

const rpc = rpcUrl();
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpc)) throw new Error(`refusing non-local ARC_RPC_URL: ${rpc}`);

const morphoAbi = parseAbi([
  "function idToMarketParams(bytes32 id) view returns ((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv))",
  "function accrueInterest((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams)",
  "event AccrueInterest(bytes32 indexed id, uint256 prevBorrowRate, uint256 interest, uint256 feeShares)",
]);
const shield = parseAddress(requireEnv("SHIELD_ADDRESS"), "SHIELD_ADDRESS");
const position = { borrower: parseAddress(requireEnv("BORROWER"), "BORROWER"), marketId: CIRBTC_MARKET };
const keeperKey = parsePrivateKey(requireEnv("KEEPER_PRIVATE_KEY"), "KEEPER_PRIVATE_KEY");
const keeper = privateKeyToAccount(keeperKey);
const client = publicClient(rpc);
const test = createTestClient({ chain: arc, mode: "anvil", transport: http(rpc) });
const wallet = createWalletClient({ account: keeper, chain: arc, transport: http(rpc) });
const chain = createShieldChain({ shield, keeperKey, rpc });
const rescue = { address: shield, abi: loanShieldAbi, functionName: "rescue", args: [position.borrower, position.marketId], account: keeper } as const;

const preview = await chain.preview(position);
if (preview.status !== "Ready") throw new Error(`loan is not due a rescue: ${preview.status}`);

const params = await client.readContract({ address: MORPHO, abi: morphoAbi, functionName: "idToMarketParams", args: [CIRBTC_MARKET] });
/** Touches the market and makes the next block (and so the next estimate) use the same timestamp. */
async function touchMarket(): Promise<bigint> {
  const hash = await wallet.writeContract({ address: MORPHO, abi: morphoAbi, functionName: "accrueInterest", args: [params] });
  const { blockNumber } = await client.waitForTransactionReceipt({ hash });
  const { timestamp } = await client.getBlock({ blockNumber });
  await test.setNextBlockTimestamp({ timestamp });
  return timestamp;
}

interface CallFrame {
  error?: string;
  calls?: CallFrame[];
}
/** Whether any call in the transaction ran out of gas (the tx reverts with gas left over, by the 63/64 rule). */
async function ranOutOfGas(hash: Hash): Promise<boolean> {
  const trace = (await client.request({ method: "debug_traceTransaction", params: [hash, { tracer: "callTracer" }] } as never)) as CallFrame;
  const walk = (frame: CallFrame): boolean => /out of gas/i.test(frame.error ?? "") || (frame.calls ?? []).some(walk);
  return walk(trace);
}

// Round 1: exactly the estimate. Automined, so the rescue lands in the next block, at T + 2.
const t1 = await touchMarket();
const estimate = await client.estimateContractGas(rescue);
await test.setNextBlockTimestamp({ timestamp: t1 + 2n });
const bare = await client.waitForTransactionReceipt({ hash: await wallet.writeContract({ ...rescue, gas: estimate }) });

// Round 2: sendRescue estimates at T, then the block is mined at T + 2; automine is off so the two can differ.
const t2 = await touchMarket();
await test.setAutomine(false);
let hash: Hash;
try {
  hash = await chain.sendRescue(position);
  await test.setNextBlockTimestamp({ timestamp: t2 + 2n });
  await test.mine({ blocks: 1 });
} finally {
  await test.setAutomine(true);
}
const padded = await client.waitForTransactionReceipt({ hash });
const { gas: limit } = await client.getTransaction({ hash });
const accrued = parseEventLogs({ abi: morphoAbi, eventName: "AccrueInterest", logs: padded.logs }).some(
  (log) => log.address.toLowerCase() === MORPHO.toLowerCase() && log.args.id === CIRBTC_MARKET,
);

console.log(`round 1: estimate at the market's lastUpdate timestamp ${estimate} gas; sent with exactly that, mined 2 s later: ${bare.status}, used ${bare.gasUsed}`);
console.log(`round 2: sendRescue sent with limit ${limit}; mined 2 s later: ${padded.status}, ${accrued ? "accrued interest" : "no accrual"}, used ${padded.gasUsed}`);
if (bare.status !== "reverted" || !(await ranOutOfGas(bare.transactionHash))) throw new Error("expected round 1 to run out of gas");
if (padded.status !== "success" || !accrued) throw new Error("expected round 2 to accrue interest and rescue");
console.log("estimate race: the bare estimate ran out of gas; sendRescue's headroom covered the accrual");
