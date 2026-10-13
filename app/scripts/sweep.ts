// One pass of the hosted keeper's backup sweep: finds every loan with a policy in force from the shield's own
// PolicySet/PolicyCleared events, then checks each one and rescues those the contract says are due. It covers loans
// whose owner never sent Borrow Kit alerts to the webhook, and alerts that never arrived. Run every 5 minutes by
// .github/workflows/keeper.yml.
// Env: SHIELD_ADDRESS; optional KEEPER_PRIVATE_KEY (without it the sweep only reports), SWEEP_STATE (a JSON file
// that remembers the policies and the last block scanned, so the next pass only reads new blocks) and ARC_RPC_URL.
//   npm run sweep
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createShieldChain, publicClient } from "../src/chain.js";
import { main, shieldAddress } from "../src/cli.js";
import { HOSTED_MIN_REPAY, parseAddress, parseMarketId, parsePrivateKey, type Position } from "../src/config.js";
import { checkAndRescue, describe } from "../src/keeper.js";
import { applyPolicyEvents, firstBlock, scanShieldEvents, shieldLogs } from "../src/registry.js";

interface SweepState {
  shield: string;
  /** First block not yet scanned. */
  nextBlock: string;
  policies: Position[];
}

function loadState(path: string | undefined, shield: string): { from?: bigint; book: Map<string, Position> } {
  const book = new Map<string, Position>();
  if (!path || !existsSync(path)) return { book };
  const state = JSON.parse(readFileSync(path, "utf8")) as SweepState;
  if (state.shield.toLowerCase() !== shield.toLowerCase()) return { book };
  for (const p of state.policies) {
    const position = { borrower: parseAddress(p.borrower, "saved borrower"), marketId: parseMarketId(p.marketId) };
    book.set(`${position.borrower.toLowerCase()}:${position.marketId}`, position);
  }
  return { from: BigInt(state.nextBlock), book };
}

main(async () => {
  const shield = shieldAddress();
  const keeperEnv = process.env.KEEPER_PRIVATE_KEY?.trim();
  const chain = createShieldChain({ shield, keeperKey: keeperEnv ? parsePrivateKey(keeperEnv, "KEEPER_PRIVATE_KEY") : undefined });
  const client = publicClient();
  const statePath = process.env.SWEEP_STATE?.trim() || undefined;

  const latest = await client.getBlockNumber();
  const saved = loadState(statePath, shield);
  const from = saved.from ?? (await firstBlock(client, shield, latest));
  const events = await scanShieldEvents(shieldLogs(client, shield), from, latest);
  const policies = [...applyPolicyEvents(events, saved.book).values()];
  if (statePath) {
    const state: SweepState = { shield, nextBlock: String(latest + 1n), policies };
    writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n");
  }
  console.log(
    `Sweep by ${chain.keeper ?? "(no key: report only)"}: blocks ${from}–${latest} (${events.length} shield events), ` +
      `${policies.length} loan(s) with a policy`,
  );

  let failed = 0;
  for (const position of policies) {
    try {
      const outcome = await checkAndRescue(chain, position, { send: !!chain.keeper, minRepay: HOSTED_MIN_REPAY });
      console.log(describe(position, outcome));
    } catch (err) {
      failed++;
      console.error(`${position.borrower}: check failed: ${err instanceof Error ? err.message : err}`);
    }
  }
  if (failed > 0) throw new Error(`${failed} check(s) failed`);
});
