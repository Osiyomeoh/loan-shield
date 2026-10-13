// Browser end-to-end check of the My loan page (/app) against a LOCAL arc-anvil fork, in Chrome through Playwright.
// A test EIP-1193 wallet, announced through EIP-6963, forwards every call to the fork, where the borrower is
// impersonated, so eth_sendTransaction needs no key. Each owner action is then checked on-chain.
// Run it through scripts/e2e-browser.sh, which starts the fork and the site and opens the loan.
// Env: ARC_RPC_URL, SITE, SHIELD_ADDRESS, BORROWER. Optional argument: a directory for screenshots.
import { mkdirSync } from "node:fs";
import { chromium } from "playwright-core";
import * as web from "../../public/shield.js";

const outDir = process.argv[2];
const need = (name) => process.env[name] || (console.error(`${name} is not set`), process.exit(2));
const RPC = need("ARC_RPC_URL");
const SITE = need("SITE");
const shield = need("SHIELD_ADDRESS");
const borrower = need("BORROWER");
if (outDir) mkdirSync(outDir, { recursive: true });
const rpc = web.createRpc(RPC);
const raw = async (method, params = []) => {
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
};

// Impersonation only exists on a local fork; refuse anything else before sending a request.
if (!/^http:\/\/127\.0\.0\.1:/.test(RPC)) throw new Error("ARC_RPC_URL must be a local fork");
if ((await raw("eth_chainId")) !== "0x13b2") throw new Error("the fork is not chain 5042");
await raw("anvil_impersonateAccount", [borrower]);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
};
const state = async () => {
  const m = await web.readMarket(rpc, web.CIRBTC_MARKET);
  const s = await web.readLoan(rpc, { shield, borrower, market: web.CIRBTC_MARKET }, m);
  const w = await web.readWallet(rpc, { shield, owner: borrower });
  return { ...s, ...w };
};

function wallet({ rpc, account }) {
  let id = 0;
  // Like a real wallet, it remembers the site's permission and its network across reloads.
  const mem = { get: (k, d) => sessionStorage.getItem(`e2e:${k}`) ?? d, set: (k, v) => sessionStorage.setItem(`e2e:${k}`, v) };
  let connected = mem.get("connected", "") === "1";
  let chain = mem.get("chain", "0x1");
  const listeners = {};
  const emit = (ev, v) => (listeners[ev] || []).forEach((f) => f(v));
  const call = async (method, params = []) => {
    const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) });
    const j = await res.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code, data: j.error.data });
    return j.result;
  };
  window.__sent = [];
  const provider = {
    async request({ method, params }) {
      switch (method) {
        case "eth_requestAccounts":
          connected = true;
          mem.set("connected", "1");
          return [account];
        case "eth_accounts":
          return connected ? [account] : [];
        case "eth_chainId":
          return chain;
        case "wallet_switchEthereumChain":
          chain = params[0].chainId;
          mem.set("chain", chain);
          setTimeout(() => emit("chainChanged", chain), 10);
          return null;
        case "wallet_revokePermissions":
          connected = false;
          mem.set("connected", "");
          return null;
        case "eth_sendTransaction": {
          if (window.__reject) throw Object.assign(new Error("User rejected the request."), { code: 4001 });
          const [tx] = params;
          window.__sent.push(tx);
          return call("eth_sendTransaction", [{ from: tx.from, to: tx.to, data: tx.data }]);
        }
        default:
          return call(method, params || []);
      }
    },
    on(ev, fn) {
      (listeners[ev] ||= []).push(fn);
    },
    removeListener(ev, fn) {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
    },
  };
  const detail = Object.freeze({ info: { uuid: "e2e-wallet", name: "Test wallet (local fork)", icon: "", rdns: "e2e.test" }, provider });
  window.addEventListener("eip6963:requestProvider", () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail })));
  window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail }));
}

const browser = await chromium.launch({ channel: "chrome" });
const errors = [];
async function page(scheme, width) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1 });
  await ctx.addInitScript(wallet, { rpc: RPC, account: borrower });
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  p.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  return p;
}
const url = `${SITE}/app?rpc=${encodeURIComponent(RPC)}&shield=${shield}`;
// Screenshots wait for the entrance animations to settle.
const shot = async (p, name, fullPage = false) => {
  if (!outDir) return;
  await p.waitForTimeout(700);
  await p.screenshot({ path: `${outDir}/${name}.png`, fullPage });
};
const until = (p, text, timeout = 30_000) => p.getByText(text, { exact: false }).first().waitFor({ timeout });

