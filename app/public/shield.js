// @ts-check
// Reads Loan Shield and Morpho Blue state from Arc mainnet over plain JSON-RPC, in the browser or in Node.
// No dependencies and no wallet: every request is a read (eth_call, eth_getLogs, eth_getCode). The selectors and
// topics below are checked against the compiled contract and against viem's encoder by test/web.test.ts.

export const ARC = { chainId: 5042, rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" };
export const MORPHO = "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD";
/** The USDC/cirBTC Morpho market (LLTV 0.86) that Borrow Kit lends from. */
export const CIRBTC_MARKET = "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d";

export const SELECTORS = {
  buffer: "0x72e3ddaa", // buffer(address)
  policy: "0xcadb35d7", // policy(address,bytes32)
  healthFactor: "0xf638e194", // healthFactor(address,bytes32)
  preview: "0x4d86e257", // preview(address,bytes32)
  rescue: "0x5a5668e2", // rescue(address,bytes32)
  position: "0x93c52062", // Morpho position(bytes32,address)
  market: "0x5c60e39a", // Morpho market(bytes32)
  idToMarketParams: "0x2c3c9157", // Morpho idToMarketParams(bytes32)
  price: "0xa035b1fe", // oracle price()
  decimals: "0x313ce567", // ERC-20 decimals()
};

/** LoanShield's custom errors by selector. */
export const ERRORS = {
  "0x1f2a2005": "ZeroAmount",
  "0xb069d79c": "InsufficientBuffer",
  "0xf432588f": "InvalidPolicy",
  "0x734ec8d8": "UnsupportedMarket",
  "0xcefa6b05": "NoPolicy",
  "0x11a3fbc6": "NoDebt",
  "0x504ed697": "NotInDanger",
  "0x240db51c": "EmptyBuffer",
  "0x290f4457": "UnexpectedRepay",
  "0x2e733637": "NoImprovement",
  "0x90b8ec18": "TransferFailed",
  "0xab143c06": "Reentrancy",
  "0xede341c7": "Uint128Overflow",
};

/** Rescued(address indexed borrower, bytes32 indexed id, address indexed caller, uint256 assets, uint256 shares, uint256 healthFactorBefore, uint256 healthFactorAfter) */
export const RESCUED_TOPIC = "0x6036c4e7da068b6f3110d23db2c46e8c70237a4a1bdc672ee7f08dd1ab0b9a5b";

/** LoanShield.Status, in declaration order. */
export const STATUS = ["Ready", "NoPolicy", "NoDebt", "NotInDanger", "EmptyBuffer"];
export const WAD = 10n ** 18n;
export const MAX_UINT256 = 2n ** 256n - 1n;
/**
 * eth_getLogs block span the public Arc RPC accepts. Measured on rpc.mainnet.arc.io on 2026-10-12: 10,000 blocks
 * pass and 10,001 fail with -32012 "requested range too large" (earlier the same day it only refused spans over
 * 100,000, with -32602), so this uses the smaller limit. A local fork has no limit; e2e/mainnet-read.ts checks it.
 */
export const MAX_LOG_RANGE = 10_000n;

/** @param {unknown} value */
export const isAddress = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
/** @param {unknown} value */
export const isBytes32 = (value) => typeof value === "string" && /^0x[0-9a-fA-F]{64}$/.test(value);

/** An address or bytes32 as one 32-byte ABI word (64 hex chars, no 0x). @param {string} hex */
export function word(hex) {
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(hex)) throw new Error(`not a 32-byte hex value: ${hex}`);
  return hex.slice(2).toLowerCase().padStart(64, "0");
}

/** Calldata for a function whose arguments are all addresses or bytes32. @param {string} selector @param {...string} args */
export function encodeCall(selector, ...args) {
  return selector + args.map(word).join("");
}

