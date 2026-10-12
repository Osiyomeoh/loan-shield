// Runs the web page's chain reader (public/shield.js) against the e2e fork, the same calls the browser makes.
//   tsx e2e/web-read.ts   (env from scripts/e2e-local.sh: ARC_RPC_URL, SHIELD_ADDRESS, BORROWER)
import { requireEnv } from "../src/config.js";
import * as web from "../public/shield.js";

const rpc = web.createRpc(requireEnv("ARC_RPC_URL"));
const loan = { shield: requireEnv("SHIELD_ADDRESS"), borrower: requireEnv("BORROWER"), market: web.CIRBTC_MARKET };

const latest = await rpc.blockNumber();
const market = await web.readMarket(rpc);
const state = await web.readLoan(rpc, loan, market);
const sim = await web.simulateRescue(rpc, loan);
const deployedAt = await web.findDeployBlock(rpc, loan.shield, latest);
const history = await web.rescueHistory(rpc, { ...loan, fromBlock: deployedAt, toBlock: latest });

console.log(`market: ${web.formatUnits(market.totalBorrowAssets, 6, 0)} USDC borrowed, BTC $${web.collateralPrice(market)}, penalty ${((web.liquidationIncentive(market.lltv) - 1) * 100).toFixed(2)}%`);
console.log(`loan: HF ${web.formatWad(state.healthFactor)}, buffer ${web.formatUnits(state.buffer, 6, 2)} USDC, policy ${web.formatWad(state.trigger)} → ${web.formatWad(state.target)}, preview ${state.preview.status}`);
console.log(sim.ok ? `simulate: would repay ${web.formatUnits(sim.assets, 6, 2)}` : `simulate: reverts ${sim.name}(${sim.args.map((a) => web.formatWad(a)).join(", ")})`);
console.log(`deployed at block ${deployedAt}; history: ${history.length} rescue(s)`);
for (const r of history) console.log(`  block ${r.blockNumber}: repaid ${web.formatUnits(r.assets, 6, 2)} USDC, HF ${web.formatWad(r.healthFactorBefore)} → ${web.formatWad(r.healthFactorAfter)}, tx ${r.transactionHash}`);
