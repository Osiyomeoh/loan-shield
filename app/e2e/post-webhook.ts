// Calls the Vercel handler in api/webhook.ts in-process with a Borrow Kit-shaped notification, as Circle would POST
// it, and prints the response. Used by scripts/e2e-local.sh against a local fork.
//   tsx e2e/post-webhook.ts <event_id> <threshold> <walletAddress>
import { POST } from "../api/webhook.js";

const [eventId, threshold, walletAddress] = process.argv.slice(2);
if (!eventId || !threshold || !walletAddress) throw new Error("usage: post-webhook.ts <event_id> <threshold> <walletAddress>");

const body = {
  subscriptionId: "5d0f3b2a-8c41-5e7b-b9d2-3a6e1f4c7b80",
  notificationId: crypto.randomUUID(),
  notificationType: "morpho.healthBandCrossed",
  notification: {
    domain: "26",
    event_id: eventId,
    loan_id: "11111111-1111-4111-8111-111111111111",
    previous_threshold: "SAFE",
    resourceId: "11111111-1111-4111-8111-111111111111",
    source_block_number: 0,
    threshold,
    walletAddress,
  },
  timestamp: new Date().toISOString(),
  version: 2,
};

const res = await POST(new Request("http://localhost/api/webhook", { method: "POST", body: JSON.stringify(body) }));
console.log(res.status, JSON.stringify(await res.json()));
