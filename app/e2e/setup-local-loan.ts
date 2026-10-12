// Prepares a LOCAL Arc mainnet fork (arc-anvil) for the end-to-end run in ../../scripts/e2e-local.sh:
// fresh throwaway keys, a real loan in the real USDC/cirBTC Morpho market at HF ≈ 1.6, and a freshly deployed
// LoanShield. Prints the environment for the app scripts as KEY=value lines. Refuses any non-local RPC.
import { readFileSync } from "node:fs";
import { createPublicClient, createTestClient, createWalletClient, erc20Abi, http, parseAbi, parseUnits, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { withHeadroom } from "../src/chain.js";
import { arc, CIRBTC, CIRBTC_MARKET, MORPHO, USDC } from "../src/config.js";

const rpc = process.env.ARC_RPC_URL ?? "";
if (!/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(rpc)) throw new Error(`refusing non-local ARC_RPC_URL: ${rpc}`);

const morphoAbi = parseAbi([
  "function idToMarketParams(bytes32 id) view returns ((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv))",
  "function supplyCollateral((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, address onBehalf, bytes data)",
  "function borrow((address loanToken, address collateralToken, address oracle, address irm, uint256 lltv) marketParams, uint256 assets, uint256 shares, address onBehalf, address receiver) returns (uint256, uint256)",
]);
const oracleAbi = parseAbi(["function price() view returns (uint256)"]);

const COLLATERAL = 1_000_000n; // 0.01 cirBTC (8 decimals)
const START_HF = 16n * 10n ** 17n; // 1.6

const client = createPublicClient({ chain: arc, transport: http(rpc) });
const test = createTestClient({ chain: arc, mode: "anvil", transport: http(rpc) });

const borrowerKey = generatePrivateKey();
const keeperKey = generatePrivateKey();
const borrower = privateKeyToAccount(borrowerKey);
const keeper = privateKeyToAccount(keeperKey);
const asBorrower = createWalletClient({ account: borrower, chain: arc, transport: http(rpc) });
const asKeeper = createWalletClient({ account: keeper, chain: arc, transport: http(rpc) });

async function mined(hash: Hex) {
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return receipt;
}

// USDC is Arc's native coin, so a native balance is a USDC balance (18 decimals natively, 6 through the ERC-20).
await test.setBalance({ address: borrower.address, value: parseUnits("100", 18) });
await test.setBalance({ address: keeper.address, value: parseUnits("1", 18) });

// Give the borrower cirBTC by writing its balance slot, found from the storage keys balanceOf reads.
const { accessList } = await client.createAccessList({
  to: CIRBTC,
  data: "0x70a08231" + borrower.address.slice(2).toLowerCase().padStart(64, "0") as Hex,
});
const slots = accessList.filter((e) => e.address.toLowerCase() === CIRBTC.toLowerCase()).flatMap((e) => e.storageKeys);
let funded = false;
for (const slot of slots) {
  const before = await client.getStorageAt({ address: CIRBTC, slot });
  await test.setStorageAt({ address: CIRBTC, index: slot, value: `0x${COLLATERAL.toString(16).padStart(64, "0")}` });
  // A wrong slot can be the proxy's implementation slot, which makes the call itself fail.
  const balance = await client
    .readContract({ address: CIRBTC, abi: erc20Abi, functionName: "balanceOf", args: [borrower.address] })
    .catch(() => undefined);
  if (balance === COLLATERAL) {
    funded = true;
    break;
  }
  await test.setStorageAt({ address: CIRBTC, index: slot, value: before ?? "0x0" });
}
if (!funded) throw new Error("could not find cirBTC's balance slot");

// Open the loan the way Borrow Kit leaves it: collateral and debt on the wallet itself.
const params = await client.readContract({ address: MORPHO, abi: morphoAbi, functionName: "idToMarketParams", args: [CIRBTC_MARKET] });
const price = await client.readContract({ address: params.oracle, abi: oracleAbi, functionName: "price" });
const maxBorrow = (((COLLATERAL * price) / 10n ** 36n) * params.lltv) / 10n ** 18n;
const borrowAmount = (maxBorrow * 10n ** 18n) / START_HF;

await mined(await asBorrower.writeContract({ address: CIRBTC, abi: erc20Abi, functionName: "approve", args: [MORPHO, COLLATERAL] }));
await mined(await asBorrower.writeContract({ address: MORPHO, abi: morphoAbi, functionName: "supplyCollateral", args: [params, COLLATERAL, borrower.address, "0x"] }));
const borrow = { address: MORPHO, abi: morphoAbi, functionName: "borrow", args: [params, borrowAmount, 0n, borrower.address, borrower.address], account: borrower } as const;
await mined(await asBorrower.writeContract({ ...borrow, gas: withHeadroom(await client.estimateContractGas(borrow)) }));

// Deploy LoanShield from the Foundry build, from the keeper's throwaway key (the contract has no owner).
const artifact = JSON.parse(readFileSync(new URL("../../out/LoanShield.sol/LoanShield.json", import.meta.url), "utf8"));
const deployTx = await asKeeper.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args: [MORPHO, USDC] });
const { contractAddress } = await mined(deployTx);
if (!contractAddress) throw new Error("no contract address in deploy receipt");

console.log(`SHIELD_ADDRESS=${contractAddress}`);
console.log(`BORROWER=${borrower.address}`);
console.log(`PRIVATE_KEY=${borrowerKey}`);
console.log(`KEEPER_PRIVATE_KEY=${keeperKey}`);
console.log(`WATCH=${borrower.address}:${CIRBTC_MARKET}`);
console.log(`BORROWED_USDC=${borrowAmount}`);
