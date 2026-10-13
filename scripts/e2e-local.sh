#!/usr/bin/env bash
# End-to-end run of the TypeScript app against a LOCAL fork of Arc mainnet: no money, no real keys.
# Opens a real loan in the real USDC/cirBTC Morpho market with throwaway keys, deploys LoanShield, then runs the
# same `protect`, `keeper`, `sweep` and `status` scripts used on mainnet plus the webhook and stats handlers, and
# checks what they did on-chain.
# Needs Arc Foundry (arc-anvil, arc-cast) on PATH, `npm ci` in app/, and network access to the Arc mainnet RPC (the
# fork reads from it; two checks read it directly). Usage: scripts/e2e-local.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8547}"
FORK_BLOCK="${FORK_BLOCK:-25626000}"
UPSTREAM="${UPSTREAM_RPC:-https://rpc.mainnet.arc.io}"
export ARC_RPC_URL="http://127.0.0.1:$PORT"
TMP="$(mktemp -d)"

arc-anvil --network arc --fork-url "$UPSTREAM" --fork-block-number "$FORK_BLOCK" --port "$PORT" --silent &
ANVIL=$!
trap 'kill $ANVIL 2>/dev/null; rm -rf "$TMP"' EXIT
for _ in $(seq 1 60); do arc-cast block-number --rpc-url "$ARC_RPC_URL" >/dev/null 2>&1 && break; sleep 0.5; done

(cd "$ROOT" && arc-forge build >/dev/null)
cd "$ROOT/app"
run() { npx tsx "$@"; }
check() { # check <label> <pattern> <file>
  if grep -qE "$2" "$3"; then echo "PASS  $1"; else echo "FAIL  $1"; cat "$3"; exit 1; fi
}

run e2e/setup-local-loan.ts > "$TMP/env"
set -a; source "$TMP/env"; set +a
echo "local fork at block $FORK_BLOCK; shield $SHIELD_ADDRESS; borrower $BORROWER"

run scripts/protect.ts 400 1.9 2.2 > "$TMP/plan.txt"
check "protect without --yes sends nothing" "Nothing was sent" "$TMP/plan.txt"
[ "$(arc-cast call "$SHIELD_ADDRESS" 'buffer(address)(uint256)' "$BORROWER" --rpc-url "$ARC_RPC_URL")" = "0" ] \
  && echo "PASS  buffer still empty" || { echo "FAIL  buffer changed without --yes"; exit 1; }

run scripts/protect.ts 400 1.9 2.2 --yes > "$TMP/protect.txt"
check "protect deposits and sets the policy" "Rescue now\? Ready" "$TMP/protect.txt"

KEEPER_PRIVATE_KEY= run scripts/keeper.ts --once > "$TMP/report.txt"
check "keeper without a key reports but sends nothing" "not sent: no keeper key" "$TMP/report.txt"

run scripts/keeper.ts --once > "$TMP/keeper1.txt"
check "keeper rescues the loan" "rescued, HF 1\.[0-9]{4} → 2\.2[0-9]{3}" "$TMP/keeper1.txt"

run scripts/keeper.ts --once > "$TMP/keeper2.txt"
check "second pass finds it healthy and sends nothing" "healthy \(HF 2\.2[0-9]{3} ≥ trigger 1\.9000\)" "$TMP/keeper2.txt"

# Webhook path: api/webhook.ts called in-process with Borrow Kit-shaped notifications (the Borrow Kit README,
# "Receiving health-band notifications"). The payload is never trusted: only the chain decides (README, "Webhook trust model").
run e2e/post-webhook.ts forged-1 LIQUIDATABLE "$BORROWER" > "$TMP/forged.txt"
check "forged LIQUIDATABLE alert on a healthy loan sends nothing" "^200 .*healthy \(HF 2\.2[0-9]{3}" "$TMP/forged.txt"

run e2e/borrow-more.ts 1.6 > "$TMP/borrow.txt"
check "borrower borrows more, back in danger" "HF 2\.2[0-9]{3} → 1\.[56][0-9]{3}" "$TMP/borrow.txt"

KEEPER_PRIVATE_KEY= run e2e/post-webhook.ts real-1 URGENT "$BORROWER" > "$TMP/hook-nokey.txt"
check "webhook without a key reports but sends nothing" "^200 .*not sent: no keeper key" "$TMP/hook-nokey.txt"

run e2e/post-webhook.ts real-1 URGENT "$BORROWER" > "$TMP/hook.txt"
check "real alert: webhook rescues the loan" "^200 .*rescued, HF 1\.[0-9]{4} → 2\.2[0-9]{3}" "$TMP/hook.txt"

# A redelivery reaching a fresh instance (its in-memory dedupe is empty) must still not rescue twice.
run e2e/post-webhook.ts real-1 URGENT "$BORROWER" > "$TMP/hook-again.txt"
check "redelivered alert on a fresh instance sends nothing" "^200 .*healthy \(HF 2\.2[0-9]{3}" "$TMP/hook-again.txt"

# Gas estimates skip Morpho's interest accrual when the market was touched at the same timestamp (README "Arc
# findings"). Reproduce that with controlled block timestamps and check the keeper's sendRescue still lands.
run e2e/borrow-more.ts 1.75 > "$TMP/borrow2.txt"
check "borrower borrows more again" "HF 2\.2[0-9]{3} → 1\.7[0-9]{3}" "$TMP/borrow2.txt"
run e2e/estimate-race.ts > "$TMP/race.txt"
check "an exact gas estimate runs out of gas once accrual runs" "^round 1: .*: reverted" "$TMP/race.txt"
check "sendRescue's headroom covers the accrual" "^round 2: .*: success, accrued interest" "$TMP/race.txt"

