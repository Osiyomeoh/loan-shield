import { useId } from "react";
import { Link } from "react-router";

// The mark: a shield with standby USDC filling its lower half, topped by an arrow that points up,
// because a rescue lifts the loan's health factor back up. Same drawing as public/favicon.svg.
const SHIELD_PATH = "M16 6 9 8.7v6.1c0 5 3 8.8 7 10.6 4-1.8 7-5.6 7-10.6V8.7z";
const RESERVE_PATH = "M7 19.4 16 13.6l9 5.8V28H7z";

function BrandMark() {
  // Brand renders in the nav and the footer, so each copy needs its own gradient ids.
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const url = (name: string) => `url(#${id}${name})`;
  return (
    <svg viewBox="0 0 32 32">
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1c1f38" />
          <stop offset="1" stopColor="#0a0b16" />
        </linearGradient>
        <radialGradient id={`${id}glow`} cx="16" cy="14" r="13" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7c6cff" stopOpacity="0.4" />
          <stop offset="1" stopColor="#7c6cff" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}rim`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8b7cff" stopOpacity="0.95" />
          <stop offset="0.5" stopColor="#8b7cff" stopOpacity="0.15" />
          <stop offset="1" stopColor="#22d3ee" stopOpacity="0.75" />
        </linearGradient>
        <linearGradient id={`${id}ink`} x1="9" y1="6" x2="23" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#a796ff" />
          <stop offset="1" stopColor="#2fe0f5" />
        </linearGradient>
        <clipPath id={`${id}clip`}>
          <path d={SHIELD_PATH} />
        </clipPath>
      </defs>
      <rect width="32" height="32" rx="9" fill={url("bg")} />
      <rect width="32" height="32" rx="9" fill={url("glow")} />
      <rect x="0.6" y="0.6" width="30.8" height="30.8" rx="8.4" fill="none" stroke={url("rim")} strokeWidth="1.2" />
      <g transform="translate(16 15.7) scale(1.12) translate(-16 -15.7)">
        <path d={RESERVE_PATH} fill={url("ink")} clipPath={url("clip")} />
        <path d={SHIELD_PATH} fill="none" stroke={url("ink")} strokeWidth="2" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

export function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Loan Shield home">
      <span className="brand-mark" aria-hidden="true">
        <BrandMark />
      </span>
      <span className="brand-name">Loan Shield</span>
    </Link>
  );
}
