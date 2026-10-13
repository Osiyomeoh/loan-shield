import { DEFAULTS, onFork } from "../config";
import { useLive } from "../lib/live";

/** "Arc mainnet · block N", live; red when the RPC fails. */
export function LiveChip({ compact = false }: { compact?: boolean }) {
  const { block, error } = useLive(DEFAULTS);
  const where = onFork ? "Local fork" : "Arc mainnet";
  if (error && block === undefined) {
    return (
      <span className="chip down" role="status" title={error}>
        <i className="dot" /> {where} unreachable
      </span>
    );
  }
  return (
    <span className={`chip ${block !== undefined ? "live" : ""}`} role="status">
      <i className="dot" />
      {block === undefined ? `Connecting to ${where}…` : compact ? `${where} · ${block.toLocaleString("en-US")}` : `${where} · block ${block.toLocaleString("en-US")}`}
    </span>
  );
}
