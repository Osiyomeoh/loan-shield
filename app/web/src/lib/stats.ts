// The shield's totals from the hosted /api/stats (app/api/stats.ts), which rebuilds them from the contract's events
// on Arc mainnet. Not on a local fork, whose shield the hosted function doesn't read, and not under `vite dev`, which
// doesn't serve /api: there the request fails and the section stays hidden.
import { useEffect, useState } from "react";
import { onFork } from "../config";

export type ShieldStats = {
  shield: string;
  block: number;
  loansProtected: number;
  policies: number;
  /** Decimal USDC, e.g. "0.746771". */
  usdcOnStandby: string;
  rescues: number;
  repaidByRescues: string;
};

/** undefined while loading, null when unavailable. */
export function useShieldStats(): ShieldStats | null | undefined {
  const [stats, setStats] = useState<ShieldStats | null | undefined>(onFork ? null : undefined);
  useEffect(() => {
    if (onFork) return;
    let live = true;
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => live && setStats(body?.ok ? (body as ShieldStats) : null))
      .catch(() => live && setStats(null));
    return () => {
      live = false;
    };
  }, []);
  return stats;
}