/** A return value made of static 32-byte words, as unsigned integers. @param {string} data */
export function decodeWords(data) {
  const hex = data.startsWith("0x") ? data.slice(2) : data;
  if (hex.length === 0 || hex.length % 64 !== 0) throw new Error(`not ABI words: ${data.slice(0, 20)}…`);
  /** @type {bigint[]} */
  const words = [];
  for (let i = 0; i < hex.length; i += 64) words.push(BigInt("0x" + hex.slice(i, i + 64)));
  return words;
}

/**
 * Names the leading words of a return value (null skips one); throws if the data is shorter.
 * @template {string} K
 * @param {string} data
 * @param {readonly (K | null)[]} names
 * @returns {Record<K, bigint>}
 */
export function decodeFields(data, names) {
  const words = decodeWords(data);
  if (words.length < names.length) throw new Error(`expected ${names.length} words, got ${words.length}`);
  const out = /** @type {Record<K, bigint>} */ ({});
  names.forEach((name, i) => {
    if (name) out[name] = /** @type {bigint} */ (words[i]);
  });
  return out;
}

/** The address in the low 20 bytes of a word. @param {bigint} value */
export const toAddress = (value) => "0x" + value.toString(16).padStart(40, "0");

/** A LoanShield revert, or undefined if the data isn't one. @param {unknown} data */
export function decodeRevert(data) {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{8}/.test(data)) return undefined;
  const name = ERRORS[/** @type {keyof typeof ERRORS} */ (data.slice(0, 10).toLowerCase())];
  if (!name) return undefined;
  return { name, args: data.length > 10 ? decodeWords(data.slice(10)) : [] };
}

/** Fixed-point formatting, rounded down. @param {bigint} value @param {number} decimals @param {number} digits */
export function formatUnits(value, decimals, digits) {
  const scale = 10n ** BigInt(decimals);
  const whole = value / scale;
  if (digits === 0) return whole.toLocaleString("en-US");
  const frac = ((value % scale) * 10n ** BigInt(digits)) / scale;
  return `${whole.toLocaleString("en-US")}.${frac.toString().padStart(digits, "0")}`;
}

/** A WAD health factor; Morpho's "no debt" (uint max) shows as ∞. @param {bigint} value */
export const formatWad = (value, digits = 4) => (value === MAX_UINT256 ? "∞" : formatUnits(value, 18, digits));

/** Morpho SharesMathLib.toAssetsUp. @param {bigint} shares @param {bigint} totalAssets @param {bigint} totalShares */
export function toAssetsUp(shares, totalAssets, totalShares) {
  const d = totalShares + 1_000_000n;
  return (shares * (totalAssets + 1n) + d - 1n) / d;
}

/** Waits before each retry of a rate-limited request (HTTP 429, or 503): about 15 s in all before giving up. */
export const RETRY_DELAYS_MS = [500, 1000, 2000, 4000, 8000];
const MAX_RETRY_AFTER_MS = 10_000;

/**
 * Minimal JSON-RPC client. Reverts surface as errors carrying the revert `data`, as Arc's RPC and anvil return it.
 * Arc's public RPC answers HTTP 429 under load, so those requests wait (at least `Retry-After`) and retry.
 * @param {string} url
 * @param {typeof fetch} [fetchImpl]
 * @param {(ms: number) => Promise<void>} [sleep]
 */
