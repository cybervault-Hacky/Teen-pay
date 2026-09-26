/**
 * Ledger domain (conceptual in Phase 1).
 *
 * When real money arrives, every movement will be an append-only,
 * immutable ledger entry — never an in-place balance edit. Balances are
 * always derived by folding the ledger. This module fixes the vocabulary
 * early so Phase 2+ builds on it instead of inventing a parallel model.
 */

import type { MinorUnits } from "./wallet";

export type LedgerEntryId = string;

export type LedgerDirection = "credit" | "debit";

export type LedgerEntryStatus = "pending" | "posted" | "reversed";

/** Why money moved — the future source of truth for Activity grouping. */
export type LedgerReason =
  | "allowance"
  | "top_up"
  | "peer_transfer"
  | "merchant_payment"
  | "goal_contribution"
  | "goal_withdrawal"
  | "space_move"
  | "refund"
  | "fee"
  | "adjustment";

export interface LedgerEntry {
  id: LedgerEntryId;
  walletId: string;
  direction: LedgerDirection;
  amountPaise: MinorUnits;
  /** Running balance *after* this entry posted. */
  balanceAfterPaise: MinorUnits;
  reason: LedgerReason;
  /** Idempotency key — retries must never double-post. */
  idempotencyKey: string;
  status: LedgerEntryStatus;
  /** Links double-entry pairs (e.g. space_move out + in). */
  counterEntryId?: LedgerEntryId;
  memo?: string;
  postedAt: string;
}
