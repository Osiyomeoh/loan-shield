// The site's keyless Borrow Kit request (public/shield.js), checked against Circle's own SDK: the same wallet and
// inputs must produce the same signature, URL and body as `BorrowKit.registerWebhook`. No network: fetch is stubbed.
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2/next";
import { BorrowKit } from "@circle-fin/borrow-kit";
import { recoverTypedDataAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import * as web from "../public/shield.js";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Captured {
  url: string;
  method: string;
  contentType: string | null;
  body: Record<string, unknown>;
}

/** A fetch that records every request and answers a webhook registration the way Borrow Kit does. */
function recordingFetch(): { fetch: typeof fetch; requests: Captured[] } {
  const requests: Captured[] = [];
  const stub = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    requests.push({ url, method: init?.method ?? "GET", contentType: new Headers(init?.headers).get("content-type"), body });
    const loanId = decodeURIComponent(url.split("/loans/")[1]?.split("/")[0] ?? "");
    return Response.json({ data: { loanId, webhookUrl: body.webhookUrl } });
  };
  return { fetch: stub as typeof fetch, requests };
}

const LOAN_ID = "ac7209cf-003e-57f3-8f0a-2e100afb2225";
const HOOK = "https://loan-shield-theta.vercel.app/api/webhook";

test("the site's webhook registration matches Circle's SDK: same signature, URL and body", async () => {
  const key = generatePrivateKey();
  const owner = privateKeyToAccount(key);
  const deadline = Math.floor(Date.now() / 1000) + web.WEBHOOK_DEADLINE_SECONDS;

  // Circle's SDK, signing with the throwaway key.
  const sdk = recordingFetch();
  globalThis.fetch = sdk.fetch;
  const adapter = createViemAdapterFromPrivateKey({ privateKey: key });
  const result = await new BorrowKit().registerWebhook({ from: { adapter, chain: "Arc" }, loanId: LOAN_ID, webhookUrl: HOOK, deadline });
  assert.deepEqual(result, { loanId: LOAN_ID, webhookUrl: HOOK });
  // The SDK also posts a usage log to /v1/stablecoinKits/logs; the site sends only the registration.
  const registrations = sdk.requests.filter((r) => r.url.endsWith("/webhookRegistration"));
  assert.equal(registrations.length, 1, "the SDK sends one registration");

  // The site: build typed data, sign as a wallet would with eth_signTypedData_v4, post.
  const typed = web.webhookRegistration({ loanId: LOAN_ID, owner: owner.address, webhookUrl: HOOK, deadline });
  const { EIP712Domain: _, ...types } = typed.types;
  const signature = await owner.signTypedData({ domain: typed.domain, types, primaryType: "WebhookRegistration", message: typed.message });
  const site = recordingFetch();
  assert.deepEqual(await web.postWebhookRegistration(site.fetch, { loanId: LOAN_ID, webhookUrl: HOOK, deadline, signature }), {
    loanId: LOAN_ID,
    webhookUrl: HOOK,
  });

  assert.equal(signature, registrations[0]!.body.walletSignature, "ECDSA signatures are deterministic: same typed data, same bytes");
  assert.equal(site.requests.length, 1);
  assert.deepEqual(site.requests[0], registrations[0]);
  assert.equal(site.requests[0]!.url, `https://api.circle.com/v1/borrowKit/loans/${LOAN_ID}/webhookRegistration`);
  assert.equal(site.requests[0]!.contentType, "application/json");
  assert.equal(await recoverTypedDataAddress({ ...typed, types, primaryType: "WebhookRegistration", signature: signature as Hex }), owner.address);
});

test("the EIP712Domain list sent to wallets is the one viem derives for this domain", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const typed = web.webhookRegistration({ loanId: LOAN_ID, owner: owner.address, webhookUrl: HOOK, deadline: 1_800_000_000 });
  const { EIP712Domain: domainTypes, ...types } = typed.types;
  // With an explicit EIP712Domain list, viem hashes with that list; it must not change the signature.
  const explicit = await owner.signTypedData({ ...typed, types: typed.types, primaryType: "WebhookRegistration" } as never);
  const derived = await owner.signTypedData({ domain: typed.domain, types, primaryType: "WebhookRegistration", message: typed.message });
  assert.equal(explicit, derived);
  assert.deepEqual(domainTypes.map((t) => t.name), ["name", "version", "chainId"]);
});

test("findBorrowKitLoan asks Borrow Kit like the SDK, follows pages and skips closed loans and other markets", async () => {
  const wallet = "0xf5C4c6528d214eaddf0e7e5e64D07Ab7dC321920";
  const urls: string[] = [];
  const pages: Record<string, unknown>[] = [
    { loans: [{ loanId: "a", marketId: "0x" + "11".repeat(32), status: "active" }, { loanId: "b", marketId: web.CIRBTC_MARKET, status: "closed" }], pagination: { pageAfter: "cursor-1" } },
    { loans: [{ loanId: LOAN_ID, marketId: web.CIRBTC_MARKET.toUpperCase().replace("0X", "0x"), status: "active", healthFactorBand: "SAFE" }], pagination: {} },
  ];
  const stub = (async (input: string) => {
    urls.push(String(input));
    return Response.json({ data: pages[urls.length - 1] });
  }) as typeof fetch;
  const loan = await web.findBorrowKitLoan(stub, wallet);
  assert.equal(loan?.loanId, LOAN_ID);
  assert.deepEqual(urls, [
    `https://api.circle.com/v1/borrowKit/loans?walletAddress=${wallet}&chain=ARC`,
    `https://api.circle.com/v1/borrowKit/loans?walletAddress=${wallet}&chain=ARC&pageAfter=cursor-1`,
  ]);
});

test("findBorrowKitLoan returns undefined for a wallet with no Borrow Kit loan, and throws on an API error", async () => {
  const empty = (async () => Response.json({ data: { loans: [], pagination: {} } })) as unknown as typeof fetch;
  assert.equal(await web.findBorrowKitLoan(empty, "0x1111111111111111111111111111111111111111"), undefined);
  const down = (async () => new Response("busy", { status: 503 })) as unknown as typeof fetch;
  await assert.rejects(web.findBorrowKitLoan(down, "0x1111111111111111111111111111111111111111"), /answered 503/);
});

test("postWebhookRegistration explains Borrow Kit's refusals", async () => {
  const answer = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
  const p = { loanId: LOAN_ID, webhookUrl: HOOK, deadline: 1, signature: "0x" };
  await assert.rejects(web.postWebhookRegistration(answer(404), p), /no loan with this id/);
  await assert.rejects(web.postWebhookRegistration(answer(401), p), /signature/);
  await assert.rejects(web.postWebhookRegistration(answer(500), p), /answered 500/);
});
