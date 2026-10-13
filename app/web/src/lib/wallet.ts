// The visitor's browser wallet (EIP-1193), found through EIP-6963 announcements or window.ethereum. The site never
// sees a key: it asks the wallet for an account, asks it to switch to Arc, and hands it transactions to sign and send
// (and one gasless typed-data signature, to send Borrow Kit alerts to the keeper).
import { useSyncExternalStore } from "react";
import { onFork, rpc, web } from "../config";

type Listener = (...args: any[]) => void;
type Provider = {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, listener: Listener): void;
  removeListener?(event: string, listener: Listener): void;
};
export type WalletInfo = { uuid: string; name: string; icon: string; rdns: string };
export type Wallet = { info: WalletInfo; provider: Provider };

export type WalletState = {
  /** Wallets this browser offers. */
  wallets: Wallet[];
  /** False until discovery and the silent reconnect have finished, so the page doesn't flash "Connect". */
  ready: boolean;
  status: "disconnected" | "connecting" | "connected";
  wallet?: Wallet;
  account?: string;
  chainId?: number;
  error?: string;
};

export const ARC_CHAIN_HEX = `0x${web.ARC.chainId.toString(16)}`;
const STORAGE_KEY = "loan-shield:wallet";

let state: WalletState = { wallets: [], ready: false, status: "disconnected" };
const listeners = new Set<() => void>();

function set(patch: Partial<WalletState>) {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

const remembered = {
  get: () => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? undefined;
    } catch {
      return undefined;
    }
  },
  set: (rdns: string | undefined) => {
    try {
      if (rdns) localStorage.setItem(STORAGE_KEY, rdns);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage can be blocked (private windows); the wallet then just asks again next visit.
    }
  },
};

/** A wallet error as one sentence for the page. */
export function walletError(err: unknown): string {
  const e = err as { code?: number; message?: string; shortMessage?: string };
  if (e?.code === 4001) return "You declined it in your wallet.";
  if (e?.code === -32002) return "Your wallet already has a request waiting: open it to continue.";
  return e?.shortMessage ?? e?.message ?? String(err);
}

const onAccounts: Listener = (accounts: string[]) => {
  if (!accounts?.length) disconnect();
  else set({ account: accounts[0] });
};
const onChain: Listener = (chainId: string) => set({ chainId: Number(BigInt(chainId)) });

function attach(wallet: Wallet, account: string, chainHex: string) {
  if (state.wallet && state.wallet !== wallet) detach(state.wallet);
  wallet.provider.on?.("accountsChanged", onAccounts);
  wallet.provider.on?.("chainChanged", onChain);
  remembered.set(wallet.info.rdns);
  set({ status: "connected", wallet, account, chainId: Number(BigInt(chainHex)), error: undefined });
}

function detach(wallet: Wallet) {
  wallet.provider.removeListener?.("accountsChanged", onAccounts);
  wallet.provider.removeListener?.("chainChanged", onChain);
}

/** Asks the wallet to connect; the wallet shows its own prompt. */
export async function connect(wallet: Wallet) {
  set({ status: "connecting", error: undefined });
  try {
    const accounts = (await wallet.provider.request({ method: "eth_requestAccounts" })) as string[];
    if (!accounts?.length) throw new Error("The wallet returned no account.");
    attach(wallet, accounts[0]!, (await wallet.provider.request({ method: "eth_chainId" })) as string);
  } catch (err) {
    set({ status: "disconnected", error: walletError(err) });
  }
}

/** Forgets the wallet on this site. */
export function disconnect() {
  if (state.wallet) {
    detach(state.wallet);
    // So the next Connect asks again. Not every wallet supports it, and nothing depends on it.
    state.wallet.provider.request({ method: "wallet_revokePermissions", params: [{ eth_accounts: {} }] }).catch(() => {});
  }
  remembered.set(undefined);
  set({ status: "disconnected", wallet: undefined, account: undefined, chainId: undefined, error: undefined });
}

