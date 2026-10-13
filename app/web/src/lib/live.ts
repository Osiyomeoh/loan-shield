// Live chain state for one loan, shared by every page that shows it. Reads poll every 20 s while any component
// is subscribed, and the last snapshot stays cached, so moving between pages doesn't start from blank.
import { useEffect, useState, useSyncExternalStore } from "react";
import { rpc, web } from "../config";
import type { LoanState, MarketState } from "./view";

export type Loan = { shield: string; borrower: string; market: string };
export type Rescue = Awaited<ReturnType<typeof web.rescueHistory>>[number] & { time?: number };
export type Snapshot = {
  block?: bigint;
  market?: MarketState;
  loan?: LoanState;
  history?: { deployedAt: bigint; events: Rescue[] };
  error?: string;
};

const POLL_MS = 20_000;

type Entry = {
  loan: Loan;
  valid: boolean;
  snapshot: Snapshot;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
  running: boolean;
  lastRun: number;
  deployedAt?: bigint;
  scannedTo?: bigint;
  events: Rescue[];
};

const entries = new Map<string, Entry>();

export const isValidLoan = (l: Loan) => web.isAddress(l.shield) && web.isAddress(l.borrower) && web.isBytes32(l.market);
const keyOf = (l: Loan) => `${l.shield}|${l.borrower}|${l.market}`.toLowerCase();

function entryFor(loan: Loan): Entry {
  const key = keyOf(loan);
  let e = entries.get(key);
  if (!e) {
    e = { loan, valid: isValidLoan(loan), snapshot: {}, listeners: new Set(), running: false, lastRun: 0, events: [] };
    entries.set(key, e);
  }
  return e;
}

function publish(e: Entry, patch: Partial<Snapshot>) {
  e.snapshot = { ...e.snapshot, ...patch };
  for (const l of e.listeners) l();
}

async function refreshHistory(e: Entry, latest: bigint) {
  e.deployedAt ??= await web.findDeployBlock(rpc, e.loan.shield, latest);
  const fromBlock = e.scannedTo === undefined ? e.deployedAt : e.scannedTo + 1n;
  if (fromBlock <= latest) {
    const found = await web.rescueHistory(rpc, { ...e.loan, fromBlock, toBlock: latest });
    const timed = await Promise.all(found.map(async (r) => ({ ...r, time: await rpc.blockTime(r.blockNumber) })));
    e.events = [...e.events, ...timed];
    e.scannedTo = latest;
  }
  publish(e, { history: { deployedAt: e.deployedAt, events: e.events } });
}

async function refresh(e: Entry) {
  if (e.running) return;
  e.running = true;
  e.lastRun = Date.now();
  try {
    const [block, market] = await Promise.all([rpc.blockNumber(), web.readMarket(rpc, e.loan.market)]);
    const loan = e.valid ? await web.readLoan(rpc, e.loan, market) : undefined;
    publish(e, { block, market, loan, error: undefined });
    if (e.valid) await refreshHistory(e, block);
  } catch (err) {
    publish(e, { error: err instanceof Error ? err.message : String(err) });
  } finally {
    e.running = false;
  }
}

function subscribe(e: Entry, listener: () => void) {
  e.listeners.add(listener);
  if (!e.timer) {
    if (Date.now() - e.lastRun > POLL_MS / 2) void refresh(e);
    e.timer = setInterval(() => void refresh(e), POLL_MS);
  }
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0 && e.timer) {
      clearInterval(e.timer);
      e.timer = undefined;
    }
  };
}

/** Live reads for `loan`: market, loan, rescue history and block, refreshed every 20 s. */
export function useLive(loan: Loan): Snapshot {
  const e = entryFor(loan);
  return useSyncExternalStore(
    (l) => subscribe(e, l),
    () => e.snapshot,
  );
}

export type KeeperStatus = { state: "loading" } | { state: "online"; watching: number; sends: boolean } | { state: "absent" };

let keeperCache: KeeperStatus | undefined;

/** Whether this host runs the Borrow Kit webhook receiver (/api/webhook on Vercel). */
export function useKeeper(): KeeperStatus {
  const [status, setStatus] = useState<KeeperStatus>(keeperCache ?? { state: "loading" });
  useEffect(() => {
    if (keeperCache) return;
    let live = true;
    fetch("/api/webhook", { headers: { accept: "application/json" } })
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const k = (await res.json()) as { ok?: boolean; watching?: number; sends?: boolean };
        if (k.ok !== true) throw new Error("not the webhook");
        return { state: "online", watching: Number(k.watching ?? 0), sends: !!k.sends } as const;
      })
      .catch(() => ({ state: "absent" }) as const)
      .then((s) => {
        keeperCache = s;
        if (live) setStatus(s);
      });
    return () => {
      live = false;
    };
  }, []);
  return status;
}
