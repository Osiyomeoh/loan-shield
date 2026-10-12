import type { Hash } from "viem";
import type { Position } from "../src/config.js";
import type { Preview, ShieldChain } from "../src/keeper.js";

export const WAD = 10n ** 18n;
export const TUNDE: Position = {
  borrower: "0x1111111111111111111111111111111111111111",
  marketId: "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d",
};
export const ADA: Position = {
  borrower: "0x2222222222222222222222222222222222222222",
  marketId: "0xc2db905f174e5defcce01d321b09f15f78856a36a21b90cc7e1abbc29225815d",
};

export const healthy: Preview = {
  status: "NotInDanger",
  healthFactor: (WAD * 179n) / 100n,
  trigger: (WAD * 150n) / 100n,
  target: (WAD * 180n) / 100n,
  repayAssets: 0n,
  repayShares: 0n,
  healthFactorAfter: 0n,
};

export const inDanger: Preview = {
  status: "Ready",
  healthFactor: (WAD * 105n) / 100n,
  trigger: (WAD * 120n) / 100n,
  target: (WAD * 140n) / 100n,
  repayAssets: 8_228_571_429n,
  repayShares: 8_228_571_429_000_000n,
  healthFactorAfter: (WAD * 140n) / 100n,
};

/** A scripted chain: previews and dry-run results per borrower, and a log of every transaction "sent". */
export class FakeChain implements ShieldChain {
  readonly sent: Position[] = [];
  readonly previews = new Map<string, Preview>();
  dryRun: { ok: true } | { ok: false; error: string } = { ok: true };
  receipt: "success" | "reverted" = "success";
  failPreview = false;

  constructor(previews: Record<string, Preview> = {}) {
    for (const [borrower, p] of Object.entries(previews)) this.previews.set(borrower, p);
  }

  async preview(position: Position): Promise<Preview> {
    if (this.failPreview) throw new Error("RPC unavailable");
    return this.previews.get(position.borrower) ?? { ...healthy, status: "NoPolicy" };
  }

  async simulateRescue() {
    return this.dryRun;
  }

  async sendRescue(position: Position): Promise<Hash> {
    this.sent.push(position);
    // After a successful rescue the loan is back at target, like the contract leaves it.
    const p = this.previews.get(position.borrower);
    if (p) this.previews.set(position.borrower, { ...p, status: "NotInDanger", healthFactor: p.healthFactorAfter });
    return `0x${this.sent.length.toString(16).padStart(64, "0")}`;
  }

  async waitForReceipt() {
    return { status: this.receipt };
  }
}
