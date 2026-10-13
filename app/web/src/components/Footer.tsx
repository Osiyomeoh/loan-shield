import { Link } from "react-router";
import { DEFAULTS, REPO, web } from "../config";
import { PHOTOS } from "../lib/photos";
import { Brand } from "./Brand";
import { Ext } from "./Links";

export function Footer() {
  return (
    <footer className="footer">
      <div className="container footer-grid">
        <div className="footer-brand">
          <Brand />
          <p className="muted">Standby USDC that rescues your Morpho loan on Arc before a liquidator can take your BTC. Every number on this site is read live from Arc mainnet in your browser. No wallet, no sign-in.</p>
        </div>
        <div>
          <h4>Product</h4>
          <Link to="/app">Live dashboard</Link>
          <Link to="/how-it-works">How it works</Link>
          <Link to="/compare">Compare</Link>
          <Link to="/market">Market</Link>
        </div>
        <div>
          <h4>Build</h4>
          <Link to="/developers">Developers</Link>
          <Ext href={REPO}>Source and tests</Ext>
          <Ext href={`${REPO}/blob/main/CLAIMS.md`}>What's built vs planned</Ext>
          <Ext href={`${web.ARC.explorer}/address/${DEFAULTS.shield}`}>Contract on explorer.arc.io</Ext>
        </div>
        <div>
          <h4>Photos</h4>
          {Object.values(PHOTOS).map((p) => (
            <Ext key={p.id} href={p.page}>
              {p.by} / Unsplash
            </Ext>
          ))}
        </div>
      </div>
      <div className="container footer-base muted">
        <span>MIT licensed. Not financial advice: a rescue only runs if someone sends it, and only while the buffer lasts.</span>
      </div>
    </footer>
  );
}
