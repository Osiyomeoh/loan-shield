// Vercel Function (Node.js runtime, Web handler signature): receives Borrow Kit health-band notifications.
// Env: SHIELD_ADDRESS; optional WATCH (loans checked on every notification), ALERT_MARKETS (markets in which the
// notification's wallet is checked; default the cirBTC market, "none" for none), KEEPER_PRIVATE_KEY (without it
// the endpoint checks but never sends) and ARC_RPC_URL. See src/webhook.ts for why the payload is never trusted.
import { formatUnits } from "viem";
import { createShieldChain } from "../src/chain.js";
import { HOSTED_MIN_REPAY, parseAddress, parseMarketList, parsePrivateKey, parseWatchList, requireEnv, USDC_DECIMALS } from "../src/config.js";
import { handleWebhook, RecentIds, type WebhookDeps } from "../src/webhook.js";

let deps: WebhookDeps | undefined;

function getDeps(): WebhookDeps {
  if (deps) return deps;
  const keeperKey = process.env.KEEPER_PRIVATE_KEY?.trim();
  const chain = createShieldChain({
    shield: parseAddress(requireEnv("SHIELD_ADDRESS"), "SHIELD_ADDRESS"),
    keeperKey: keeperKey ? parsePrivateKey(keeperKey, "KEEPER_PRIVATE_KEY") : undefined,
  });
  deps = {
    chain,
    watch: parseWatchList(process.env.WATCH ?? ""),
    markets: parseMarketList(process.env.ALERT_MARKETS),
    seen: new RecentIds(),
    send: !!keeperKey,
    minRepay: HOSTED_MIN_REPAY,
    log: console.log,
  };
  return deps;
}

export async function POST(request: Request): Promise<Response> {
  const { status, body } = await handleWebhook(await request.text(), getDeps());
  return Response.json(body, { status });
}

export function GET(): Response {
  const { watch, markets, send, minRepay } = getDeps();
  return Response.json({
    ok: true,
    watching: watch.length,
    alertWallets: markets.length > 0,
    markets,
    sends: send,
    minRepayUsdc: formatUnits(minRepay ?? 0n, USDC_DECIMALS),
  });
}