const p = await page("dark", 1440);
await p.goto(url);
await until(p, "Protect your Borrow Kit loan");
check("not connected: connect card", true);
await shot(p, "1-connect-dark-1440");

await p.getByRole("button", { name: /Test wallet/ }).click();
await until(p, "Switch your wallet to Arc");
check("wrong chain: switch card", true);
await p.getByRole("button", { name: "Switch to Arc" }).click();
await until(p, "Turn on protection");
check("connected on Arc: loan found, protect card shown", true);
await p.locator(".protect input").first().waitFor();
const before = await state();
const prefilled = await p.locator(".protect .amount input").inputValue();
check("amount prefilled with the next rescue", prefilled !== "", `prefilled ${prefilled} USDC, debt ${web.formatUnits(before.debt, 6, 2)}`);
await p.locator(".protect-card").scrollIntoViewIfNeeded();
await shot(p, "2-protect-dark-1440");

// Use 5 USDC with the Balanced preset.
await p.locator(".protect .amount input").fill("5");
await p.getByRole("radio", { name: /Balanced/ }).click();
await p.getByRole("button", { name: /Review 3 steps/ }).click();
await until(p, "Allow Loan Shield to take 5 USDC");
check("review lists approve, deposit, policy", (await p.locator(".txsteps li").count()) === 3);
await shot(p, "3-review-dark-1440");
await p.getByRole("button", { name: /Confirm 3 steps in wallet/ }).click();
await until(p, "Protection is on", 60_000);
let s = await state();
check("protect: buffer +5 USDC on chain", s.buffer - before.buffer === 5_000_000n, `buffer ${web.formatUnits(s.buffer, 6, 6)}`);
check("protect: policy 1.30 → 1.80 on chain", s.trigger === 13n * 10n ** 17n && s.target === 18n * 10n ** 17n);
check("protect: approval used up exactly", s.allowance === 0n, `allowance ${s.allowance}`);
await until(p, "Manage protection");
check("protected: manage panel shown", true);
await p.locator(".manage").scrollIntoViewIfNeeded();
await shot(p, "4-manage-dark-1440");

// Withdraw half.
await p.getByRole("tab", { name: "Withdraw" }).click();
await p.getByRole("button", { name: "50%" }).click();
await p.locator(".manage").getByRole("button", { name: /^Review/ }).click();
await p.getByRole("button", { name: "Confirm in wallet" }).click();
await until(p, "All done", 60_000);
let s2 = await state();
check("withdraw 50%: buffer halved on chain", s2.buffer === s.buffer - s.buffer / 2n, `buffer ${web.formatUnits(s2.buffer, 6, 6)}`);
await p.locator(".manage").getByRole("button", { name: "Close" }).click();

// Change policy to Early, declining once first.
await p.getByRole("tab", { name: "Change policy" }).click();
await p.getByRole("radio", { name: /Early/ }).click();
await p.locator(".manage").getByRole("button", { name: /Review 1 step/ }).click();
await p.evaluate(() => (window.__reject = true));
await p.getByRole("button", { name: "Confirm in wallet" }).click();
await until(p, "You declined it in your wallet.");
check("declined in wallet: says so and offers Try again", await p.getByRole("button", { name: /Try again/ }).isVisible());
await shot(p, "5-declined-dark-1440");
await p.evaluate(() => (window.__reject = false));
await p.getByRole("button", { name: /Try again/ }).click();
await until(p, "All done", 60_000);
s = await state();
check("change policy: 1.50 → 2.00 on chain", s.trigger === 15n * 10n ** 17n && s.target === 2n * 10n ** 18n);
// Close and reopen the same tab at once: it must come back as a fresh form, not the finished one.
await p.getByRole("tab", { name: "Change policy" }).click();
await p.getByRole("tab", { name: "Change policy" }).click();

