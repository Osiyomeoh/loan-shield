// Connecting a browser wallet: the nav's button and the list of wallets on the My loan page.
import { Link, useNavigate } from "react-router";
import { web } from "../config";
import { short } from "../lib/format";
import { connect, useWallet } from "../lib/wallet";
import { IconArrow, IconWallet } from "./Icons";

/** Every wallet this browser offers, as buttons. EIP-6963 icons are data: URIs, shown only as images. */
export function WalletChoices() {
  const w = useWallet();
  if (!w.ready) return <p className="small muted">Looking for wallets in this browser…</p>;
  if (w.wallets.length === 0) {
    return <p className="result warn small">No browser wallet found. Install a wallet extension that lets you add a network, then reload this page.</p>;
  }
  return (
    <div className="wallets">
      {w.wallets.map((x) => (
        <button key={x.info.uuid} type="button" className="wallet-opt" onClick={() => void connect(x)} disabled={w.status === "connecting"}>
          {x.info.icon.startsWith("data:image/") ? <img src={x.info.icon} alt="" width={28} height={28} /> : <IconWallet width={28} height={28} />}
          <span>{x.info.name}</span>
          <IconArrow />
        </button>
      ))}
      {w.status === "connecting" && (
        <p className="small muted" role="status">
          Waiting for your wallet…
        </p>
      )}
      {w.error && (
        <p className="bad small" role="alert">
          {w.error}
        </p>
      )}
    </div>
  );
}

/** The nav's wallet button: the connected account, or Connect, which goes to My loan. */
export function WalletButton() {
  const w = useWallet();
  const navigate = useNavigate();
  if (w.status === "connected" && w.account) {
    const wrong = w.chainId !== web.ARC.chainId;
    return (
      <Link to="/app" className={`wallet-btn ${wrong ? "wrong" : ""}`} title={wrong ? "Your wallet is on another network" : "My loan"}>
        <span className="dot" aria-hidden="true" />
        <span className="num">{short(w.account)}</span>
      </Link>
    );
  }
  return (
    <button
      type="button"
      className="btn primary sm wallet-btn"
      disabled={w.status === "connecting"}
      onClick={() => {
        navigate("/app");
        // With exactly one wallet there is nothing to choose, so ask it straight away.
        if (w.wallets.length === 1) void connect(w.wallets[0]!);
      }}
    >
      <IconWallet width={16} height={16} />
      {w.status === "connecting" ? "Connecting…" : "Connect"}
    </button>
  );
}