export function createRpc(url, fetchImpl = globalThis.fetch.bind(globalThis), sleep = (ms) => new Promise((r) => setTimeout(r, ms))) {
  let id = 0;
  /** @param {string} method @param {unknown[]} params @returns {Promise<any>} */
  async function request(method, params) {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params });
    for (let attempt = 0; ; attempt++) {
      const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: payload });
      if ((res.status === 429 || res.status === 503) && attempt < RETRY_DELAYS_MS.length) {
        await res.body?.cancel();
        const retryAfter = Number(res.headers.get("retry-after")) * 1000 || 0;
        await sleep(Math.min(Math.max(RETRY_DELAYS_MS[attempt] ?? 0, retryAfter), MAX_RETRY_AFTER_MS));
        continue;
      }
      if (!res.ok) throw new Error(`RPC ${method}: HTTP ${res.status}`);
      const body = await res.json();
      if (body.error) throw Object.assign(new Error(`RPC ${method}: ${body.error.message}`), { data: body.error.data });
      return body.result;
    }
  }
  return {
    request,
    blockNumber: async () => BigInt(await request("eth_blockNumber", [])),
    /** @param {string} to @param {string} data */
    call: (to, data, block = "latest") => /** @type {Promise<string>} */ (request("eth_call", [{ to, data }, block])),
    /** @param {string} address @param {bigint} block */
    hasCode: async (address, block) => (await request("eth_getCode", [address, "0x" + block.toString(16)])) !== "0x",
    /** @param {bigint} block */
    blockTime: async (block) => Number(BigInt((await request("eth_getBlockByNumber", ["0x" + block.toString(16), false])).timestamp)),
    /** @param {object} filter @returns {Promise<any[]>} */
    getLogs: (filter) => request("eth_getLogs", [filter]),
  };
}
/** @typedef {ReturnType<typeof createRpc>} Rpc */

/** Market totals, oracle price and LLTV. @param {Rpc} rpc */
export async function readMarket(rpc, market = CIRBTC_MARKET) {
  const [totals, params] = await Promise.all([
    rpc.call(MORPHO, encodeCall(SELECTORS.market, market)),
    rpc.call(MORPHO, encodeCall(SELECTORS.idToMarketParams, market)),
  ]);
  const { totalSupplyAssets, totalBorrowAssets, totalBorrowShares } = decodeFields(totals, ["totalSupplyAssets", null, "totalBorrowAssets", "totalBorrowShares"]);
  const { loanToken, collateralToken, oracle, lltv } = decodeFields(params, ["loanToken", "collateralToken", "oracle", null, "lltv"]);
  if (loanToken === 0n) throw new Error(`no Morpho market ${market}`);
  const [price, loanDecimals, collateralDecimals] = await Promise.all([
    rpc.call(toAddress(oracle), SELECTORS.price).then((d) => decodeFields(d, ["v"]).v),
    rpc.call(toAddress(loanToken), SELECTORS.decimals).then((d) => Number(decodeFields(d, ["v"]).v)),
    rpc.call(toAddress(collateralToken), SELECTORS.decimals).then((d) => Number(decodeFields(d, ["v"]).v)),
  ]);
  return { totalSupplyAssets, totalBorrowAssets, totalBorrowShares, lltv, price, loanDecimals, collateralDecimals };
}
/** @typedef {Awaited<ReturnType<typeof readMarket>>} MarketState */

/** Price of one whole collateral token in loan tokens (e.g. USD per BTC), to the cent, for display. @param {MarketState} m */
export const collateralPrice = (m) => Number((m.price * 100n) / 10n ** BigInt(36 + m.loanDecimals - m.collateralDecimals)) / 100;

/** Morpho's liquidation incentive factor for an LLTV (Morpho.sol: min(1.15, 1 / (1 - 0.3 × (1 - LLTV)))). @param {bigint} lltv */
export const liquidationIncentive = (lltv) => Math.min(1.15, 1 / (1 - 0.3 * (1 - Number(lltv) / 1e18)));

/**
 * One loan as Morpho and the shield see it.
 * @param {Rpc} rpc
 * @param {{ shield: string, borrower: string, market: string }} loan
 * @param {MarketState} m
 */
