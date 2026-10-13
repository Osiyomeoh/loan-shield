import * as web from "../../public/shield.js";

export { web };

// The live deployment and the demo loan (README, "Live on Arc mainnet"). URL parameters ?shield=…&borrower=…&market=…
// override them on the dashboard. scripts/verify-submission.sh reads the next line, so keep it on one line.
export const DEFAULTS = { shield: "0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04", borrower: "0xf5C4c6528d214eaddf0e7e5e64D07Ab7dC321920", market: web.CIRBTC_MARKET };
export const REPO = "https://github.com/Osiyomeoh/loan-shield";
export const USDC = "0x3600000000000000000000000000000000000000";
// The hosted keeper's webhook (app/api/webhook.ts). It runs against the shield in DEFAULTS on Arc mainnet; Borrow Kit
// alerts sent here make it check the alerting wallet's loan at once.
export const KEEPER_WEBHOOK = "https://loan-shield-theta.vercel.app/api/webhook";

// ?rpc= is for local development against an arc-anvil fork only; any other RPC is refused, so a link can't make the
// site show another chain's data. It is read once, when the app loads, and kept for the session.
const localRpc = new URLSearchParams(location.search).get("rpc") ?? "";
export const onFork = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(localRpc);
export const rpcUrl = onFork ? localRpc : web.ARC.rpc;
export const rpc = web.createRpc(rpcUrl);

/** explorer.arc.io for a path, or undefined on a local fork, whose contracts and transactions aren't on it. */
export const explorerUrl = (path: string) => (onFork ? undefined : `${web.ARC.explorer}/${path}`);
