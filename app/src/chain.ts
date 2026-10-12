import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { loanShieldAbi } from "./abi.js";
import { arc, rpcUrl, STATUS, type Position } from "./config.js";
import type { Preview, ShieldChain } from "./keeper.js";

export function publicClient(rpc = rpcUrl()): PublicClient {
  return createPublicClient({ chain: arc, transport: http(rpc) });
}

export function walletClient(account: PrivateKeyAccount, rpc = rpcUrl()): WalletClient {
  return createWalletClient({ account, chain: arc, transport: http(rpc) });
}

export async function readPreview(client: PublicClient, shield: Address, { borrower, marketId }: Position): Promise<Preview> {
  const p = await client.readContract({ address: shield, abi: loanShieldAbi, functionName: "preview", args: [borrower, marketId] });
  const status = STATUS[p.status];
  if (status === undefined) throw new Error(`unknown preview status ${p.status}`);
  return { ...p, status };
}

/**
 * Gas limit to send with: twice the node's estimate. Morpho skips interest accrual when the market was already
 * updated at the same block timestamp, so an estimate run against the block that last touched the market leaves out
 * the IRM call and storage writes the mined transaction pays for once it lands at a later timestamp. Arc makes a
 * block about every 0.5 s, so a busy market is often in that state; on a local fork it ran a borrow out of gas
 * (README, "Arc findings"). Only the gas used is charged, so the headroom costs nothing.
 */
export function withHeadroom(estimate: bigint): bigint {
  return estimate * 2n;
}

/** The name of the contract error a call reverted with; rethrows anything that isn't a revert (RPC down, etc.). */
export function revertName(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      return revert.data?.errorName ?? revert.reason ?? revert.shortMessage;
    }
  }
  throw err;
}

/** The keeper's view of the chain. Without a keeper key it can read and preview but not send. */
export function createShieldChain(options: { shield: Address; keeperKey?: Hex; rpc?: string }): ShieldChain & {
  keeper: Address | undefined;
} {
  const client = publicClient(options.rpc);
  const account = options.keeperKey ? privateKeyToAccount(options.keeperKey) : undefined;
  const wallet = account ? walletClient(account, options.rpc) : undefined;
  const call = (position: Position) =>
    ({ address: options.shield, abi: loanShieldAbi, functionName: "rescue", args: [position.borrower, position.marketId] }) as const;

  return {
    keeper: account?.address,
    preview: (position) => readPreview(client, options.shield, position),
    async simulateRescue(position) {
      if (!account) throw new Error("simulateRescue needs a keeper key");
      try {
        await client.simulateContract({ ...call(position), account });
        return { ok: true };
      } catch (err) {
        return { ok: false, error: revertName(err) };
      }
    },
    async sendRescue(position) {
      if (!wallet || !account) throw new Error("sendRescue needs a keeper key");
      const gas = await client.estimateContractGas({ ...call(position), account });
      return wallet.writeContract({ ...call(position), account, chain: arc, gas: withHeadroom(gas) });
    },
    async waitForReceipt(hash) {
      const receipt = await client.waitForTransactionReceipt({ hash, timeout: 60_000 });
      return { status: receipt.status };
    },
  };
}
