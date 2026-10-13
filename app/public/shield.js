// @ts-check
// Reads Loan Shield and Morpho Blue state from Arc mainnet over plain JSON-RPC, in the browser or in Node.
// No dependencies and no keys: every request it sends to the chain is a read (eth_call, eth_getLogs, eth_getCode).
// It also builds the calldata for an owner's own transactions (approve, deposit, withdraw, setPolicy, clearPolicy),
// which the site hands to the owner's wallet to sign, and the keyless Borrow Kit request that points an owner's loan
// alerts at a keeper. The selectors and topics below are checked against the compiled contract and against viem's
// encoder by test/web.test.ts; the Borrow Kit request against Circle's own SDK by test/borrowkit.test.ts.

export const ARC = { chainId: 5042, rpc: "https://rpc.mainnet.arc.io", explorer: "https://explorer.arc.io" };
export const MORPHO = "0x34CD04070dD72b14E241112F6d83812Df5Af7fCD";
/** Arc's USDC: the ERC-20 interface (6 decimals) to the native gas token, so one balance pays deposits and gas. */
export const USDC = "0x3600000000000000000000000000000000000000";
/** The USDC/cirBTC Morpho market (LLTV 0.86) that Borrow Kit lends from. */
export const CIRBTC_MARKET = "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d";

export const SELECTORS = {
  buffer: "0x72e3ddaa", // buffer(address)
  policy: "0xcadb35d7", // policy(address,bytes32)
  healthFactor: "0xf638e194", // healthFactor(address,bytes32)
  preview: "0x4d86e257", // preview(address,bytes32)
  rescue: "0x5a5668e2", // rescue(address,bytes32)
  deposit: "0xb6b55f25", // deposit(uint256)
  withdraw: "0x2e1a7d4d", // withdraw(uint256)
  setPolicy: "0x76921b31", // setPolicy(bytes32,uint256,uint256)
  clearPolicy: "0x893be04a", // clearPolicy(bytes32)
  position: "0x93c52062", // Morpho position(bytes32,address)
  market: "0x5c60e39a", // Morpho market(bytes32)
  idToMarketParams: "0x2c3c9157", // Morpho idToMarketParams(bytes32)
  price: "0xa035b1fe", // oracle price()
  decimals: "0x313ce567", // ERC-20 decimals()
  balanceOf: "0x70a08231", // ERC-20 balanceOf(address)
  allowance: "0xdd62ed3e", // ERC-20 allowance(address,address)
  approve: "0x095ea7b3", // ERC-20 approve(address,uint256)
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

/** An address, bytes32 or uint256 as one 32-byte ABI word (64 hex chars, no 0x). @param {string | bigint} value */
export function word(value) {
  if (typeof value === "bigint") {
    if (value < 0n || value > MAX_UINT256) throw new Error(`not a uint256: ${value}`);
    return value.toString(16).padStart(64, "0");
  }
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(value)) throw new Error(`not a 32-byte hex value: ${value}`);
  return value.slice(2).toLowerCase().padStart(64, "0");
}

/** Calldata for a function whose arguments are all static words: addresses, bytes32 or uint256 (as bigint). @param {string} selector @param {...(string | bigint)} args */
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
 * USDC a rescue repays to lift a loan from health factor `hf` to `target` at a fixed price: HF is proportional to
 * 1 / debt, so it is debt × (1 − hf / target), rounded up. The contract does the same in shares with Morpho's
 * rounding (LoanShield._plan), so this can differ from its `preview` by a few base units.
 * @param {bigint} debt @param {bigint} hf @param {bigint} target
 */
export function repayToTarget(debt, hf, target) {
  if (hf >= target) return 0n;
  return (debt * (target - hf) + target - 1n) / target;
}

/**
 * Where a protected loan stands in collateral-price terms, for the page's "how far can BTC fall" view. HF is
 * proportional to the collateral price, so each threshold is today's price × (HF at the threshold) / HF now.
 * It assumes only the price moves: no interest, no top-up or withdrawal, and each rescue lands before a liquidator.
 * @param {{ debt: bigint, buffer: bigint, healthFactor: bigint, trigger: bigint, target: bigint }} loan
 * @param {number} price collateral price now, in loan tokens (collateralPrice)
 */
