import { Link } from "react-router";

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Loan Shield home">
      <span className="brand-mark" aria-hidden="true">
        <svg viewBox="0 0 32 32">
          <defs>
            <linearGradient id="brandg" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="var(--accent)" />
              <stop offset="1" stopColor="var(--accent-2)" />
            </linearGradient>
          </defs>
          <path d="M16 2.5 5 6.6v8.2c0 6.9 4.7 12.6 11 14.7 6.3-2.1 11-7.8 11-14.7V6.6L16 2.5z" fill="url(#brandg)" />
          <path d="m11 16.2 3.4 3.4 6.6-7" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <span className="brand-name">Loan Shield</span>
    </Link>
  );
}
