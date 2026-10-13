import { motion } from "motion/react";
import { useState } from "react";
import { rpc, web } from "../config";
import { short, usdc } from "../lib/format";
import { sendTransaction, walletError } from "../lib/wallet";
import { IconCheck, IconWallet } from "./Icons";
import { Explorer } from "./Links";

export type Step = { tx: web.OwnerTx; title: string; detail?: string };
type Phase = "todo" | "check" | "sign" | "mine" | "done" | "failed";

const PHASE_TEXT: Record<Phase, string> = {
  todo: "",
  check: "Checking it would succeed…",
  sign: "Confirm in your wallet",
  mine: "Waiting for Arc to include it…",
  done: "Done",
  failed: "",
};

/** A LoanShield revert, or another failed check, as a sentence. */
function revertText(r: { name: string; args: bigint[]; message?: string }) {
  const [a = 0n, b = 0n] = r.args;
  const known: Record<string, string> = {
    ZeroAmount: "The amount must be above zero.",
    InsufficientBuffer: `Your buffer holds only ${usdc(a)}, less than the ${usdc(b)} asked for.`,
    InvalidPolicy: "The contract refused this policy: it needs 1 < trigger < target ≤ 10.",
    UnsupportedMarket: "This market doesn't lend USDC, so the shield can't protect it.",
    TransferFailed: "USDC refused the transfer. Check your balance and the approval.",
  };
  return known[r.name] ?? (r.message ? `It would fail: ${r.message}` : `It would fail with ${r.name}.`);
}

/**
 * Sends the owner's transactions one at a time: each is checked with an eth_call from their address, handed to their
 * wallet to sign, and waited on until Arc includes it. A failure stops the run; "Try again" resumes from that step.
 */
export function TxSteps({ steps, account, onDone, onCancel }: { steps: Step[]; account: string; onDone: () => void; onCancel: () => void }) {
  const [phases, setPhases] = useState<Phase[]>(() => steps.map(() => "todo"));
  const [hashes, setHashes] = useState<(string | undefined)[]>(() => steps.map(() => undefined));
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const finished = phases.every((p) => p === "done");

  const run = async () => {
    setRunning(true);
    setError("");
    const phase = (i: number, p: Phase) => setPhases((all) => all.map((x, j) => (j === i ? p : x)));
    try {
      for (let i = 0; i < steps.length; i++) {
        if (phases[i] === "done") continue;
        const { tx } = steps[i]!;
        phase(i, "check");
        const sim = await web.simulateTx(rpc, { from: account, to: tx.to, data: tx.data });
        if (!sim.ok) {
          phase(i, "failed");
          setError(revertText(sim));
          return;
        }
        phase(i, "sign");
        let hash: string;
        try {
          hash = await sendTransaction(tx);
        } catch (err) {
          phase(i, "failed");
          setError(walletError(err));
          return;
        }
        setHashes((all) => all.map((x, j) => (j === i ? hash : x)));
        phase(i, "mine");
        const receipt = await web.waitForReceipt(rpc, hash);
        if (!receipt.ok) {
          phase(i, "failed");
          setError("Arc included the transaction, but it reverted. Nothing changed; you can try again.");
          return;
        }
        phase(i, "done");
      }
      onDone();
    } catch (err) {
      setPhases((all) => all.map((p) => (p === "done" ? p : p === "todo" ? p : "failed")));
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const started = phases.some((p) => p !== "todo");
  return (
    <div className="txsteps">
      <ol>
        {steps.map((s, i) => {
          const p = phases[i]!;
          const hash = hashes[i];
          return (
            <li key={`${s.tx.kind}${i}`} className={`tx-${p}`}>
              <span className="tx-no" aria-hidden="true">
                {p === "done" ? <IconCheck /> : i + 1}
              </span>
              <div>
                <b>{s.title}</b>
                {s.detail && <small>{s.detail}</small>}
                {(PHASE_TEXT[p] || hash) && (
                  <motion.small className="tx-state" initial={{ opacity: 0 }} animate={{ opacity: 1 }} key={p} role={p === "sign" ? "status" : undefined}>
                    {PHASE_TEXT[p]}
                    {hash && (
                      <>
                        {PHASE_TEXT[p] ? " · " : ""}
                        tx <Explorer path={`tx/${hash}`}>{short(hash)}</Explorer>
                      </>
                    )}
                  </motion.small>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {error && (
        <p className="result bad" role="alert">
          {error}
        </p>
      )}
      {finished ? (
        <>
          <p className="result good" role="status">
            All done. The page below now reads the new state from Arc.
          </p>
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button type="button" className="btn ghost sm" onClick={onCancel}>
              Close
            </button>
          </div>
        </>
      ) : (
        <div className="btn-row" style={{ marginTop: 18 }}>
          <button type="button" className="btn primary" onClick={run} disabled={running}>
            <IconWallet /> {running ? "Working…" : error ? "Try again" : steps.length === 1 ? "Confirm in wallet" : `Confirm ${steps.length} steps in wallet`}
          </button>
          {!running && (
            <button type="button" className="btn ghost" onClick={onCancel}>
              {started ? "Close" : "Back"}
            </button>
          )}
        </div>
      )}
      {!started && <p className="small muted" style={{ marginTop: 12 }}>Your wallet shows each transaction before it is sent. Gas is paid in USDC and costs well under 0.01 USDC each.</p>}
    </div>
  );
}
