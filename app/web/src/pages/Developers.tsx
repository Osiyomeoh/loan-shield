import { DEFAULTS, REPO, USDC, web } from "../config";
import { CodeBlock, CopyButton } from "../components/Copy";
import { IconCode, IconGithub } from "../components/Icons";
import { Explorer, Ext } from "../components/Links";
import { Reveal } from "../components/Reveal";
import { PageHero, SectionHead } from "../components/Section";
import { useKeeper } from "../lib/live";
import { useTitle } from "../lib/useTitle";

const ORACLE = "0x2AA87fF48933Ce6aBA240BEE916Fc2e6Ec1e51Ab";
const CIRBTC = "0x171A4217b86A807A64eB94757Db6849fb4bDbAA0";

const ADDRESSES: { k: string; v: string; path?: string }[] = [
  { k: "LoanShield", v: DEFAULTS.shield, path: `address/${DEFAULTS.shield}` },
  { k: "Morpho Blue", v: web.MORPHO, path: `address/${web.MORPHO}` },
  { k: "USDC", v: USDC, path: `address/${USDC}` },
  { k: "cirBTC", v: CIRBTC, path: `address/${CIRBTC}` },
  { k: "cirBTC / USDC market id", v: web.CIRBTC_MARKET },
  { k: "Market oracle", v: ORACLE, path: `address/${ORACLE}` },
];

const FUNCTIONS: { sig: string; text: string }[] = [
  { sig: "deposit(uint256 amount)", text: "Park USDC in your own buffer. Approve the contract first." },
  { sig: "withdraw(uint256 amount)", text: "Take USDC back out of your own buffer. Always available." },
  { sig: "setPolicy(bytes32 id, uint256 trigger, uint256 target)", text: "Health factors in WAD: 1e18 < trigger < target ≤ 10e18. Only markets whose loan token is USDC." },
  { sig: "clearPolicy(bytes32 id)", text: "Turn protection off for that market." },
  { sig: "healthFactor(address borrower, bytes32 id) → uint256", text: "WAD, including interest owed since the market's last update. type(uint256).max with no debt." },
  { sig: "preview(address borrower, bytes32 id) → Preview", text: "Exactly what rescue would do in this block: status, healthFactor, trigger, target, repayAssets, repayShares, healthFactorAfter." },
  { sig: "rescue(address borrower, bytes32 id) → (assets, healthFactorAfter)", text: "Anyone may call it. Reverts unless health is below the borrower's trigger." },
  { sig: "buffer(address owner) → uint256", text: "USDC parked by that owner, in 6-decimal units." },
  { sig: "policy(address owner, bytes32 id) → (trigger, target)", text: "The owner's policy for that market. A trigger of 0 means none." },
];

const EVENTS = [
  "Deposited(address indexed owner, uint256 amount)",
  "Withdrawn(address indexed owner, uint256 amount)",
  "PolicySet(address indexed owner, bytes32 indexed id, uint256 trigger, uint256 target)",
  "PolicyCleared(address indexed owner, bytes32 indexed id)",
  "Rescued(address indexed borrower, bytes32 indexed id, address indexed caller, uint256 assets, uint256 shares, uint256 healthFactorBefore, uint256 healthFactorAfter)",
];

const ERRORS = [
  "ZeroAmount()",
  "InsufficientBuffer(available, requested)",
  "InvalidPolicy(trigger, target)",
  "UnsupportedMarket(id)",
  "NoPolicy()",
  "NoDebt()",
  "NotInDanger(healthFactor, trigger)",
  "EmptyBuffer()",
  "UnexpectedRepay(assets, shares)",
  "NoImprovement(before, after)",
  "TransferFailed()",
  "Reentrancy()",
  "Uint128Overflow()",
];

const RPC = web.ARC.rpc;

const CAST_HF = `cast call ${DEFAULTS.shield} \\
  "healthFactor(address,bytes32)(uint256)" \\
  ${DEFAULTS.borrower} \\
  ${web.CIRBTC_MARKET} \\
  --rpc-url ${RPC}`;

const CAST_PREVIEW = `cast call ${DEFAULTS.shield} \\
  "preview(address,bytes32)((uint8,uint256,uint256,uint256,uint256,uint256,uint256))" \\
  ${DEFAULTS.borrower} \\
  ${web.CIRBTC_MARKET} \\
  --rpc-url ${RPC}`;

const JS_READ = `import { ARC, CIRBTC_MARKET, createRpc, readMarket, readLoan, formatWad } from "./shield.js";

const rpc = createRpc(ARC.rpc);
const market = await readMarket(rpc);
const loan = await readLoan(rpc, {
  shield: "${DEFAULTS.shield}",
  borrower: "${DEFAULTS.borrower}",
  market: CIRBTC_MARKET,
}, market);

console.log(formatWad(loan.healthFactor, 2), loan.preview.status);`;

const KEEPER = `git clone ${REPO}.git
cd loan-shield/app
npm ci
npm run keeper`;

function KeeperStatus() {
  const k = useKeeper();
  if (k.state === "loading") return <span className="pill">Checking…</span>;
  if (k.state === "absent") return <span className="pill">Not on this host</span>;
  return (
    <span className={`pill ${k.sends ? "good" : "warn"}`}>
      {k.sends ? "Sending rescues" : "Report-only"} · watching {k.watching}
    </span>
  );
}

