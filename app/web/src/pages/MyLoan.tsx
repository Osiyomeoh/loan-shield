// /app: the visitor's own loan. Connect a wallet, the page finds its loan, and the owner turns protection on and
// manages it here. With ?borrower=… it shows any loan read-only, and the owner's controls when it is theirs.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router";
import { DEFAULTS, REPO, web } from "../config";
import { IconCheck } from "../components/Icons";
import { Ext } from "../components/Links";
import { LoanDashboard, loanLink, Lookup, ReadStatus } from "../components/LoanDashboard";
import { ManagePanel, ProtectForm, WhoWatches, WithdrawForm, type Owner } from "../components/Protect";
import { Reveal } from "../components/Reveal";
import { WalletChoices } from "../components/Wallet";
import { short, usdc } from "../lib/format";
import { isDemoLoan, refreshNow, useFunds, useLive, type Loan } from "../lib/live";
import { useTitle } from "../lib/useTitle";
import type { LoanState } from "../lib/view";
import { disconnect, switchToArc, useWallet } from "../lib/wallet";

function Head({ eyebrow, title, right }: { eyebrow: string; title: string; right?: ReactNode }) {
  return (
    <Reveal className="card-head page-head" style={{ marginBottom: 24 }}>
      <div>
        <span className="eyebrow">{eyebrow}</span>
        <h2 style={{ fontSize: "clamp(28px, 3.4vw, 42px)" }}>{title}</h2>
      </div>
      {right}
    </Reveal>
  );
}

const JOURNEY = [
  { title: "Connect", text: "The wallet that holds your loan. The page finds the loan on Arc by itself." },
  { title: "Choose", text: "How much standby USDC to park, and the health factor where a rescue starts." },
  { title: "Confirm", text: "Two or three transactions in your wallet. Gas is paid in USDC, well under 0.01 each." },
];

function ConnectCard() {
  return (
    <section className="card connect">
      <div>
        <span className="eyebrow">My loan</span>
        <h1 className="headline">Protect your Borrow Kit loan</h1>
        <p className="subline">
          Connect the wallet that borrowed. You'll see your loan, pick a buffer and a trigger, and confirm in your wallet. The site never sees a key: your wallet shows and signs every transaction.
        </p>
        <ol className="journey">
          {JOURNEY.map((j, i) => (
            <li key={j.title}>
              <span className="journey-no">{i + 1}</span>
              <div>
                <b>{j.title}</b>
                <p>{j.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <div className="connect-box">
        <h3>Connect a wallet</h3>
        <WalletChoices />
        <p className="small muted">
          Just looking? Reading needs no wallet: <Link to="/demo" className="link">see the live demo loan</Link>.
        </p>
      </div>
    </section>
  );
}

function SwitchCard() {
  const w = useWallet();
  return (
    <section className="card">
      <div className="card-head">
        <h3>Switch your wallet to Arc</h3>
        <span className="pill warn">On chain {w.chainId}</span>
      </div>
      <p className="small">Your loan lives on Arc mainnet (chain 5042), so your transactions have to go there too. If your wallet doesn't know Arc yet, it asks to add it first.</p>
      <div className="btn-row" style={{ marginTop: 16 }}>
        <button type="button" className="btn primary" onClick={() => void switchToArc()}>
          Switch to Arc
        </button>
      </div>
      {w.error && (
        <p className="bad small" role="alert" style={{ marginTop: 10 }}>
          {w.error}
        </p>
      )}
    </section>
  );
}

function ProtectCard({ owner }: { owner: Owner }) {
  const [withdraw, setWithdraw] = useState(false);
  return (
    <section className="card protect-card">
      <div className="card-head">
        <div>
          <h3>Turn on protection</h3>
          <p className="small muted" style={{ marginTop: 6 }}>
            Standby USDC waits in the shield. If your health factor falls below the trigger, a rescue repays just enough of your debt from it to lift you back to the target.
          </p>
        </div>
      </div>
      {withdraw ? <WithdrawForm owner={owner} onCancel={() => setWithdraw(false)} /> : <ProtectForm owner={owner} mode="protect" />}
      {owner.s.buffer > 0n && !withdraw && (
        <p className="small muted" style={{ marginTop: 14 }}>
          Your buffer already holds {usdc(owner.s.buffer)}.{" "}
          <button type="button" className="link" onClick={() => setWithdraw(true)}>
            Withdraw it instead
          </button>
        </p>
      )}
    </section>
  );
}

const hasNothing = (s: LoanState) => s.debt === 0n && s.trigger === 0n && s.buffer === 0n;

function NoLoan({ loan, owner }: { loan: Loan; owner?: Owner }) {
  const [early, setEarly] = useState(false);
  return (
    <div className="stack">
      <section className="card">
        <span className="pill">No loan found</span>
        <h1 className="headline" style={{ marginTop: 12 }}>
          {short(loan.borrower)} has no loan here yet
        </h1>
        <p className="subline">
          Loan Shield protects a loan that is already open: a Morpho loan in the cirBTC / USDC market, the one Borrow Kit lends from. This wallet has no debt in it. Once it borrows, this page finds the loan by itself.
        </p>
        <div className="btn-row" style={{ marginTop: 20 }}>
          <Link to="/demo" className="btn primary">
            See a protected loan
          </Link>
          {owner && !early && (
            <button type="button" className="btn ghost" onClick={() => setEarly(true)}>
              Set it up before borrowing
            </button>
          )}
        </div>
        <p className="small muted" style={{ marginTop: 16 }}>
          Borrowed from another wallet? Switch accounts in your wallet. Opening a loan from a terminal is in the repo's <Ext href={`${REPO}#run-it-on-mainnet-operator-steps`}>operator steps</Ext> (<code>npm run open-loan</code>).
        </p>
      </section>
      {owner && early && <ProtectCard owner={owner} />}
    </div>
  );
}

/** The connected owner's page: their loan, and the controls to protect it. */
function OwnerView({ loan, account }: { loan: Loan; account: string }) {
  const w = useWallet();
  const { loan: s, market } = useLive(loan);
  const { funds, error: fundsError, reload } = useFunds(account, loan.shield);
  const price = market ? web.collateralPrice(market) : 0;
  const demo = isDemoLoan(loan);

  // Say so when protection turns on or off: the form that did it is replaced by the next state's controls.
  const [flash, setFlash] = useState<string>();
  const on = s ? s.trigger > 0n : undefined;
  const was = useRef(on);
  useEffect(() => {
    if (was.current !== undefined && on !== undefined && was.current !== on) {
      setFlash(on ? "Protection is on. A rescue can now run whenever your health factor falls below the trigger." : "Protection is off for this loan.");
    }
    was.current = on;
  }, [on]);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(undefined), 12_000);
    return () => clearTimeout(t);
  }, [flash]);

  const onDone = () => {
    refreshNow(loan);
    reload();
  };
  const wrongChain = w.chainId !== web.ARC.chainId;
  const owner: Owner | undefined = s && funds ? { loan, s, price, funds, account, onDone } : undefined;

  let controls: ReactNode;
  if (wrongChain) controls = <SwitchCard />;
  else if (!owner) {
    controls = (
      <section className="card">
        <p className={fundsError ? "bad small" : "small muted"}>{fundsError ? `Couldn't read your wallet's USDC: ${fundsError}` : "Reading your wallet's USDC…"}</p>
      </section>
    );
  } else controls = owner.s.trigger > 0n ? <ManagePanel owner={owner} /> : <ProtectCard owner={owner} />;

  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <Head
        eyebrow="My loan"
        title={demo ? "Your loan: the demo loan" : "Your loan, live from Arc"}
        right={
          <div className="account">
            <ReadStatus loan={loan} />
            <span className="chip num">
              <span className={`dot ${wrongChain ? "warn" : "good"}`} aria-hidden="true" />
              {short(account)}
            </span>
            <button type="button" className="btn ghost sm" onClick={disconnect}>
              Disconnect
            </button>
          </div>
        }
      />
      {flash && (
        <p className="result good flash" role="status">
          <IconCheck /> {flash}
        </p>
      )}
      {s && hasNothing(s) ? (
        <NoLoan loan={loan} owner={wrongChain ? undefined : owner} />
      ) : (
        <LoanDashboard
          loan={loan}
          owner={
            <>
              {controls}
              <WhoWatches loan={loan} account={account} />
            </>
          }
          hideKeeper
        />
      )}
      <div style={{ marginTop: 24 }}>
        <Lookup title="Check another address" />
      </div>
    </div>
  );
}

