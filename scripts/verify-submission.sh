#!/usr/bin/env bash
# Checks the submission the way a judge would see it: public repo with what's local pushed, every doc claim backed by
# code, no secrets, the contract live on Arc mainnet and matching the README, and the hosted page and webhook up.
# Read-only: it sends no transactions and needs no keys. Needs gh, jq, curl, Node (app/ installed) and arc-cast.
# Usage: PAGE_URL=https://<vercel host> scripts/verify-submission.sh [video/social url ...]
#   each extra url must return 200 and should be linked from the README.
set -u
REPO="Osiyomeoh/loan-shield"
RPC="https://rpc.mainnet.arc.io"
MORPHO="0x34CD04070dD72b14E241112F6d83812Df5Af7fCD"
USDC="0x3600000000000000000000000000000000000000"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0; warn=0
ok()   { printf '  \033[32mOK\033[0m    %s\n' "$1"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$1"; fail=$((fail+1)); }
soft() { printf '  \033[33mWARN\033[0m  %s\n' "$1"; warn=$((warn+1)); }

echo "Repo"
if meta=$(gh repo view "$REPO" --json visibility,licenseInfo,defaultBranchRef 2>/dev/null); then
  [ "$(jq -r .visibility <<<"$meta")" = PUBLIC ] && ok "$REPO is public" || bad "$REPO is not public"
  lic=$(jq -r '.licenseInfo.key // empty' <<<"$meta")
  [ -n "$lic" ] && ok "license detected ($lic)" || bad "no license detected by GitHub"
  branch=$(jq -r .defaultBranchRef.name <<<"$meta")
else
  bad "$REPO not found (not created yet, or gh not signed in)"; branch=""
fi
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  [ -z "$(git status --porcelain)" ] && ok "working tree clean" || bad "uncommitted changes: judges won't see them"
  if [ -n "$branch" ] && git fetch -q origin "$branch" 2>/dev/null; then
    ahead=$(git rev-list --count "origin/$branch..HEAD")
    [ "$ahead" = 0 ] && ok "local work is on $branch" || bad "$ahead local commit(s) not on $branch: judges won't see them"
  else
    bad "can't fetch origin/$branch"
  fi
else
  bad "not a git repository yet"
fi

echo "Claims backed by code (mentioned in docs -> code must exist)"
code_paths="src script app/src app/scripts app/api app/public app/web/src"
claim() { # name, regex
  docs=$(grep -liE "$2" ./*.md 2>/dev/null | wc -l | tr -d ' ')
  code=$(grep -rliE "$2" $code_paths 2>/dev/null | wc -l | tr -d ' ')
  if [ "$code" -gt 0 ]; then ok "$1 (code files: $code)"
  elif [ "$docs" -gt 0 ]; then bad "$1 claimed in $docs doc(s) but no code"
  fi
}
claim "Borrow Kit"               '@circle-fin/borrow-kit'
claim "Borrow Kit webhooks"      'morpho\.healthBandCrossed'
claim "Swap Kit"                 '@circle-fin/swap-kit'
claim "Viem adapter"             '@circle-fin/adapter-viem-v2'
claim "Earn Kit"                 '@circle-fin/earn-kit'
claim "Bridge Kit"               '@circle-fin/bridge-kit'
claim "Morpho Blue on Arc"       "$MORPHO"
claim "USDC/cirBTC market"       '0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d'
open=$(grep -E '^\| [0-9]+ \|' CLAIMS.md | awk -F' \\| ' '{print $NF}' | grep -ciE 'planned|pending')
[ "$open" = 0 ] && ok "every CLAIMS.md row has passed" || bad "$open CLAIMS.md row(s) still planned or pending"
grep -q '_not deployed yet_' README.md && bad "README still says the contract is not deployed" || ok "README names a deployment"

echo "Secrets"
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  tracked=$(git ls-files -- .env app/.env); [ -z "$tracked" ] && ok ".env not tracked" || bad "tracked: $tracked"
  hits=$(git grep -nE 'PRIVATE_KEY *= *(0x)?[0-9a-fA-F]{64}' -- ':!scripts/verify-submission.sh' | wc -l | tr -d ' ')
  [ "$hits" = 0 ] && ok "no private keys in tracked files" || bad "$hits possible private key(s) in tracked files"
else
  soft "secrets check needs the git repository"
fi

echo "Live on Arc mainnet (read-only)"
rpc() { curl -s -m 20 -H 'content-type: application/json' -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":$2}" "$RPC" | jq -r '.result // empty'; }
[ "$(rpc eth_chainId '[]')" = 0x13b2 ] && ok "$RPC is chain 5042" || bad "$RPC did not answer chain id 5042"
shield=$(grep -E '^\| LoanShield \|' README.md | grep -oE '0x[0-9a-fA-F]{40}' | head -1)
page_shield=$(sed -nE 's/.*const DEFAULTS = \{ shield: "([^"]*)", borrower: "([^"]*)".*/\1/p' app/web/src/config.ts)
page_borrower=$(sed -nE 's/.*const DEFAULTS = \{ shield: "([^"]*)", borrower: "([^"]*)".*/\2/p' app/web/src/config.ts)
if [ -z "$shield" ]; then
  bad "no LoanShield address in the README's Addresses table"
else
  code=$(rpc eth_getCode "[\"$shield\",\"latest\"]")
  [ "${#code}" -gt 2 ] && ok "LoanShield $shield has code" || bad "no code at $shield"
  m=$(arc-cast call "$shield" 'MORPHO()(address)' --rpc-url "$RPC" 2>/dev/null)
  u=$(arc-cast call "$shield" 'USDC()(address)' --rpc-url "$RPC" 2>/dev/null)
  [ "$m" = "$MORPHO" ] && [ "$u" = "$USDC" ] && ok "it points at Morpho Blue and USDC" || bad "MORPHO()/USDC() don't match ($m, $u)"
  [ "$(tr 'A-F' 'a-f' <<<"$page_shield")" = "$(tr 'A-F' 'a-f' <<<"$shield")" ] && ok "web page defaults to the same shield" \
    || bad "web page DEFAULTS.shield ('$page_shield') differs from the README"
  soft "check the verified source by hand (the explorer API refuses scripts): https://explorer.arc.io/address/$shield?tab=contract"
fi
if [ -n "$shield" ] && [ -n "$page_borrower" ]; then
  out=$(cd app && SHIELD_ADDRESS="$shield" BORROWER="$page_borrower" ARC_RPC_URL= npx tsx e2e/mainnet-read.ts 2>&1)
  grep -qE '^eth_getLogs: 2 chunks' <<<"$out" && ok "public RPC accepts the page's log chunks" || bad "page's log reads failed: $out"
  n=$(sed -nE 's/.*history: ([0-9]+) rescue\(s\).*/\1/p' <<<"$out")
  [ "${n:-0}" -gt 0 ] && ok "$n live rescue(s) for the demo loan" || bad "no Rescued event for the demo loan yet"
  grep -E '^(loan|simulate):' <<<"$out" | sed 's/^/        /'
else
  bad "web page DEFAULTS.borrower is empty"
fi

echo "Hosted page and webhook"
if [ -z "${PAGE_URL:-}" ]; then
  soft "PAGE_URL not set: hosted page and webhook not checked"
else
  page="${PAGE_URL%/}"
  body=$(curl -sL -m 20 "$page/"); c=$(curl -sL -o /dev/null -m 20 -w '%{http_code}' "$page/")
  [ "$c" = 200 ] && grep -q 'Loan Shield' <<<"$body" && ok "$page serves the page" || bad "$page: HTTP $c, not the Loan Shield page"
  c=$(curl -sL -o /dev/null -m 20 -w '%{http_code}' "$page/shield.js")
  [ "$c" = 200 ] && ok "shield.js served" || bad "$page/shield.js returned $c"
  hook=$(curl -s -m 20 "$page/api/webhook")
  [ "$(jq -r '.ok // empty' <<<"$hook" 2>/dev/null)" = true ] && ok "webhook answers: $hook" || bad "$page/api/webhook answered: ${hook:0:120}"
  grep -qF "$page" README.md && ok "page linked from README" || bad "page not linked from README"
fi

echo "Other links"
[ $# -eq 0 ] && soft "no video/social URLs passed: pass them as arguments"
for u in "$@"; do
  c=$(curl -sL -o /dev/null -m 20 -w '%{http_code}' "$u")
  [ "$c" = 200 ] && ok "$u" || bad "$u returned $c"
  grep -qF "$u" README.md && ok "  linked from README" || soft "  not linked from README"
done

echo; echo "FAIL: $fail  WARN: $warn"
[ "$fail" = 0 ]
