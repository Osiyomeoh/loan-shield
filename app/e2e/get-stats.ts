// Calls the Vercel handler in api/stats.ts in-process, prints its JSON, and checks the USDC on standby against the
// borrower's buffer on chain (the e2e shield has one owner). Used by scripts/e2e-local.sh against a local fork.
//   tsx e2e/get-stats.ts
import { formatUnits } from "viem";
import { GET } from "../api/stats.js";
import { loanShieldAbi } from "../src/abi.js";
import { publicClient } from "../src/chain.js";
import { parseAddress, requireEnv, USDC_DECIMALS } from "../src/config.js";

const res = await GET();
const body = await res.json();
console.log(res.status, JSON.stringify(body));
const shield = parseAddress(requireEnv("SHIELD_ADDRESS"), "SHIELD_ADDRESS");
const borrower = parseAddress(requireEnv("BORROWER"), "BORROWER");
const buffer = await publicClient().readContract({ address: shield, abi: loanShieldAbi, functionName: "buffer", args: [borrower] });
console.log(`standby ${body.usdcOnStandby} USDC, buffer on chain ${formatUnits(buffer, USDC_DECIMALS)} USDC: ${body.usdcOnStandby === formatUnits(buffer, USDC_DECIMALS) ? "match" : "MISMATCH"}`);
