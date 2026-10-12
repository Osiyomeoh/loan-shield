// Polls every watched loan and calls rescue when, and only when, the contract says one is due.
// Env: SHIELD_ADDRESS, WATCH (borrower:marketId,...), optional KEEPER_PRIVATE_KEY (a gas-only wallet; without it
// the keeper only reports), POLL_SECONDS (default 30).
//   npm run keeper            run until stopped
//   npm run keeper -- --once  check once and exit
import { createShieldChain } from "../src/chain.js";
import { args, main, shieldAddress } from "../src/cli.js";
import { parsePrivateKey, parseWatchList, requireEnv } from "../src/config.js";
import { checkAndRescue, describe } from "../src/keeper.js";

main(async () => {
  const { flags } = args();
  const keeperEnv = process.env.KEEPER_PRIVATE_KEY?.trim();
  const chain = createShieldChain({
    shield: shieldAddress(),
    keeperKey: keeperEnv ? parsePrivateKey(keeperEnv, "KEEPER_PRIVATE_KEY") : undefined,
  });
  const watch = parseWatchList(requireEnv("WATCH"));
  if (watch.length === 0) throw new Error("WATCH is empty");
  const pollMs = Number(process.env.POLL_SECONDS ?? 30) * 1000;
  if (!Number.isFinite(pollMs) || pollMs < 1000) throw new Error("POLL_SECONDS must be at least 1");

  console.log(`Keeper ${chain.keeper ?? "(no key: report only)"} watching ${watch.length} loan(s)`);
  for (;;) {
    for (const position of watch) {
      try {
        const outcome = await checkAndRescue(chain, position, { send: !!chain.keeper });
        console.log(`${new Date().toISOString()} ${describe(position, outcome)}`);
      } catch (err) {
        console.error(`${new Date().toISOString()} ${position.borrower}: check failed: ${err instanceof Error ? err.message : err}`);
      }
    }
    if (flags.has("--once")) return;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
});
