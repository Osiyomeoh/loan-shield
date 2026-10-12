// LOCAL fork only: the e2e borrower (PRIVATE_KEY) borrows more in the cirBTC market until the health factor is
// about <target>, putting a rescued loan back in danger so scripts/e2e-local.sh can test the webhook path.
//   tsx e2e/borrow-more.ts <target health factor>
import { createWalletClient, http, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { loanShieldAbi } from "../src/abi.js";
import { publicClient, withHeadroom } from "../src/chain.js";
import { arc, CIRBTC_MARKET, formatWad, MORPHO, parseAddress, parsePrivateKey, requireEnv, rpcUrl } from "../src/config.js";

const rpc = rpcUrl();
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpc)) throw new Error(`refusing non-local ARC_RPC_URL: ${rpc}`);

const morphoAbi = parseAbi([
  "function idToMarketParams(bytes32 id) view returns ((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv))",
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
]);
const oracleAbi = parseAbi(["function price() view returns (uint256)"]);

const target = parseUnits(process.argv[2] ?? "", 18);
if (target <= 10n ** 18n) throw new Error("usage: borrow-more.ts <target health factor above 1>");
const shield = parseAddress(requireEnv("SHIELD_ADDRESS"), "SHIELD_ADDRESS");
const borrower = privateKeyToAccount(parsePrivateKey(requireEnv("PRIVATE_KEY"), "PRIVATE_KEY"));
const client = publicClient(rpc);
const wallet = createWalletClient({ account: borrower, chain: arc, transport: http(rpc) });

const read = () => client.readContract({ address: shield, abi: loanShieldAbi, functionName: "healthFactor", args: [borrower.address, CIRBTC_MARKET] });
const params = await client.readContract({ address: MORPHO, abi: morphoAbi, functionName: "idToMarketParams", args: [CIRBTC_MARKET] });
const [, , collateral] = await client.readContract({ address: MORPHO, abi: morphoAbi, functionName: "position", args: [CIRBTC_MARKET, borrower.address] });
const price = await client.readContract({ address: params.oracle, abi: oracleAbi, functionName: "price" });
const before = await read();

// HF = maxBorrow / debt, so debt = maxBorrow / HF; borrow the difference between the debt at <target> and now.
const maxBorrow = (((collateral * price) / 10n ** 36n) * params.lltv) / 10n ** 18n;
const extra = (maxBorrow * 10n ** 18n) / target - (maxBorrow * 10n ** 18n) / before;
if (extra <= 0n) throw new Error(`health factor ${formatWad(before)} is already at or below ${formatWad(target)}`);

const borrow = { address: MORPHO, abi: morphoAbi, functionName: "borrow", args: [params, extra, 0n, borrower.address, borrower.address], account: borrower } as const;
const gas = await client.estimateContractGas(borrow);
const hash = await wallet.writeContract({ ...borrow, gas: withHeadroom(gas) });
const receipt = await client.waitForTransactionReceipt({ hash });
if (receipt.status !== "success") throw new Error(`borrow reverted: ${hash}`);
console.log(`borrowed ${extra} more (6 decimals): HF ${formatWad(before)} → ${formatWad(await read())}`);
