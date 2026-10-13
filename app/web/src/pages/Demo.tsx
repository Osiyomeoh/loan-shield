// /demo: the project's own demo loan on Arc mainnet, read live. Nothing here sends a transaction.
import { Link } from "react-router";
import { DEFAULTS } from "../config";
import { IconArrow, IconWallet } from "../components/Icons";
import { LoanDashboard, Lookup, ReadStatus } from "../components/LoanDashboard";
import { Reveal } from "../components/Reveal";
import { useTitle } from "../lib/useTitle";

export default function Demo() {
  useTitle("Live demo");
  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <Reveal className="card-head page-head" style={{ marginBottom: 24 }}>
        <div>
          <span className="eyebrow">Live demo</span>
          <h2 style={{ fontSize: "clamp(28px, 3.4vw, 42px)" }}>The demo loan, protected</h2>
        </div>
        <span className="small muted">
          <ReadStatus loan={DEFAULTS} /> · nothing is sent
        </span>
      </Reveal>
      <LoanDashboard
        loan={DEFAULTS}
        badge="Demo loan"
        owner={
          <section className="card cta-strip">
            <div>
              <b>This is the project's own loan on Arc mainnet.</b>
              <p className="small muted">Have a Borrow Kit loan? Connect its wallet to see it here and turn protection on.</p>
            </div>
            <Link to="/app" className="btn primary">
              <IconWallet width={16} height={16} /> Protect my loan <IconArrow />
            </Link>
          </section>
        }
      />
      <div style={{ marginTop: 24 }}>
        <Lookup />
      </div>
    </div>
  );
}
