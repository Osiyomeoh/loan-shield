// Vercel Function (Node.js runtime, Web handler signature): receives Borrow Kit health-band notifications.
// Env: SHIELD_ADDRESS, WATCH, optional KEEPER_PRIVATE_KEY (without it the endpoint checks but never sends)
// and ARC_RPC_URL. See src/webhook.ts for why the payload is never trusted.
import { createShieldChain } from "../src/chain.js";
import { parseAddress, parsePrivateKey, parseWatchList, requireEnv } from "../src/config.js";
import { handleWebhook, RecentIds, type WebhookDeps } from "../src/webhook.js";

let deps: WebhookDeps | undefined;

function getDeps(): WebhookDeps {
  if (deps) return deps;
  const keeperKey = process.env.KEEPER_PRIVATE_KEY?.trim();
  const chain = createShieldChain({
    shield: parseAddress(requireEnv("SHIELD_ADDRESS"), "SHIELD_ADDRESS"),
    keeperKey: keeperKey ? parsePrivateKey(keeperKey, "KEEPER_PRIVATE_KEY") : undefined,
  });
  deps = { chain, watch: parseWatchList(requireEnv("WATCH")), seen: new RecentIds(), send: !!keeperKey, log: console.log };
  return deps;
}

export async function POST(request: Request): Promise<Response> {
  const { status, body } = await handleWebhook(await request.text(), getDeps());
  return Response.json(body, { status });
}

export function GET(): Response {
  const { watch, send } = getDeps();
  return Response.json({ ok: true, watching: watch.length, sends: send });
}
