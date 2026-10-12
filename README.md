# Loan Shield

[![ci](https://github.com/Osiyomeoh/loan-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/Osiyomeoh/loan-shield/actions/workflows/ci.yml)

Loan Shield is standby USDC for your Borrow Kit loan on Arc. If the loan gets close to liquidation, it repays just enough of the debt to bring the loan back to a health factor you chose, so a liquidator never gets your cirBTC at a discount.

Arc's Borrow Kit lends USDC against cirBTC through Morpho Blue. When the loan's health factor falls below 1, anyone may liquidate it and keep a 4.38% bonus on the debt they repay: $43.84 of every $1,000. Borrow Kit can warn you that this is coming (health-band webhooks), but nothing acts on the warning. Loan Shield does. You park USDC in the contract and set a trigger and a target health factor, for example 1.50 and 1.80. Once the loan drops below the trigger, anyone can call `rescue`, and the contract repays exactly enough of your debt from your own buffer to bring it back to the target.

**What it uses Arc for:** the Borrow Kit loan and its Morpho Blue market on Arc mainnet, USDC as both the loan token and the gas token (a rescue costs under 0.004 USDC), Borrow Kit health-band webhooks to wake the keeper, Swap Kit to buy the demo cirBTC, and Arc Foundry to test against Arc mainnet's real state.

## Status

**Built** means the code exists and a test that runs it passes. **Planned** means it doesn't exist or hasn't run yet. Every claim, with the command that proves it, is in [CLAIMS.md](CLAIMS.md).

| Part | Status |
|---|---|
| `LoanShield.sol` contract | **built**. 39 tests: unit, fuzz, invariant, and fork tests against the real Arc mainnet market |
| Keeper (polling) and webhook receiver (`app/`) | **built**. 35 unit tests, plus end to end on a local fork of Arc mainnet |
| End-to-end run on a local fork (`scripts/e2e-local.sh`) | **built**. 21 checks: a real loan in the real cirBTC market, rescued by the keeper and by the webhook, each exactly once |
| Circle Kit scripts: `buy-cirbtc` (Swap Kit), `open-loan` and `register-webhook` (Borrow Kit), and the Borrow Kit column of `status` | **built and typechecked, not run yet**. They call Circle's live services, which a local fork can't provide, so they first run when the demo loan is opened on mainnet |
| Web page (`app/public/`) | **built**. Tested on a local fork, at desktop and phone width, in light and dark mode |
| CI (`.github/workflows/ci.yml`) | **built**. Runs all of the above, but it has not run on GitHub yet because the repo isn't pushed |
| Deployed on Arc mainnet, verified on explorer.arc.io | **planned**. The address goes here once it is deployed |
| Live mainnet rescue (transaction links) | **planned** |
| Web page and webhook hosted on Vercel | **planned** |
| Charging Borrow Kit's integrator fee | **planned, not built**. Needs a Circle API key |

## The guarantee

USDC in `buffer[owner]` can leave the contract in only two ways:

1. **`withdraw`**: the owner takes it back, at any time.
2. **`rescue`**: it repays **the owner's own** debt, in a market **the owner chose**, **only while** the loan's health factor is below **the owner's** trigger, and **only enough** to bring it back to **the owner's** target.

A rescue turns buffer USDC into an equal amount of repaid debt, so it can't lose the owner money. That is why `rescue` can be permissionless: anyone may call it, and the contract checks everything. The contract has no owner, no pause and no upgrade path. Its only fixed addresses are Morpho Blue and USDC.

The contract computes health with Morpho's own formula, oracle and rounding, after accruing interest. A health factor below 1 in the shield is therefore exactly a position that `Morpho.liquidate` would accept (claim 4).

## How it works

```
 Borrower wallet ──Borrow Kit borrow()──▶ Morpho Blue 0x34CD…7fCD, market 0xc2db…815d (USDC/cirBTC, LLTV 0.86)
   │ deposit / withdraw / setPolicy                     ▲ repay(onBehalf = borrower)
   ▼                                                    │
 LoanShield.sol (src/)
   buffer[owner]              USDC parked by that owner
   policy[owner][market]      {trigger, target} health factors (WAD)
   preview(borrower, market)  view: status, HF now, repay amount, HF after (equals what rescue does, claim 8)
   rescue(borrower, market)   anyone: accrueInterest → HF < trigger? → repay just enough → HF must improve
   ▲
   │ rescue() tx, sent only when preview says Ready and a dry run succeeds
 Keeper (app/), whose key holds only gas money
   scripts/keeper.ts          polls every watched loan every POLL_SECONDS (default 30)
   api/webhook.ts             Borrow Kit morpho.healthBandCrossed POST → re-check on-chain → same decision
 Web page (app/public/)       reads the chain over the public RPC: HF, buffer, policy, rescue history,
                              "would a rescue run now?" (eth_call). No wallet, no backend
```

Design choices:

- **The keeper decides nothing.** The keeper and the webhook only send `rescue` when the contract's own `preview` returns `Ready` and a dry run of `rescue` succeeds. Even then, the contract checks every rule again. A buggy or hostile keeper can waste its own gas and nothing else.
- **The buffer is plain USDC and earns no yield.** It has to be withdrawable exactly when it's needed. On 2026-10-12, Arc's Galaxy USDC vault held 0 idle USDC and its only market was 99.47% utilized, so a yield-bearing buffer could have failed at the worst moment.
- **No keeper fee is taken from the buffer.** Every cent leaves as your repayment or your withdrawal. The keeper pays its own gas.
- **It works with any Morpho market on Arc that lends USDC**, not just cirBTC. `setPolicy` rejects markets whose loan token isn't USDC.

## Addresses (Arc mainnet, chain 5042)

| What | Address |
|---|---|
| LoanShield | _not deployed yet_ |
| Morpho Blue | [`0x34CD04070dD72b14E241112F6d83812Df5Af7fCD`](https://explorer.arc.io/address/0x34CD04070dD72b14E241112F6d83812Df5Af7fCD) |
| USDC/cirBTC market (LLTV 0.86), which Borrow Kit lends from | `0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d` |
| USDC (ERC-20 interface, 6 decimals) | [`0x3600000000000000000000000000000000000000`](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) |
| cirBTC (8 decimals) | [`0x171A4217b86A807A64eB94757Db6849fb4bDbAA0`](https://explorer.arc.io/address/0x171A4217b86A807A64eB94757Db6849fb4bDbAA0) |

RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`. On 2026-10-12 (block 25,639,106), the market had 194,023,879 USDC borrowed against cirBTC (`npx tsx e2e/mainnet-read.ts`).

## Reproduce

You need [Arc Foundry](https://github.com/circlefin/arc-foundry) v0.8.0-2 (`arc-forge`, `arc-cast`, `arc-anvil` on PATH) and Node 22 or later. Plain Foundry can't run these tests because it reverts on Arc's USDC precompile. Every command below sends nothing to mainnet and needs no keys.

```sh
# Contracts: 39 tests. The fork tests read Arc mainnet at a pinned block through the public RPC.
arc-forge test

# App: typecheck and 35 unit tests (keeper, webhook, the web page's chain reader, ABI drift)
cd app && npm ci && npm run typecheck && npm test

# End to end, 21 checks. Forks Arc mainnet locally, opens a real loan in the real cirBTC market with throwaway
# keys, deploys LoanShield, then runs the same protect / keeper / webhook / status code used on mainnet.
scripts/e2e-local.sh

# Read-only against Arc mainnet: live market data, the RPC's eth_getLogs limit, archive state
cd app && npx tsx e2e/mainnet-read.ts
```

What the end-to-end run checks, in order:

- `protect` without `--yes` sends nothing. With `--yes`, it deposits 400 USDC and sets the policy to 1.90 → 2.20.
- The keeper without a key only reports. With a key, it rescues the loan (HF 1.6 → 2.2), and a second pass sends nothing.
- A forged `LIQUIDATABLE` webhook against the now-healthy loan sends nothing.
- The borrower borrows more (HF back to 1.6). A real alert makes the webhook rescue the loan. Redelivering the same alert to a fresh instance, whose memory of seen ids is empty, sends nothing.
- A gas estimate taken without Morpho's interest accrual runs out of gas, and the keeper's `sendRescue` lands anyway (see [Arc findings](#arc-findings)).
- Exactly three `Rescued` events are emitted. The web page's reader finds all three and decodes the loan.
- Two read-only checks run against Arc mainnet itself.

## Web page

`app/public/index.html` is a single static page with no dependencies (`shield.js` is its chain reader). It shows the loan's live health factor against its trigger, target and liquidation point. It also shows the buffer, the policy, every rescue with links to explorer.arc.io, and whether a rescue would run right now. It gets that last answer from an `eth_call` of `rescue`, and it decodes the revert, such as `NotInDanger(health factor, trigger)`. The page has no wallet connection and makes no writes.

Which loan it shows comes from URL parameters: `?shield=0x…&borrower=0x…` (and optionally `&market=0x…`). The defaults are filled in after the mainnet deploy. To look at a loan on a local fork (for example one made by `e2e/setup-local-loan.ts` against `arc-anvil`), serve the folder and add `rpc`:

```sh
python3 -m http.server -d app/public 8090
# http://127.0.0.1:8090/?rpc=http://127.0.0.1:8547&shield=0x…&borrower=0x…
```

`?rpc=` accepts only `http://127.0.0.1:<port>` or `http://localhost:<port>`. Any other value is ignored, so a shared link can't point the page at someone else's node. In fork mode, the page shows a "LOCAL FORK" chip and prints fork-only addresses and transactions as plain text instead of explorer links.

## Webhook trust model

Borrow Kit can POST a `morpho.healthBandCrossed` notification when a loan crosses a health band (`register-webhook` sets this up). Circle's Borrow Kit README (`@circle-fin/borrow-kit` 1.0.0, "Receiving health-band notifications") says: *"A permissionless receiver cannot yet verify that a notification came from Circle, so treat one as a prompt to check the loan, not as its state."* `api/webhook.ts` follows that rule:

- **Nothing in the payload decides anything.** The wallet, loan id and band in the body are logged and then ignored. The handler re-reads every loan in **its own** `WATCH` list on-chain and rescues only the ones the contract reports as `Ready`. The most a forged POST can do is make the keeper read the chain.
- **Duplicates are handled.** Delivery is at-least-once, so the handler deduplicates on `notification.event_id`, as the README says to. It records an id only after the notification has been handled without errors, so a failed check is retried when the notification is redelivered. The memory of seen ids is per instance. A duplicate that reaches a second instance is still harmless, because the second check finds the loan already rescued (e2e check "redelivered alert on a fresh instance sends nothing").
- **Without `KEEPER_PRIVATE_KEY`, it never sends.** It checks and reports what it would do.

## Arc findings

These are things about Arc that surfaced while building, each reproduced by a test in this repo.

1. **Gas estimates can leave out Morpho's interest accrual.** Arc makes a block about every 0.5 s, and consecutive blocks often share a timestamp. On 2026-10-12, mainnet blocks 25,638,823 and 25,638,824 both had timestamp 1791837015. Morpho skips `_accrueInterest` when no time has passed since the market's `lastUpdate`. So an `eth_estimateGas` run against a block that already touched the market leaves out the interest-rate-model call and its storage writes. On a local fork, a rescue estimated at 177,097 gas in that state needed about 200,880 one second later. Sent with the bare estimate and mined at a later timestamp, it ran out of gas inside a sub-call. Because of the 63/64 rule, the receipt showed less gas used than the limit, which hid the cause. The fix is `withHeadroom` in `app/src/chain.ts`: send twice the estimate, which costs nothing because only gas used is charged. `e2e/estimate-race.ts` reproduces both outcomes with controlled block timestamps: the bare estimate runs out of gas, and `sendRescue` succeeds with the accrual.
2. **The public RPC's `eth_getLogs` limit is 10,000 blocks, and it changed during the day.** Measured on `rpc.mainnet.arc.io` on 2026-10-12: a 10,000-block span passes, and a 10,001-block span fails with `-32012 "requested range too large"` (6 of 6 tries). Earlier the same day, it refused only spans over 100,000 blocks (`-32602`). The web page reads rescue history in 10,000-block chunks (`MAX_LOG_RANGE` in `shield.js`), and the end-to-end run checks the live limit, so a future change fails CI instead of the page.
3. **"Cannot clear balance of empty account".** Under Arc Foundry, Arc's native-coin precompile reverts a transfer that would zero the balance of an account that has nonce 0 and no code. A real wallet has sent at least one transaction, so it never hits this, but fresh test addresses do. `test/fork/ArcFork.sol` gives funded test wallets nonce 1.
4. **"Blocked address" in invariant tests.** Forge's invariant fuzzer also sends calls from address literals it finds in the source, such as USDC's `0x3600…0000`. Arc rejects transactions from those system addresses, so every invariant failed before its first call. `test/invariant/ShieldInvariant.t.sol` pins the senders with `targetSender`.
5. **The public RPC rate-limits with HTTP 429.** On 2026-10-12, the first GitHub Actions run of this repo (run 38317579335) passed every fork check, then the read-only mainnet check got `HTTP 429` on an `eth_getCode` call. The fork had been reading from the same RPC from the same runner just before. The page's reader now waits and retries a 429 or 503 up to five times, at least as long as `Retry-After` asks, capped at 10 s (`createRpc` in `shield.js`). A unit test checks the retry, not the rate limit itself: the limit couldn't be triggered on demand.

## Cost

| | Gas | USDC at the 20 gwei base fee (2026-10-12) |
|---|---|---|
| Deploy `LoanShield` | 2,149,816 (forge gas report); the deploy script's dry run sets a 2,794,760 limit | ≈ 0.043 |
| `rescue` | at most 155,106 execution gas in the fork tests (274 calls); about 181,000 total for a full transaction that includes accrual, on the local fork | ≈ 0.0036 |
| `deposit` / `setPolicy` | at most 75,024 / 61,305 execution gas | < 0.002 each |

## Run it on mainnet (operator steps)

These steps are for the borrower and keeper operator. They send real transactions with your own keys, which go only in your own `app/.env` (gitignored, see `app/.env.example`). Every script prints a plan and sends nothing until you add `--yes`, so run each one without `--yes` first to see Circle's quote: the fees, the collateral Borrow Kit would take and the health factor the loan would start at. Use a fresh wallet that holds only what the demo needs.

The amounts below fit a 10 USDC wallet: 8.5 USDC buys the cirBTC collateral, about 0.5 stays for gas (the deploy is ≈ 0.043, every other transaction well under 0.01) and 0.1 goes to the keeper wallet. The 4 USDC borrowed lands in the wallet and pays for the 1.5 USDC buffer. Borrow Kit sizes the collateral itself, so if its quote wants more cirBTC than the wallet holds, borrow less.

```sh
cd app && cp .env.example .env    # then fill in PRIVATE_KEY (borrower) yourself
npm run buy-cirbtc -- 8.5 --yes   # Swap Kit: USDC → cirBTC
npm run open-loan -- 4 --yes      # Borrow Kit: borrow USDC against cirBTC

# Deploy from the repo root with your own keystore account (arc-cast wallet import <name> --interactive)
arc-forge script script/Deploy.s.sol --rpc-url arc --account <name> --broadcast
# then set SHIELD_ADDRESS in app/.env

npm run protect -- 1.5 1.5 1.8 --yes                     # deposit 1.5 USDC; rescue below 1.5, back up to 1.8
npm run status -- <borrower>                              # Morpho, Borrow Kit and the shield, side by side
npm run register-webhook -- https://<host>/api/webhook --yes
npm run keeper                                            # WATCH=<borrower>:<market id>, KEEPER_PRIVATE_KEY
```

**A live rescue without waiting for BTC to fall.** The contract accepts any trigger above 1, so raise it just above the loan's current health factor with `npm run protect -- 0 1.9 2.2 --yes` (a buffer of 0 only updates the policy). The keeper's next pass rescues the loan. It repays 1 − HF/target of the debt from the buffer: at HF 1.8 that is 1 − 1.8/2.2 ≈ 18%, about 0.73 USDC of a 4 USDC loan. Borrow Kit picks the loan's starting health factor, so take the trigger and target from what `status` shows.

`KEEPER_PRIVATE_KEY` should be a separate wallet that holds a few cents of USDC for gas: 0.1 USDC pays for more than 25 rescues at ≈ 0.0036 each. It can only call `rescue`, which repays loans from their owners' own buffers.

## Supply chain and known issues

- **Exact pins.** All npm dependencies are pinned to exact versions published at least two weeks before 2026-10-12, with one exception. The Circle packages (`@circle-fin/borrow-kit` 1.0.0, `swap-kit` 1.7.1, `adapter-viem-v2` 1.19.0) were all published on 2026-09-30, because Borrow Kit 1.0.0 is the first release. CI checks the Arc Foundry download against its published sha256. `lib/forge-std` is vendored at v1.17.0.
- **`npm audit --omit=dev` reports 19 vulnerabilities** (7 low, 8 moderate, 4 high). All four highs come through `@circle-fin/swap-kit` → `@coral-xyz/anchor` → `toml`, which are Solana dependencies. The suggested fix downgrades Swap Kit to 1.3.1, a breaking change. Swap Kit is used only by `scripts/buy-cirbtc.ts`, a one-off script run on the borrower's machine. The keeper and the webhook don't import it.

## Limitations and what's next

- A rescue needs USDC in the buffer. A partial rescue happens if the buffer runs short, and `EmptyBuffer` if it is empty. The page shows the buffer next to the debt.
- The keeper must be running, or the webhook reachable, for a rescue to happen in time. Because `rescue` is permissionless, any number of independent keepers can watch the same loan.
- A webhook only wakes one deployment's keeper for the loans in its `WATCH` list. Serving many users needs a watch list kept in storage, which is planned.
- **Next:** Borrow Kit lets an integrator charge an origination fee and keep 90% of it ([borrow fees](https://docs.arc.io/app-kit/concepts/borrow-fees)). A wallet that adds Loan Shield can offer loans that don't get liquidated while you sleep and earn that fee. The same contract already covers every USDC market on Arc's Morpho deployment, such as USDC/XAUM at LLTV 0.77, where the liquidation bonus is 7.41%.

## Repo layout

```
src/LoanShield.sol              the contract
src/libraries/HealthLib.sol     Morpho's math: health, shares↔assets rounding, interest, liquidation incentive
test/                           unit, fork (test/fork/) and invariant (test/invariant/) tests
script/Deploy.s.sol             mainnet deploy (refuses any chain but 5042)
app/src/                        shared TypeScript: config, viem chain client, keeper decision, webhook handler
app/scripts/                    operator CLIs: buy-cirbtc, open-loan, protect, status, register-webhook, keeper
app/api/webhook.ts              Vercel function for Borrow Kit notifications
app/public/                     the web page and its dependency-free chain reader
app/e2e/                        local-fork helpers and the read-only mainnet check
scripts/e2e-local.sh            the end-to-end run
scripts/verify-submission.sh    pre-submission checks (repo, claims, secrets, live deployment)
```

## License

MIT, see [LICENSE](LICENSE).