export async function readLoan(rpc, { shield, borrower, market }, m) {
  const [position, hf, buffer, policy, preview] = await Promise.all([
    rpc.call(MORPHO, encodeCall(SELECTORS.position, market, borrower)),
    rpc.call(shield, encodeCall(SELECTORS.healthFactor, borrower, market)),
    rpc.call(shield, encodeCall(SELECTORS.buffer, borrower)),
    rpc.call(shield, encodeCall(SELECTORS.policy, borrower, market)),
    rpc.call(shield, encodeCall(SELECTORS.preview, borrower, market)),
  ]);
  const { borrowShares, collateral } = decodeFields(position, [null, "borrowShares", "collateral"]);
  const { trigger, target } = decodeFields(policy, ["trigger", "target"]);
  const p = decodeFields(preview, ["status", null, null, null, "repayAssets", "repayShares", "healthFactorAfter"]);
  const healthFactor = decodeFields(hf, ["v"]).v;
  return {
    collateral,
    debt: toAssetsUp(borrowShares, m.totalBorrowAssets, m.totalBorrowShares),
    healthFactor,
    buffer: decodeFields(buffer, ["v"]).v,
    trigger,
    target,
    preview: { ...p, status: STATUS[Number(p.status)] ?? `unknown(${p.status})` },
    // HF scales with price, so the loan is liquidatable once the collateral price falls by the factor 1 / HF.
    liquidationPrice: healthFactor === MAX_UINT256 || healthFactor === 0n ? undefined : (collateralPrice(m) * 1e18) / Number(healthFactor),
  };
}

/**
 * Runs `rescue` as an eth_call: what would happen if anyone sent it now. Nothing is sent.
 * @param {Rpc} rpc
 * @param {{ shield: string, borrower: string, market: string }} loan
 * @returns {Promise<{ ok: true, assets: bigint, healthFactorAfter: bigint } | { ok: false, name: string, args: bigint[] }>}
 */
export async function simulateRescue(rpc, { shield, borrower, market }) {
  try {
    const data = await rpc.call(shield, encodeCall(SELECTORS.rescue, borrower, market));
    return { ok: true, ...decodeFields(data, ["assets", "healthFactorAfter"]) };
  } catch (err) {
    const revert = decodeRevert(/** @type {{ data?: unknown }} */ (err).data);
    if (revert) return { ok: false, ...revert };
    throw err;
  }
}

/** First block at which `address` has code (archive reads). @param {Rpc} rpc @param {string} address @param {bigint} latest */
export async function findDeployBlock(rpc, address, latest) {
  if (!(await rpc.hasCode(address, latest))) throw new Error(`no contract at ${address}`);
  let low = 0n;
  let high = latest;
  while (low < high) {
    const mid = (low + high) / 2n;
    if (await rpc.hasCode(address, mid)) high = mid;
    else low = mid + 1n;
  }
  return low;
}

/**
 * Every Rescued event for a borrower (and market) between two blocks, in chunks the RPC accepts.
 * @param {Rpc} rpc
 * @param {{ shield: string, borrower?: string, market?: string, fromBlock: bigint, toBlock: bigint }} query
 */
export async function rescueHistory(rpc, { shield, borrower, market, fromBlock, toBlock }) {
  const topics = [RESCUED_TOPIC, borrower ? "0x" + word(borrower) : null, market ? "0x" + word(market) : null];
  /** @type {{ fromBlock: string, toBlock: string }[]} */
  const ranges = [];
  for (let start = fromBlock; start <= toBlock; start += MAX_LOG_RANGE) {
    const end = start + MAX_LOG_RANGE - 1n < toBlock ? start + MAX_LOG_RANGE - 1n : toBlock;
    ranges.push({ fromBlock: "0x" + start.toString(16), toBlock: "0x" + end.toString(16) });
  }
  /** @type {any[]} */
  const logs = [];
  for (let i = 0; i < ranges.length; i += 4) {
    // A few requests at a time, so a long history doesn't trip the public RPC's rate limit.
    const batch = await Promise.all(ranges.slice(i, i + 4).map((range) => rpc.getLogs({ address: shield, topics, ...range })));
    logs.push(...batch.flat());
  }
  return logs.map((log) => {
    const { assets, shares, healthFactorBefore, healthFactorAfter } = decodeFields(log.data, ["assets", "shares", "healthFactorBefore", "healthFactorAfter"]);
    return {
      blockNumber: BigInt(log.blockNumber),
      transactionHash: /** @type {string} */ (log.transactionHash),
      borrower: toAddress(BigInt(log.topics[1])),
      market: /** @type {string} */ (log.topics[2]),
      caller: toAddress(BigInt(log.topics[3])),
      assets,
      shares,
      healthFactorBefore,
      healthFactorAfter,
    };
  });
}
