// Points your Borrow Kit loan's health-band notifications at the keeper's webhook. Keyless: your wallet signs an
// EIP-712 message; no transaction, no gas. Signs with PRIVATE_KEY from your .env.
//   npm run register-webhook -- <https url> [loanId]          show what would be registered
//   npm run register-webhook -- <https url> [loanId] --yes    sign and register
import { createViemAdapterFromPrivateKey } from "@circle-fin/adapter-viem-v2/next";
import { BorrowKit } from "@circle-fin/borrow-kit";
import { args, main, ownerAddress, ownerKey, stopUnlessConfirmed, usage } from "../src/cli.js";
import { CIRBTC_MARKET } from "../src/config.js";

main(async () => {
  const { positional, yes } = args();
  const webhookUrl = positional[0];
  if (!webhookUrl) usage("npm run register-webhook -- <https url> [loanId] [--yes]");
  if (!webhookUrl.startsWith("https://")) throw new Error("webhook url must be https://");

  const kit = new BorrowKit();
  const walletAddress = ownerAddress();
  let loanId = positional[1];
  if (!loanId) {
    const { loans } = await kit.getLoans({ walletAddress, chain: "Arc" });
    const loan = loans.find((l) => l.marketId.toLowerCase() === CIRBTC_MARKET && l.status !== "closed");
    if (!loan) throw new Error(`no open Borrow Kit loan in the cirBTC market for ${walletAddress}`);
    loanId = loan.loanId;
  }

  console.log(`Loan ${loanId} (owner ${walletAddress}) → notifications to ${webhookUrl}`);
  if (stopUnlessConfirmed(yes, `npm run register-webhook -- ${webhookUrl} ${loanId}`)) return;

  const adapter = createViemAdapterFromPrivateKey({ privateKey: ownerKey() });
  const result = await kit.registerWebhook({ from: { adapter, chain: "Arc" }, loanId, webhookUrl });
  console.log(`Registered: loan ${result.loanId} → ${result.webhookUrl}`);
});
