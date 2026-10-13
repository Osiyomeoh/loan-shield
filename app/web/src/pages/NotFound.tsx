import { Link } from "react-router";
import { IconArrow } from "../components/Icons";
import { Reveal } from "../components/Reveal";
import { useTitle } from "../lib/useTitle";

export default function NotFound() {
  useTitle("Page not found");
  return (
    <section className="container nf">
      <Reveal>
        <h1 className="grad">404</h1>
        <p className="lead" style={{ margin: "8px auto 28px" }}>
          There's no page here. The loan is still where you left it.
        </p>
        <div className="btn-row" style={{ justifyContent: "center" }}>
          <Link to="/" className="btn primary">
            Home <IconArrow />
          </Link>
          <Link to="/demo" className="btn ghost">
            Live demo loan
          </Link>
        </div>
      </Reveal>
    </section>
  );
}