/** Switches the wallet to Arc mainnet, adding the network first if the wallet doesn't know it. */
export async function switchToArc() {
  const provider = state.wallet?.provider;
  if (!provider) return;
  set({ error: undefined });
  try {
    try {
      await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_HEX }] });
    } catch (err) {
      const e = err as { code?: number; data?: { originalError?: { code?: number } } };
      if (e.code !== 4902 && e.data?.originalError?.code !== 4902) throw err;
      // viem's Arc chain definition (chains/definitions/arc.js): gas is native USDC with 18 decimals.
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: ARC_CHAIN_HEX, chainName: "Arc", nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 }, rpcUrls: [web.ARC.rpc], blockExplorerUrls: [web.ARC.explorer] }],
      });
    }
    onChain((await provider.request({ method: "eth_chainId" })) as string);
  } catch (err) {
    set({ error: walletError(err) });
  }
}

/**
 * Hands one transaction to the wallet, which shows it to the owner to approve. Returns the hash once sent.
 * On a local fork the wallet must be pointed at the same fork, or the site would read one chain and send on another.
 */
export async function sendTransaction(tx: { to: string; data: string }): Promise<string> {
  const { wallet, account, chainId } = state;
  if (!wallet || !account) throw new Error("Connect a wallet first.");
  if (chainId !== web.ARC.chainId) throw new Error("Switch your wallet to Arc first.");
  if (onFork) {
    const [ours, theirs] = await Promise.all([rpc.blockNumber(), wallet.provider.request({ method: "eth_blockNumber" }).then((b) => BigInt(b as string))]);
    const gap = ours > theirs ? ours - theirs : theirs - ours;
    if (gap > 20n) throw new Error(`Your wallet isn't on this local fork (its block ${theirs}, the fork's ${ours}).`);
  }
  return (await wallet.provider.request({ method: "eth_sendTransaction", params: [{ from: account, to: tx.to, data: tx.data }] })) as string;
}

/**
 * Asks the wallet to sign EIP-712 typed data (`eth_signTypedData_v4`). A signature, not a transaction: nothing is
 * sent on-chain and it costs no gas. Wallets refuse typed data whose domain names another chain, hence the check.
 */
export async function signTypedData(typed: { domain: { chainId: number } }): Promise<string> {
  const { wallet, account, chainId } = state;
  if (!wallet || !account) throw new Error("Connect a wallet first.");
  if (chainId !== typed.domain.chainId) throw new Error("Switch your wallet to Arc first.");
  return (await wallet.provider.request({ method: "eth_signTypedData_v4", params: [account, JSON.stringify(typed)] })) as string;
}

function discover() {
  if (typeof window === "undefined") return;
  const add = (wallet: Wallet) => {
    if (state.wallets.some((w) => w.info.uuid === wallet.info.uuid || w.provider === wallet.provider)) return;
    set({ wallets: [...state.wallets, wallet] });
  };
  window.addEventListener("eip6963:announceProvider", (ev) => add((ev as CustomEvent<Wallet>).detail));
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Wallets announce right away; after a short wait, fall back to window.ethereum and try a silent reconnect.
  setTimeout(async () => {
    const injected = (window as { ethereum?: Provider }).ethereum;
    if (state.wallets.length === 0 && injected) add({ info: { uuid: "injected", name: "Browser wallet", icon: "", rdns: "injected" }, provider: injected });
    const rdns = remembered.get();
    const wallet = rdns ? state.wallets.find((w) => w.info.rdns === rdns) : undefined;
    if (wallet) {
      try {
        // eth_accounts never prompts: it returns the account only if this site was already allowed.
        const accounts = (await wallet.provider.request({ method: "eth_accounts" })) as string[];
        if (accounts?.length) attach(wallet, accounts[0]!, (await wallet.provider.request({ method: "eth_chainId" })) as string);
      } catch {
        remembered.set(undefined);
      }
    }
    set({ ready: true });
  }, 350);
}
discover();

/** The wallet's live state. */
export function useWallet(): WalletState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}