/** Someone else's loan, or any loan while no wallet is connected: read-only. */
function ReadOnlyView({ loan, account }: { loan: Loan; account?: string }) {
  const demo = isDemoLoan(loan);
  const { loan: s } = useLive(loan);
  const mine = loanLink({ shield: loan.shield, market: loan.market });
  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <Head
        eyebrow="Loan lookup"
        title={demo ? "The demo loan, protected" : "A loan, read live from Arc"}
        right={
          <span className="small muted">
            <ReadStatus loan={loan} /> · nothing is sent
          </span>
        }
      />
      <p className="small muted" style={{ marginBottom: 16 }}>
        {account ? (
          <>
            This isn't your connected wallet's loan, so it's read-only. <Link to={mine} className="link">Back to my loan</Link>
          </>
        ) : (
          <>
            Read-only. Is this your loan? <Link to={mine} className="link">Connect its wallet</Link> to protect or manage it.
          </>
        )}
      </p>
      {s && hasNothing(s) ? <NoLoan loan={loan} /> : <LoanDashboard loan={loan} badge="Read-only" />}
      <div style={{ marginTop: 24 }}>
        <Lookup loan={loan} />
      </div>
    </div>
  );
}

export default function MyLoan() {
  const [params] = useSearchParams();
  const w = useWallet();
  const asked = params.get("borrower") ?? undefined;
  const account = w.status === "connected" ? w.account : undefined;
  const borrower = asked ?? account;
  const mine = !!account && !!borrower && account.toLowerCase() === borrower.toLowerCase();
  useTitle(borrower && !mine ? "Loan lookup" : "My loan");

  if (!borrower) {
    return (
      <div className="container" style={{ paddingTop: 40 }}>
        {w.ready ? (
          <div className="stack">
            <ConnectCard />
            <Lookup title="Or check any address, no wallet needed" />
          </div>
        ) : (
          <section className="card connect" aria-busy="true">
            <span className="skel" style={{ width: "60%", height: 40 }} />
            <span className="skel" style={{ width: "100%", height: 160 }} />
          </section>
        )}
      </div>
    );
  }
  const loan = { shield: params.get("shield") ?? DEFAULTS.shield, borrower, market: params.get("market") ?? DEFAULTS.market };
  return mine ? <OwnerView loan={loan} account={account!} /> : <ReadOnlyView loan={loan} account={account} />;
}