export default function Developers() {
  useTitle("Developers");
  return (
    <>
      <PageHero
        eyebrow="Developers"
        title={
          <>
            One contract. <span className="grad">No admin keys.</span>
          </>
        }
        aside={
          <div className="btn-row">
            <Ext href={REPO} className="btn primary sm">
              <IconGithub /> Source on GitHub
            </Ext>
            <Ext href={`${REPO}/blob/main/CLAIMS.md`} className="btn ghost sm">
              CLAIMS.md
            </Ext>
          </div>
        }
      >
        Read any loan's protection with plain <code>eth_call</code>s, run your own keeper, or send a rescue yourself. Every address and signature below is from the deployed contract and the repo.
      </PageHero>

      <section className="container section tight" style={{ paddingTop: 12 }}>
        <Reveal className="card">
          <div className="card-head">
            <h3>Addresses on Arc mainnet</h3>
            <span className="tag">chain {web.ARC.chainId}</span>
          </div>
          <div className="addr-list">
            {ADDRESSES.map((a) => (
              <div key={a.k} className="addr">
                <span className="k">{a.k}</span>
                <span className="v">{a.path ? <Explorer path={a.path}>{a.v}</Explorer> : a.v}</span>
                <CopyButton text={a.v} label="Copy" />
              </div>
            ))}
          </div>
          <p className="note" style={{ marginTop: 18 }}>
            Source verification on explorer.arc.io is planned. The deployed runtime code matches the repo's build byte for byte, apart from the two constructor addresses.
          </p>
        </Reveal>
      </section>

      <section className="container section" style={{ paddingTop: 40 }}>
        <SectionHead eyebrow="Read" title="Check a loan from your terminal." >
          These are the demo loan's real values. The health factor and buffer come back in WAD and 6-decimal USDC units.
        </SectionHead>
        <div className="grid2" style={{ gap: 24, alignItems: "start" }}>
          <Reveal className="stack">
            <h3 style={{ fontSize: 17 }}>Health factor, with Foundry</h3>
            <CodeBlock code={CAST_HF} label="cast call healthFactor" />
            <h3 style={{ fontSize: 17, marginTop: 10 }}>What a rescue would do now</h3>
            <CodeBlock code={CAST_PREVIEW} label="cast call preview" />
            <p className="muted small">
              Status is an enum: 0 Ready, 1 NoPolicy, 2 NoDebt, 3 NotInDanger, 4 EmptyBuffer.
            </p>
          </Reveal>
          <Reveal className="stack" delay={0.08}>
            <h3 style={{ fontSize: 17 }}>In JavaScript, with no dependencies</h3>
            <CodeBlock code={JS_READ} label="shield.js example" />
            <p className="muted small">
              Copy <Ext href={`${REPO}/blob/main/app/public/shield.js`}>app/public/shield.js</Ext> from the repo next to your script. It's the same reader this site uses: one file, no imports, plain <code>fetch</code> to the RPC.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 0 }}>
        <SectionHead eyebrow="Interface" title="Functions, events and errors." />
        <div className="grid2" style={{ gap: 24, alignItems: "start" }}>
          <Reveal className="card">
            <div className="card-head">
              <h3>Functions</h3>
              <IconCode />
            </div>
            <dl className="fn-list">
              {FUNCTIONS.map((f) => (
                <div key={f.sig}>
                  <dt>{f.sig}</dt>
                  <dd>{f.text}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <div className="stack">
            <Reveal className="card" delay={0.06}>
              <div className="card-head">
                <h3>Events</h3>
              </div>
              <ul className="checks" style={{ fontFamily: "var(--mono)", fontSize: 12.5 }}>
                {EVENTS.map((e) => (
                  <li key={e} style={{ overflowWrap: "anywhere" }}>
                    {e}
                  </li>
                ))}
              </ul>
            </Reveal>
            <Reveal className="card" delay={0.1}>
              <div className="card-head">
                <h3>Custom errors</h3>
              </div>
              <div className="err-cloud">
                {ERRORS.map((e) => (
                  <code key={e}>{e}</code>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      <section className="container section" style={{ paddingTop: 0 }}>
        <SectionHead eyebrow="Keep watch" title="Run a keeper." >
          Anyone can rescue a protected loan, so more keepers means fewer missed rescues. The keeper only sends when the contract's <code>preview</code> says Ready and a dry run succeeds.
        </SectionHead>
        <div className="grid2" style={{ gap: 24, alignItems: "start" }}>
          <Reveal className="stack">
            <CodeBlock code={KEEPER} label="Run the keeper" />
            <p className="muted small">
              Before <code>npm run keeper</code>, put <code>SHIELD_ADDRESS</code> and <code>WATCH</code> (a comma-separated list of <code>borrower:marketId</code>) in <code>app/.env</code>. Add <code>KEEPER_PRIVATE_KEY</code> for a wallet holding only gas money; without it the keeper checks and reports but sends nothing. <code>POLL_SECONDS</code> defaults to 30.
            </p>
          </Reveal>
          <Reveal className="card" delay={0.08}>
            <div className="card-head">
              <h3>This site's webhook receiver</h3>
              <KeeperStatus />
            </div>
            <p className="muted">
              <code>/api/webhook</code> takes Borrow Kit's <code>morpho.healthBandCrossed</code> alerts. The payload only wakes it: it re-reads the chain and makes the same decision as the keeper, so a forged alert can't cause a rescue the chain doesn't justify (<Ext href={`${REPO}/blob/main/CLAIMS.md`}>claim 9</Ext>).
            </p>
            <div className="btn-row" style={{ marginTop: 18 }}>
              <Ext href={`${REPO}/tree/main/test`} className="btn ghost sm">
                Contract tests
              </Ext>
              <Ext href={`${REPO}/tree/main/app/test`} className="btn ghost sm">
                App tests
              </Ext>
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