// A policy the contract would refuse never gets to the wallet: the form blocks it.
await p.getByRole("radio", { name: /Custom/ }).click();
await p.getByLabel("Rescue below health factor").fill("0.9");
await until(p, "the trigger must be above 1.00");
check("invalid policy blocked in the form", await p.locator(".manage").getByRole("button", { name: /^Review/ }).isDisabled());
await p.locator(".manage").getByRole("button", { name: "Cancel" }).click();

// Add 1 USDC: approve + deposit again.
await p.getByRole("tab", { name: "Add USDC" }).click();
await p.locator(".manage .amount input").fill("1");
await p.locator(".manage").getByRole("button", { name: /Review 2 steps/ }).click();
await p.getByRole("button", { name: /Confirm 2 steps in wallet/ }).click();
await until(p, "All done", 60_000);
s2 = await state();
check("add 1 USDC: buffer +1 on chain", s2.buffer - s.buffer === 1_000_000n);
await p.locator(".manage").getByRole("button", { name: "Close" }).click();

// Turn off and withdraw everything.
await p.getByRole("tab", { name: "Turn off" }).click();
await until(p, "Also withdraw the");
await shot(p, "6-turnoff-dark-1440");
await p.locator(".manage").getByRole("button", { name: /^Review/ }).click();
await p.getByRole("button", { name: /Confirm 2 steps in wallet/ }).click();
await until(p, "Protection is off", 60_000);
s = await state();
check("turn off: no policy and empty buffer on chain", s.trigger === 0n && s.buffer === 0n);
await until(p, "Turn on protection");
check("after turning off: protect card is back", true);

// Every transaction went to USDC or the shield, from the borrower.
const sent = await p.evaluate(() => window.__sent);
const targets = new Set(sent.map((t) => t.to.toLowerCase()));
check(
  "wallet only saw transactions to USDC or the shield, from the borrower",
  [...targets].every((t) => t === web.USDC.toLowerCase() || t === shield.toLowerCase()) && sent.every((t) => t.from.toLowerCase() === borrower.toLowerCase()),
  `${sent.length} sent`,
);

// Someone else's loan is read-only; disconnecting returns to the connect card.
await p.goto(`${SITE}/app?rpc=${encodeURIComponent(RPC)}&shield=${shield}&borrower=0x0000000000000000000000000000000000000001`);
await until(p, "This isn't your connected wallet's loan");
check("another address: read-only", (await p.locator(".manage, .protect").count()) === 0);
await p.getByRole("link", { name: "Back to my loan" }).click();
await until(p, "Turn on protection");
await p.getByRole("button", { name: "Disconnect" }).click();
await until(p, "Protect your Borrow Kit loan");
check("disconnect: connect card again", true);
await p.context().close();

// The other theme and phone width: the page must not scroll sideways (and screenshots, when asked for).
for (const [scheme, width] of [
  ["light", 1440],
  ["dark", 390],
  ["light", 390],
]) {
  const q = await page(scheme, width);
  await q.goto(url);
  await until(q, "Protect your Borrow Kit loan");
  await shot(q, `connect-${scheme}-${width}`);
  await q.getByRole("button", { name: /Test wallet/ }).click();
  await q.getByRole("button", { name: "Switch to Arc" }).click();
  await until(q, "Turn on protection");
  await q.locator(".protect .amount input").fill("2");
  await q.locator(".protect-card").scrollIntoViewIfNeeded();
  await shot(q, `protect-${scheme}-${width}`);
  const wide = await q.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(`no horizontal scroll (${scheme} ${width})`, !wide);
  if (wide) {
    const over = await q.evaluate(() =>
      [...document.querySelectorAll("body *")]
        .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1 && getComputedStyle(el).position !== "fixed")
        .slice(0, 8)
        .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join(".")} right=${Math.round(el.getBoundingClientRect().right)} "${(el.textContent ?? "").trim().slice(0, 40)}"`),
    );
    for (const o of over) console.log(`  wider than ${width}: ${o}`);
  }
  await shot(q, `full-${scheme}-${width}`, true);
  await q.context().close();
}
await browser.close();

for (const e of errors) console.log(`ERROR ${e}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed, ${errors.length} page errors`);
process.exit(failed || errors.length ? 1 : 0);
