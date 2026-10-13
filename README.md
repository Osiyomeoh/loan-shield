# Loan Shield

[![ci](https://github.com/Osiyomeoh/loan-shield/actions/workflows/ci.yml/badge.svg)](https://github.com/Osiyomeoh/loan-shield/actions/workflows/ci.yml)

Loan Shield is standby USDC for your Borrow Kit loan on Arc. If the loan gets close to liquidation, it repays just enough of the debt to bring the loan back to a health factor you chose, so a liquidator never gets your cirBTC at a discount.

Arc's Borrow Kit lends USDC against cirBTC through Morpho Blue. When the loan's health factor falls below 1, anyone may liquidate it and keep a 4.38% bonus on the debt they repay: $43.84 of every $1,000. Borrow Kit can warn you that this is coming (health-band webhooks), but nothing acts on the warning. Loan Shield does. You park USDC in the contract and set a trigger and a target health factor, for example 1.50 and 1.80. Once the loan drops below the trigger, anyone can call `rescue`, and the contract repays exactly enough of your debt from your own buffer to bring it back to the target.

**What it uses Arc for:** the Borrow Kit loan and its Morpho Blue market on Arc mainnet, USDC as both the loan token and the gas token (a rescue costs under 0.004 USDC), Borrow Kit health-band webhooks to wake the keeper, Swap Kit to buy the demo cirBTC, and Arc Foundry to test against Arc mainnet's real state.

**Live on Arc mainnet:** [the page](https://loan-shield-theta.vercel.app) (reads the chain directly with no wallet; connect one to protect your own loan) · [LoanShield contract](https://explorer.arc.io/address/0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04) · [the live rescue](https://explorer.arc.io/tx/0x6a2633b3fe07f715a94da58e37e00fe903eb02ee986c9775a44fd0ea491cea3f) · [every transaction](#live-on-arc-mainnet)

## Status

**Built** means the code exists and a test that runs it passes. **Planned** means it doesn't exist or hasn't run yet. Every claim, with the command that proves it, is in [CLAIMS.md](CLAIMS.md).

| Part | Status |
|---|---|
| `LoanShield.sol` contract | **built**. 39 tests: unit, fuzz, invariant, and fork tests against the real Arc mainnet market |
| Keeper (polling) and webhook receiver (`app/`) | **built**. Unit tested (the app suite is 55 tests: keeper, webhook, the chain reader, the owner's transactions and the site's display helpers), plus end to end on a local fork of Arc mainnet |
| End-to-end run on a local fork (`scripts/e2e-local.sh`) | **built**. 21 checks: a real loan in the real cirBTC market, rescued by the keeper and by the webhook, each exactly once |
| Circle Kit scripts: `buy-cirbtc` (Swap Kit), `open-loan` and `register-webhook` (Borrow Kit), and the Borrow Kit column of `status` | `buy-cirbtc` and `open-loan` **ran on Arc mainnet** on 2026-10-13 and opened the demo loan ([transactions](#live-on-arc-mainnet)), and the Borrow Kit column of `status` read it back. `register-webhook` **ran on Arc mainnet** on 2026-10-13: Borrow Kit confirmed the demo loan's health-band notifications go to the hosted [`/api/webhook`](https://loan-shield-theta.vercel.app/api/webhook). These scripts call Circle's live services, which a local fork can't provide |
| Web site (`app/web/`, React) | **built**. Seven pages, dark and light themes. `npm run build` typechecks and builds it, and CI runs that too. The display helpers have 11 unit tests. Checked against Arc mainnet and a local fork, at desktop and phone width, in both themes |
| Turning protection on in the browser (`/app`, My loan) | **built**. Connect a wallet and the page finds its loan, then sends `approve`, `deposit`, `setPolicy`, `withdraw` and `clearPolicy` through that wallet, each simulated first; the site never holds a key. `scripts/e2e-browser.sh` drives it in Chrome against a local fork: 22 checks, each owner action verified on-chain. Not yet run on mainnet with a real wallet extension. The hosted keeper watches only the demo loan, so a newly protected loan needs its own keeper for now; the page says so and gives the command |
| CI (`.github/workflows/ci.yml`) | **passes** on GitHub Actions: contracts 39/39, app 45/45, the web build and the end-to-end run. First green on 2026-10-12 (run 38317984750), latest on 2026-10-13 (run 38371879121, before the My loan page and its 10 new tests). CI doesn't run the browser end-to-end check |
| Deployed on Arc mainnet | **deployed** 2026-10-13 at [`0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04`](https://explorer.arc.io/address/0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04). Its runtime code matches this repo's build byte for byte, apart from the two constructor addresses |
| Source verified on explorer.arc.io | **planned** |
| Live mainnet rescue | **done** 2026-10-13: the keeper's [`0x6a26…ea3f`](https://explorer.arc.io/tx/0x6a2633b3fe07f715a94da58e37e00fe903eb02ee986c9775a44fd0ea491cea3f) repaid 1.253229 USDC of the demo loan from its buffer, HF 1.236 → 1.800. Borrow Kit's `getLoans` agrees: HF 1.79999 (SAFE), liquidation price $46,552 |
| Web site and webhook hosted on Vercel | **live** at [loan-shield-theta.vercel.app](https://loan-shield-theta.vercel.app) since 2026-10-13. A forged `LIQUIDATABLE` alert posted to the hosted [`/api/webhook`](https://loan-shield-theta.vercel.app/api/webhook) gets "healthy (HF 1.7999 ≥ trigger 1.3000), no rescue". Since 2026-10-13 the keeper key is set on Vercel and the endpoint answers `"sends": true`: when a rescue is due, it sends one from a keeper wallet that holds only gas money |
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
 Web site (app/web/, React)   reads the chain over the public RPC: HF, buffer, policy, rescue history,
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
| LoanShield | [`0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04`](https://explorer.arc.io/address/0x11f86Cb8cc778C6a082CA7Ac2E5dD6faaC408b04), deployed in block 25,712,043 |
| Demo borrower (Borrow Kit loan `ac7209cf-003e-57f3-8f0a-2e100afb2225`) | [`0xf5C4c6528d214eaddf0e7e5e64D07Ab7dC321920`](https://explorer.arc.io/address/0xf5C4c6528d214eaddf0e7e5e64D07Ab7dC321920) |
| Morpho Blue | [`0x34CD04070dD72b14E241112F6d83812Df5Af7fCD`](https://explorer.arc.io/address/0x34CD04070dD72b14E241112F6d83812Df5Af7fCD) |
| USDC/cirBTC market (LLTV 0.86), which Borrow Kit lends from | `0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d` |
| USDC (ERC-20 interface, 6 decimals) | [`0x3600000000000000000000000000000000000000`](https://explorer.arc.io/address/0x3600000000000000000000000000000000000000) |
| cirBTC (8 decimals) | [`0x171A4217b86A807A64eB94757Db6849fb4bDbAA0`](https://explorer.arc.io/address/0x171A4217b86A807A64eB94757Db6849fb4bDbAA0) |

RPC `https://rpc.mainnet.arc.io`, explorer `https://explorer.arc.io`. On 2026-10-12 (block 25,639,106), the market had 194,023,879 USDC borrowed against cirBTC (`npx tsx e2e/mainnet-read.ts`).

## Live on Arc mainnet

The demo loan, opened with the operator steps below from a wallet funded with 10 USDC. Gas was paid in USDC at 20 gwei.

| Step | Transaction | Gas |
|---|---|---|
| Swap Kit: 6.5 USDC → 0.00007768 cirBTC | [`0x734f…3cc1`](https://explorer.arc.io/tx/0x734fa6857cd0d63fb447c3eb1e462f5e55289acf24103f807611478ed0e23cc1), block 25,711,514 | 545,910 (0.0109 USDC) |
| Borrow Kit: borrow 4 USDC against 0.00006861 cirBTC; the loan starts at health factor 1.236 | [`0xe8a0…9767`](https://explorer.arc.io/tx/0xe8a03c02890895fed0c8af45ebab580a9f556228a6e292ced13462a8fdf39767), block 25,711,528 | 345,235 (0.0069 USDC) |
| Deploy LoanShield | [`0x2806…157a`](https://explorer.arc.io/tx/0x28067ef351f87fa56d1c13581a058c081afd9f4daadda895c71256d09d0c157a), block 25,712,043 | 2,149,816 (0.0430 USDC) |
| `protect -- 2 1.1 1.5`: approve exactly 2 USDC | [`0x570c…b1eb`](https://explorer.arc.io/tx/0x570c570dc5008e47fba992fdc81624190c7e1573c9538c6fa744736a41ecb1eb), block 25,714,343 | 55,438 (0.0011 USDC) |
| deposit 2 USDC into the buffer | [`0x614e…dab9`](https://explorer.arc.io/tx/0x614e42b37b22e6e9b3e01e0cbc43dc2008e40e1b19a32197472564b2ff7bdab9), block 25,714,345 | 75,012 (0.0015 USDC) |
| `setPolicy`: rescue below 1.1, back up to 1.5. The loan is at 1.236, so `rescue` reverts `NotInDanger(1.236, 1.1)` | [`0x94cc…ae1c`](https://explorer.arc.io/tx/0x94cce1e0004d47a92d718695b30ad501d48dd2addafbca2784bbf314d556ae1c), block 25,714,348 | 61,305 (0.0012 USDC) |
| `protect -- 0 1.3 1.8`: raise the trigger above the loan's 1.236 to put it in danger now, without waiting for BTC to fall. `preview` then returns Ready: repay 1.253229 USDC, HF → 1.8 | [`0x0850…9b4a`](https://explorer.arc.io/tx/0x0850c55112afcc0e1a1ecf5d2d0f30ea1b2fea7cfb574a62c298fa9444319b4a), block 25,715,440 | 44,205 (0.0009 USDC) |
| **Keeper rescue** (`npm run keeper -- --once`, sent by the separate keeper wallet `0xEa25…6648`): `Rescued` repaid 1.253229 USDC (1,251,831,840,608 shares) from the buffer, HF 1.236 → 1.800. A second `rescue` now reverts `NotInDanger(1.7999…, 1.3)` | [`0x6a26…ea3f`](https://explorer.arc.io/tx/0x6a2633b3fe07f715a94da58e37e00fe903eb02ee986c9775a44fd0ea491cea3f), block 25,715,475 | 178,980 (0.0036 USDC, paid by the keeper) |

After the rescue, `npm run status` shows the loan through Morpho, the shield and Borrow Kit side by side. Borrow Kit's own `getLoans` reports health factor 1.7999997 (SAFE), 2.746781 USDC borrowed and a liquidation price of $46,552, down from about $67,790 before the rescue. The buffer holds the remaining 0.746771 USDC.

Borrow Kit's borrow transaction authorizes its adapter on Morpho and revokes it in the same transaction (both `SetAuthorization` events are in its logs), so nothing keeps a standing permission over the position.

## Reproduce

You need [Arc Foundry](https://github.com/circlefin/arc-foundry) v0.8.0-2 (`arc-forge`, `arc-cast`, `arc-anvil` on PATH) and Node 22 or later. Plain Foundry can't run these tests because it reverts on Arc's USDC precompile. Every command below sends nothing to mainnet and needs no keys.

```sh
# Contracts: 39 tests. The fork tests read Arc mainnet at a pinned block through the public RPC.
arc-forge test

# App: typecheck and 55 unit tests (keeper, webhook, the chain reader, the owner's transactions, the site's display helpers, ABI drift)
cd app && npm ci && npm run typecheck && npm test

# Web site: typecheck and production build into app/web/dist
cd app/web && npm ci && npm run build

# End to end, 21 checks. Forks Arc mainnet locally, opens a real loan in the real cirBTC market with throwaway
# keys, deploys LoanShield, then runs the same protect / keeper / webhook / status code used on mainnet.
scripts/e2e-local.sh

# The My loan page in Chrome, 22 checks. Same kind of fork and a fresh loan, driven through a test wallet that
# forwards to it: connect, protect, withdraw, change the policy, add, turn off, each checked on-chain.
# Needs Google Chrome and npm ci in app/web. Pass a directory to also save screenshots.
scripts/e2e-browser.sh

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

## Web site

`app/web/` is a React app (Vite and React Router) with seven pages: `/` (overview), `/app` (My loan: connect a wallet to protect and manage your loan), `/demo` (the live demo loan, read-only), `/how-it-works`, `/compare` (each competitor fact links its source), `/market` (live market figures and a loan planner) and `/developers`. It has dark and light themes and a 3D hero built with three.js, which loads lazily. Every chain read goes through `app/public/shield.js`, the dependency-free reader the tests check. Vite bundles it into the site and also serves it on its own at `/shield.js`.

A loan's page shows its live health factor against its trigger, target and liquidation point. It also shows the buffer, the policy, every rescue with links to explorer.arc.io, and whether a rescue would run right now. It gets that last answer from an `eth_call` of `rescue`, and it decodes the revert, such as `NotInDanger(health factor, trigger)`. Reading needs no wallet anywhere on the site. The photos of people are Unsplash stock, credited where they appear; they illustrate use cases and aren't customers.

My loan (`/app`) is where a borrower turns protection on. It lists the browser's wallets (EIP-6963, with `window.ethereum` as a fallback). Once one connects, the page reads that address's loan and asks the wallet to switch to Arc if it's on another network. Then it offers one form: how much standby USDC to deposit, prefilled with what the first rescue would repay, and when to rescue (three presets, or custom numbers checked against `setPolicy`'s bounds before anything is sent). Beside it, it shows where rescues would start and where liquidation would move. Review lists the transactions: an `approve` for exactly the amount, `deposit`, and `setPolicy`. Each is simulated with `eth_call`, then sent by the wallet, which shows and signs it; the site never sees a key. Once a loan is protected, the same place offers Add USDC, Withdraw, Change policy and Turn off. Any other address opens read-only.

Which loan `/app` shows comes from URL parameters: `?borrower=0x…` (otherwise the connected wallet's), `&shield=0x…` and optionally `&market=0x…`. The defaults are the live shield and the cirBTC market; `/demo` always shows the demo loan. To look at a loan on a local fork (for example one made by `e2e/setup-local-loan.ts` against `arc-anvil`), run the dev server and add `rpc`:

```sh
cd app/web && npm ci && npm run dev
# http://127.0.0.1:5173/app?rpc=http://127.0.0.1:8547&shield=0x…&borrower=0x…
```

`?rpc=` accepts only `http://127.0.0.1:<port>` or `http://localhost:<port>`. Any other value is ignored, so a shared link can't point the page at someone else's node. In fork mode, the site shows a "Local fork" chip and prints fork-only addresses and transactions as plain text instead of explorer links.

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

These are the amounts the demo used, from a 10 USDC wallet. 6.5 USDC bought the cirBTC. For a 4 USDC loan, Borrow Kit took 0.00006861 cirBTC as collateral, which put the loan at health factor 1.236. The deploy cost 0.043 USDC; every other transaction costs well under 0.01. The 4 USDC borrowed lands in the wallet and pays for the 2 USDC buffer, and 0.1 USDC goes to the keeper wallet. Borrow Kit sizes the collateral itself, so if its quote wants more cirBTC than the wallet holds, borrow less.

```sh
# Fill in PRIVATE_KEY (the borrower's key) in app/.env yourself
cd app && cp .env.example .env
# Swap Kit: USDC → cirBTC
npm run buy-cirbtc -- 6.5 --yes
# Borrow Kit: borrow USDC against cirBTC
npm run open-loan -- 4 --yes

# Deploy from the repo root with your own keystore account (arc-cast wallet import <name> --interactive),
# then set SHIELD_ADDRESS in app/.env
arc-forge script script/Deploy.s.sol --rpc-url arc --account <name> --broadcast

# Deposit 2 USDC; rescue below 1.1, back up to 1.5
npm run protect -- 2 1.1 1.5 --yes
# Morpho, Borrow Kit and the shield, side by side
npm run status -- <borrower>
npm run register-webhook -- https://<host>/api/webhook --yes
# Needs WATCH=<borrower>:<market id> and KEEPER_PRIVATE_KEY in app/.env
npm run keeper
```

Each comment sits on its own line because zsh, macOS's default shell, doesn't treat `#` as a comment at an interactive prompt unless `interactive_comments` is set, so `npm run protect -- 2 1.1 1.5 # note` passes `#` to the script as the market id.

**A live rescue without waiting for BTC to fall.** The contract accepts any trigger above 1, so raise it just above the loan's current health factor with `npm run protect -- 0 1.3 1.8 --yes` (a buffer of 0 only updates the policy). The keeper's next pass rescues the loan. It repays 1 − HF/target of the debt from the buffer: at HF 1.236 that is 1 − 1.236/1.8 ≈ 31%, about 1.25 USDC of a 4 USDC loan. Borrow Kit picks the loan's starting health factor, so take the trigger and target from what `status` shows.

`KEEPER_PRIVATE_KEY` should be a separate wallet that holds a few cents of USDC for gas: 0.1 USDC pays for more than 25 rescues at ≈ 0.0036 each. It can only call `rescue`, which repays loans from their owners' own buffers.

## Supply chain and known issues

- **Exact pins.** All npm dependencies are pinned to exact versions published at least two weeks before 2026-10-12, with one exception. The Circle packages (`@circle-fin/borrow-kit` 1.0.0, `swap-kit` 1.7.1, `adapter-viem-v2` 1.19.0) were all published on 2026-09-30, because Borrow Kit 1.0.0 is the first release. CI checks the Arc Foundry download against its published sha256. `lib/forge-std` is vendored at v1.17.0.
- **`npm audit --omit=dev` reports 19 vulnerabilities** (7 low, 8 moderate, 4 high). All four highs come through `@circle-fin/swap-kit` → `@coral-xyz/anchor` → `toml`, which are Solana dependencies. The suggested fix downgrades Swap Kit to 1.3.1, a breaking change. Swap Kit is used only by `scripts/buy-cirbtc.ts`, a one-off script run on the borrower's machine. The keeper and the webhook don't import it.

## Limitations and what's next

- A rescue needs USDC in the buffer. A partial rescue happens if the buffer runs short, and `EmptyBuffer` if it is empty. The page shows the buffer next to the debt.
- The keeper must be running, or the webhook reachable, for a rescue to happen in time. Because `rescue` is permissionless, any number of independent keepers can watch the same loan.
- A webhook only wakes one deployment's keeper for the loans in its `WATCH` list. Serving many users needs a watch list kept in storage, which is planned. Until then, a loan protected on My loan needs a keeper of its own (anyone can send `rescue`); the page says so and gives the command.
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
app/web/                        the React site: pages, components and display helpers
app/public/                     the dependency-free chain reader (shield.js), also served at /shield.js
app/e2e/                        local-fork helpers and the read-only mainnet check
app/web/e2e/                    the browser check of My loan (Playwright, Chrome)
scripts/e2e-local.sh            the end-to-end run
scripts/e2e-browser.sh          the browser end-to-end run of My loan
scripts/verify-submission.sh    pre-submission checks (repo, claims, secrets, live deployment)
```

## License

MIT, see [LICENSE](LICENSE).