# The hosted keeper's opt-in path: with an empty WATCH list, a Borrow Kit alert only names the wallet to check, and
# the chain still decides (README, "Hosted keeper for every protected loan").
WATCH= run e2e/post-webhook.ts optin-forged LIQUIDATABLE 0x0000000000000000000000000000000000000001 > "$TMP/optin-forged.txt"
check "opt-in: a forged alert naming a wallet without a policy only reads" "^200 .*0x0000000000000000000000000000000000000001 in 0xc2db905f…: NoPolicy, no rescue" "$TMP/optin-forged.txt"
# Three rescues have used most of the 400 USDC buffer; top it up so the next two rescues reach the target.
run scripts/protect.ts 300 1.9 2.2 --yes > "$TMP/topup.txt"
check "owner tops the buffer up by 300 USDC" "Rescue now\? NotInDanger" "$TMP/topup.txt"
run e2e/borrow-more.ts 1.6 > "$TMP/borrow3.txt"
check "borrower borrows more, back in danger" "HF [12]\.[0-9]{4} → 1\.[56][0-9]{3}" "$TMP/borrow3.txt"
WATCH= run e2e/post-webhook.ts optin-1 URGENT "$BORROWER" > "$TMP/optin.txt"
check "opt-in: an alert from a wallet outside WATCH gets its loan rescued" "^200 .*rescued, HF 1\.[0-9]{4} → 2\.2[0-9]{3}" "$TMP/optin.txt"

# The backup sweep finds the loan from the shield's own events (no WATCH list), and remembers where it stopped.
run e2e/borrow-more.ts 1.6 > "$TMP/borrow4.txt"
check "borrower borrows more, back in danger" "HF [12]\.[0-9]{4} → 1\.[56][0-9]{3}" "$TMP/borrow4.txt"
WATCH= KEEPER_PRIVATE_KEY= run scripts/sweep.ts > "$TMP/sweep-nokey.txt"
check "sweep without a key finds the loan from events, reports, sends nothing" "rescue due \(HF 1\.[0-9]{4} → 2\.2[0-9]{3}\), not sent: no keeper key" "$TMP/sweep-nokey.txt"
WATCH= SWEEP_STATE="$TMP/sweep.json" run scripts/sweep.ts > "$TMP/sweep1.txt"
check "sweep finds 1 loan with a policy" "shield events\), 1 loan\(s\) with a policy" "$TMP/sweep1.txt"
check "sweep rescues it" "rescued, HF 1\.[0-9]{4} → 2\.2[0-9]{3}" "$TMP/sweep1.txt"
first_end="$(sed -nE 's/.*blocks [0-9]+–([0-9]+) .*/\1/p' "$TMP/sweep1.txt")"
WATCH= SWEEP_STATE="$TMP/sweep.json" run scripts/sweep.ts > "$TMP/sweep2.txt"
check "next sweep starts where the last one stopped" "blocks $((first_end + 1))–[0-9]+ \([0-9]+ shield events\), 1 loan\(s\) with a policy" "$TMP/sweep2.txt"
check "next sweep finds it healthy and sends nothing" "healthy \(HF 2\.2[0-9]{3} ≥ trigger 1\.9000\)" "$TMP/sweep2.txt"

arc-cast logs --from-block "$((FORK_BLOCK + 1))" --address "$SHIELD_ADDRESS" \
  'Rescued(address indexed,bytes32 indexed,address indexed,uint256,uint256,uint256,uint256)' --rpc-url "$ARC_RPC_URL" > "$TMP/logs.txt"
[ "$(grep -c 'transactionHash' "$TMP/logs.txt")" = "5" ] && echo "PASS  exactly five Rescued events (keeper, webhook, race, opt-in alert, sweep)" \
  || { echo "FAIL  expected exactly five Rescued events"; cat "$TMP/logs.txt"; exit 1; }

# The home page's totals (api/stats.ts), rebuilt from the same events.
run e2e/get-stats.ts > "$TMP/stats.txt"
check "stats: 1 loan protected, 5 rescues" '^200 .*"loansProtected":1,"policies":1,.*"rescues":5' "$TMP/stats.txt"
check "stats: USDC on standby equals the buffer on chain" "^standby .*: match$" "$TMP/stats.txt"

# The web page's reader (app/public/shield.js), through the same JSON-RPC calls a browser makes.
run e2e/web-read.ts > "$TMP/web.txt"
check "web reader: rescue simulation reverts NotInDanger" "simulate: reverts NotInDanger\(2\.2[0-9]{3}, 1\.9000\)" "$TMP/web.txt"
check "web reader: finds all five rescues from the deploy block" "history: 5 rescue\(s\)" "$TMP/web.txt"
check "web reader: loan state" "loan: HF 2\.2[0-9]{3}, buffer [0-9.,]+ USDC, policy 1\.9000 → 2\.2000, preview NotInDanger" "$TMP/web.txt"
cat "$TMP/web.txt"

# What a fork can't show: the public RPC's own limits, read-only against Arc mainnet with the page's reader.
ARC_RPC_URL= SHIELD_ADDRESS= BORROWER= run e2e/mainnet-read.ts > "$TMP/mainnet.txt"
check "Arc mainnet RPC accepts the page's eth_getLogs chunks" "^eth_getLogs: 2 chunks of [0-9]+ blocks accepted" "$TMP/mainnet.txt"
check "Arc mainnet RPC serves archive state" "^archive state: Morpho Blue has code from block [0-9]+" "$TMP/mainnet.txt"

run scripts/status.ts "$BORROWER" > "$TMP/status.txt"
check "status reads the protected loan" "policy: rescue below 1\.9000, back up to 2\.2000" "$TMP/status.txt"
cat "$TMP/status.txt"
echo "e2e: all checks passed"