export function outlook({ debt, buffer, healthFactor, trigger, target }, price) {
  if (debt === 0n || healthFactor === 0n || healthFactor === MAX_UINT256) return undefined;
  const liquidationPrice = (price * 1e18) / Number(healthFactor);
  if (trigger === 0n) {
    return { liquidationPrice, protectedPrice: liquidationPrice, rescuePrice: undefined, needed: 0n, nextRepay: 0n, nextHealthAfter: undefined };
  }
  // Rescues keep repaying from the buffer as the price falls, so once it is spent the loan carries debt − buffer,
  // and liquidation moves down in proportion.
  const debtLeft = buffer >= debt ? 0n : debt - buffer;
  const protectedPrice = (liquidationPrice * Number(debtLeft)) / Number(debt);
  // The first rescue, once the price reaches the trigger: capped by the buffer, like the contract's.
  const needed = repayToTarget(debt, trigger, target);
  const nextRepay = needed < buffer ? needed : buffer;
  const nextHealthAfter = nextRepay >= debt ? MAX_UINT256 : (trigger * debt) / (debt - nextRepay);
  return { liquidationPrice, protectedPrice, rescuePrice: (price * Number(trigger)) / Number(healthFactor), needed, nextRepay, nextHealthAfter };
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

// ── The owner's own transactions ────────────────────────────────────────────────────────────────────────────────────
// The site builds these and the owner's wallet signs and sends them. Nothing here holds a key or sends a transaction.

/**
 * A decimal string as base units, e.g. ("2.5", 6) → 2500000n. Rejects signs, exponents and extra decimals.
 * @param {string} text @param {number} decimals
 */
export function parseUnits(text, decimals) {
  const t = text.trim();
  if (!/^(\d+\.?\d*|\.\d+)$/.test(t)) throw new Error("enter a number, like 5 or 2.5");
  const [whole = "", frac = ""] = t.split(".");
  if (frac.length > decimals) throw new Error(`at most ${decimals} decimals`);
  return BigInt(whole || "0") * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}

/** Why `setPolicy` would revert InvalidPolicy, or undefined: it needs 1 < trigger < target ≤ 10. @param {bigint} trigger @param {bigint} target */
export function policyError(trigger, target) {
  if (trigger <= WAD) return "the trigger must be above 1.00, where liquidation starts";
  if (target <= trigger) return "the target must be above the trigger";
  if (target > 10n * WAD) return "the target can be at most 10.00";
  return undefined;
}

/**
 * The owner's wallet USDC, what the shield may pull from it, and their buffer.
 * @param {Rpc} rpc @param {{ shield: string, owner: string }} who
 */
export async function readWallet(rpc, { shield, owner }) {
  const [balance, allowance, buffer] = await Promise.all([
    rpc.call(USDC, encodeCall(SELECTORS.balanceOf, owner)),
    rpc.call(USDC, encodeCall(SELECTORS.allowance, owner, shield)),
    rpc.call(shield, encodeCall(SELECTORS.buffer, owner)),
  ]);
  return { balance: decodeFields(balance, ["v"]).v, allowance: decodeFields(allowance, ["v"]).v, buffer: decodeFields(buffer, ["v"]).v };
}

/** @typedef {{ kind: "approve" | "deposit" | "withdraw" | "setPolicy" | "clearPolicy", to: string, data: string }} OwnerTx */

/** One owner transaction's target and calldata. */
export const ownerTx = {
  /** @param {string} shield @param {bigint} amount @returns {OwnerTx} */
  approve: (shield, amount) => ({ kind: "approve", to: USDC, data: encodeCall(SELECTORS.approve, shield, amount) }),
  /** @param {string} shield @param {bigint} amount @returns {OwnerTx} */
  deposit: (shield, amount) => ({ kind: "deposit", to: shield, data: encodeCall(SELECTORS.deposit, amount) }),
  /** @param {string} shield @param {bigint} amount @returns {OwnerTx} */
  withdraw: (shield, amount) => ({ kind: "withdraw", to: shield, data: encodeCall(SELECTORS.withdraw, amount) }),
  /** @param {string} shield @param {string} market @param {bigint} trigger @param {bigint} target @returns {OwnerTx} */
  setPolicy: (shield, market, trigger, target) => ({ kind: "setPolicy", to: shield, data: encodeCall(SELECTORS.setPolicy, market, trigger, target) }),
  /** @param {string} shield @param {string} market @returns {OwnerTx} */
  clearPolicy: (shield, market) => ({ kind: "clearPolicy", to: shield, data: encodeCall(SELECTORS.clearPolicy, market) }),
};

/**
 * The transactions that add `amount` to the buffer and set the policy, as scripts/protect.ts sends them: approve
 * exactly the amount (skipped when the allowance already covers it), deposit, then setPolicy (skipped when the
 * policy is already this one).
 * @param {{ shield: string, market: string, amount: bigint, allowance: bigint, trigger: bigint, target: bigint, current?: { trigger: bigint, target: bigint } }} plan
 */
export function planProtect({ shield, market, amount, allowance, trigger, target, current }) {
  const why = policyError(trigger, target);
  if (why) throw new Error(why);
  /** @type {OwnerTx[]} */
  const txs = [];
  if (amount > 0n) {
    if (allowance < amount) txs.push(ownerTx.approve(shield, amount));
    txs.push(ownerTx.deposit(shield, amount));
  }
  if (current?.trigger !== trigger || current?.target !== target) txs.push(ownerTx.setPolicy(shield, market, trigger, target));
  return txs;
}

/**
 * Runs a transaction as an eth_call from its sender, to catch a revert before the wallet asks for a signature.
 * @param {Rpc} rpc @param {{ from: string, to: string, data: string }} tx
 * @returns {Promise<{ ok: true } | { ok: false, name: string, args: bigint[], message?: string }>}
 */
export async function simulateTx(rpc, { from, to, data }) {
  try {
    await rpc.request("eth_call", [{ from, to, data }, "latest"]);
    return { ok: true };
  } catch (err) {
    const e = /** @type {{ data?: unknown, message?: string }} */ (err);
    const revert = decodeRevert(e.data);
    if (revert) return { ok: false, ...revert };
    if (/revert/i.test(e.message ?? "")) return { ok: false, name: "Reverted", args: [], message: e.message };
    throw err;
  }
}

/**
 * Polls for a transaction's receipt.
 * @param {Rpc} rpc @param {string} hash
 * @returns {Promise<{ ok: boolean, blockNumber: bigint }>}
 */
export async function waitForReceipt(rpc, hash, { intervalMs = 1000, timeoutMs = 120_000, sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    const receipt = await rpc.request("eth_getTransactionReceipt", [hash]);
    if (receipt) return { ok: receipt.status === "0x1", blockNumber: BigInt(receipt.blockNumber) };
    await sleep(intervalMs);
  }
  throw new Error(`no receipt for ${hash} after ${Math.round(timeoutMs / 1000)} s`);
}

/** Circle's Borrow Kit API. Keyless, and it answers browsers from any origin. */
export const BORROW_KIT_API = "https://api.circle.com/v1/borrowKit";
/** How long a webhook registration signature stays valid: Borrow Kit's own default; the service refuses over 300 s. */
export const WEBHOOK_DEADLINE_SECONDS = 240;

/**
 * The wallet's open Borrow Kit loan in `market`, or undefined if it has none (a loan opened on Morpho directly,
 * without Borrow Kit, has no Borrow Kit alerts).
 * @param {typeof fetch} fetchImpl @param {string} wallet @param {string} [market]
 * @returns {Promise<{ loanId: string, healthFactor?: string, healthFactorBand?: string } | undefined>}
 */
export async function findBorrowKitLoan(fetchImpl, wallet, market = CIRBTC_MARKET) {
  /** @type {string | undefined} */
  let pageAfter;
  for (let page = 0; page < 20; page++) {
    const url = new URL(`${BORROW_KIT_API}/loans`);
    url.searchParams.set("walletAddress", wallet);
    url.searchParams.set("chain", "ARC");
    if (pageAfter) url.searchParams.set("pageAfter", pageAfter);
    const res = await fetchImpl(url.toString());
    if (!res.ok) throw new Error(`Borrow Kit answered ${res.status} when asked for this wallet's loans`);
    const body = await res.json();
    /** @type {any[]} */
    const loans = Array.isArray(body?.data?.loans) ? body.data.loans : [];
    const loan = loans.find((l) => typeof l?.loanId === "string" && String(l.marketId).toLowerCase() === market.toLowerCase() && l.status !== "closed");
    if (loan) return loan;
    pageAfter = typeof body?.data?.pagination?.pageAfter === "string" ? body.data.pagination.pageAfter : undefined;
    if (!pageAfter) return undefined;
  }
  return undefined;
}

/**
 * EIP-712 typed data for Borrow Kit's `WebhookRegistration`, ready for `eth_signTypedData_v4`: the owner of `loanId`
 * asks Borrow Kit to send the loan's health-band alerts to `webhookUrl` (https, or "" to stop them). Same domain,
 * types and message as Circle's SDK (`@circle-fin/provider-borrow-service`); the domain has no verifying contract
 * because Circle checks the signature off-chain. Signing it sends no transaction and costs no gas.
 * @param {{ loanId: string, owner: string, webhookUrl: string, deadline: number, chainId?: number }} p
 */
export function webhookRegistration({ loanId, owner, webhookUrl, deadline, chainId = ARC.chainId }) {
  return {
    domain: { name: "BorrowKit Webhook Registration", version: "1", chainId },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      WebhookRegistration: [
        { name: "loanId", type: "string" },
        { name: "owner", type: "address" },
        { name: "webhookUrl", type: "string" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "WebhookRegistration",
    message: { loanId, owner, webhookUrl, deadline },
  };
}

/**
 * Sends a signed `WebhookRegistration` to Borrow Kit, as the SDK's `registerWebhook` does.
 * @param {typeof fetch} fetchImpl
 * @param {{ loanId: string, webhookUrl: string, deadline: number, signature: string }} p
 * @returns {Promise<{ loanId: string, webhookUrl: string | null }>}
 */
export async function postWebhookRegistration(fetchImpl, { loanId, webhookUrl, deadline, signature }) {
  const res = await fetchImpl(`${BORROW_KIT_API}/loans/${encodeURIComponent(loanId)}/webhookRegistration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ webhookUrl, deadline, walletSignature: signature }),
  });
  if (res.status === 404) throw new Error("Borrow Kit has no loan with this id");
  if (res.status === 401) throw new Error("Borrow Kit didn't accept the signature (it must come from the loan's owner)");
  if (!res.ok) throw new Error(`Borrow Kit answered ${res.status}`);
  const body = await res.json();
  if (typeof body?.data?.loanId !== "string") throw new Error("Borrow Kit's answer had no loan id");
  return { loanId: body.data.loanId, webhookUrl: body.data.webhookUrl ?? null };
}
