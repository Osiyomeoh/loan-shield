// Read-only check of the web page's chain reader (public/shield.js) against Arc mainnet itself, for what a local fork
// can't show: the public RPC's eth_getLogs range limit, archive state for findDeployBlock, and live market data.
// Sends nothing and needs no key. With SHIELD_ADDRESS and BORROWER set, it also reads that loan and its rescues.
//   tsx e2e/mainnet-read.ts
import * as web from "../public/shield.js";

const rpc = web.createRpc(web.ARC.rpc);
const latest = await rpc.blockNumber();
const market = await web.readMarket(rpc);
console.log(`Arc mainnet block ${latest}: ${web.formatUnits(market.totalBorrowAssets, 6, 0)} USDC borrowed in the cirBTC market, BTC $${web.collateralPrice(market)}`);

// Two full-size chunks ending at the head; rescueHistory throws if the RPC refuses a MAX_LOG_RANGE span.
const probe = await web.rescueHistory(rpc, { shield: web.MORPHO, fromBlock: latest - 2n * web.MAX_LOG_RANGE + 1n, toBlock: latest });
console.log(`eth_getLogs: 2 chunks of ${web.MAX_LOG_RANGE} blocks accepted (${probe.length} Rescued logs from Morpho, as expected)`);

const morphoFrom = await web.findDeployBlock(rpc, web.MORPHO, latest);
console.log(`archive state: Morpho Blue has code from block ${morphoFrom}`);

const shield = process.env.SHIELD_ADDRESS?.trim();
const borrower = process.env.BORROWER?.trim();
if (shield && borrower) {
  const loan = { shield, borrower, market: web.CIRBTC_MARKET };
  const state = await web.readLoan(rpc, loan, market);
  const sim = await web.simulateRescue(rpc, loan);
  const deployedAt = await web.findDeployBlock(rpc, shield, latest);
  const history = await web.rescueHistory(rpc, { ...loan, fromBlock: deployedAt, toBlock: latest });
  console.log(`loan: HF ${web.formatWad(state.healthFactor)}, buffer ${web.formatUnits(state.buffer, 6, 2)} USDC, policy ${web.formatWad(state.trigger)} → ${web.formatWad(state.target)}, preview ${state.preview.status}`);
  console.log(sim.ok ? `simulate: would repay ${web.formatUnits(sim.assets, 6, 2)}` : `simulate: reverts ${sim.name}`);
  console.log(`shield deployed at block ${deployedAt}; history: ${history.length} rescue(s)`);
}
