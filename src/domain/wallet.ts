import type { CurrencyCode } from "./money";

/**
 * Domain: wallets.
 *
 * A wallet belongs to exactly one account and holds sandbox rupees.
 * It stores no balance: the balance is always derived from the
 * wallet's ledger entries (see `./ledger`). An account may own more
 * than one wallet in future; today every account has one primary.
 *
 * Wallet status is sandbox state only. It is not a card or bank
 * freeze and says nothing about any real account.
 */
export type WalletStatus = "active" | "frozen" | "closed";

/** Only "primary" exists today; the field keeps multi-wallet open. */
export type WalletKind = "primary";

export interface Wallet {
  /** Stable id, e.g. "wal_usr_aarav". Never reused. */
  id: string;
  ownerAccountId: string;
  kind: WalletKind;
  currency: CurrencyCode;
  status: WalletStatus;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  /** Who last changed the status, and when (freeze/unfreeze). */
  statusChangedBy?: string;
  statusChangedAt?: string;
}

/** The deterministic id of an account's primary wallet. */
export function primaryWalletId(accountId: string): string {
  return `wal_${accountId}`;
}

/**
 * Why money can't move in or out of this wallet, or null when it
 * can. Frozen and closed wallets stay fully readable.
 */
export function walletMutationProblem(
  wallet: Pick<Wallet, "status">,
): "wallet_frozen" | "wallet_closed" | null {
  if (wallet.status === "frozen") return "wallet_frozen";
  if (wallet.status === "closed") return "wallet_closed";
  return null;
}

export function walletStatusLabel(status: WalletStatus): string {
  return status === "active" ? "Active" : status === "frozen" ? "Frozen" : "Closed";
}
