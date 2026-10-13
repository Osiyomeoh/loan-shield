import type { ReactNode } from "react";

/** An endless, pausable ticker. The items render twice so the loop is seamless; the copy is hidden from readers. */
export function Marquee({ items }: { items: ReactNode[] }) {
  return (
    <div className="marquee" role="region" aria-label="Live figures">
      <div className="marquee-track">
        <ul>{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
        <ul aria-hidden="true">{items.map((it, i) => <li key={i}>{it}</li>)}</ul>
      </div>
    </div>
  );
}
