// Vercel Function (Node.js runtime, Web handler signature): totals for the home page, rebuilt from the shield's
// full event history on Arc (src/registry.ts). Cached at Vercel's edge for 2 minutes, so a busy page costs the
// public RPC one scan per 2 minutes. Env: SHIELD_ADDRESS, optional ARC_RPC_URL.
import { formatUnits } from "viem";
import { publicClient } from "../src/chain.js";
import { parseAddress, requireEnv, USDC_DECIMALS } from "../src/config.js";
import { firstBlock, scanShieldEvents, shieldLogs, summarize } from "../src/registry.js";

export async function GET(): Promise<Response> {
  try {
    const shield = parseAddress(requireEnv("SHIELD_ADDRESS"), "SHIELD_ADDRESS");
    const client = publicClient();
    const latest = await client.getBlockNumber();
    const stats = summarize(await scanShieldEvents(shieldLogs(client, shield), await firstBlock(client, shield, latest), latest));
    return Response.json(
      {
        ok: true,
        shield,
        block: Number(latest),
        loansProtected: stats.loansProtected,
        policies: stats.policies,
        usdcOnStandby: formatUnits(stats.usdcOnStandby, USDC_DECIMALS),
        rescues: stats.rescues,
        repaidByRescues: formatUnits(stats.repaidByRescues, USDC_DECIMALS),
      },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=600" } },
    );
  } catch (err) {
    console.error(err);
    return Response.json({ ok: false, error: "could not read the chain" }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
