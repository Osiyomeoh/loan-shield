#!/usr/bin/env bash
# Browser end-to-end run of the My loan page (/app) against a LOCAL fork of Arc mainnet: no money, no real keys.
# Builds the site and serves it with `vite preview`, opens a fresh loan with throwaway keys, then drives the page in
# Chrome through Playwright with a test wallet that forwards to the fork: connect, switch network, turn protection
# on, withdraw, change the policy (declining once in the wallet), add USDC, turn off, the read-only view of another
# address, and disconnect. Every owner action is checked on-chain, and the page must not scroll sideways at phone
# width in either theme.
# Needs Arc Foundry (arc-anvil, arc-forge) on PATH, `npm ci` in app/ and app/web/, Google Chrome, and network access
# to the Arc mainnet RPC (the fork reads from it). Usage: scripts/e2e-browser.sh [screenshot-dir]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-8551}"
SITE_PORT="${SITE_PORT:-4179}"
FORK_BLOCK="${FORK_BLOCK:-25626000}"
UPSTREAM="${UPSTREAM_RPC:-https://rpc.mainnet.arc.io}"
export ARC_RPC_URL="http://127.0.0.1:$PORT"
export SITE="http://127.0.0.1:$SITE_PORT"
SHOTS="${1:+$(cd "$(dirname "$1")" && pwd)/$(basename "$1")}"
TMP="$(mktemp -d)"
ANVIL=
PREVIEW=
trap 'kill $ANVIL $PREVIEW 2>/dev/null; rm -rf "$TMP"' EXIT

arc-anvil --network arc --fork-url "$UPSTREAM" --fork-block-number "$FORK_BLOCK" --port "$PORT" --silent &
ANVIL=$!
(cd "$ROOT" && arc-forge build >/dev/null)
(cd "$ROOT/app/web" && npm run build >/dev/null)
(cd "$ROOT/app/web" && exec node_modules/.bin/vite preview --port "$SITE_PORT" --strictPort --host 127.0.0.1 >/dev/null) &
PREVIEW=$!
for _ in $(seq 1 60); do arc-cast block-number --rpc-url "$ARC_RPC_URL" >/dev/null 2>&1 && break; sleep 0.5; done
for _ in $(seq 1 60); do curl -sf "$SITE" >/dev/null && break; sleep 0.5; done

cd "$ROOT/app"
npx tsx e2e/setup-local-loan.ts > "$TMP/env"
set -a; source "$TMP/env"; set +a
echo "local fork at block $FORK_BLOCK; shield $SHIELD_ADDRESS; borrower $BORROWER; site $SITE"
node web/e2e/my-loan.mjs ${SHOTS:+"$SHOTS"}
