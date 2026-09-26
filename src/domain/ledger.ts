/**
 * Ledger domain — live in Phase 2 as the local sandbox ledger.
 *
 * Every movement of sandbox money is an append-only, immutable ledger
 * entry — never an in-place balance edit. Balances (wallet + spaces) are
 * always derived by folding the ledger (see `src/sandbox/`).
 *
 * A future backend replaces the local engine behind the same vocabulary:
 * entries, idempotency keys, paired legs and reasons all carry over.
 */

import type { MinorUnits, SpaceType } from "./wallet";
import type { TransactionCategory, TransactionCounterparty } from "./transactions";

export type LedgerEntryId = string;

export type LedgerDirection = "credit" | "debit";

export type LedgerEntryStatus = "pending" | "posted" | "reversed";

/** Spaces that can hold a balance. "Upcoming" is derived, never posted to. */
export type LedgerSpace = Exclude<SpaceType, "upcoming">;

/** Why money moved — the source of truth for Activity grouping. */
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

/** Optional, extensible links from an entry to product concepts. */
export interface LedgerMetadata {
  goalId?: string;
  requestId?: string;
  recipientId?: string;
  /** Payment handle shown in review/success, e.g. "@riya". */
  handle?: string;
  fromSpace?: LedgerSpace;
  toSpace?: LedgerSpace;
  /** Which leg of a linked pair this entry is. */
  leg?: "debit" | "credit";
}

export interface LedgerEntry {
  id: LedgerEntryId;
  walletId: string;
  direction: LedgerDirection;
  amountPaise: MinorUnits;
  /** Running wallet balance *after* this entry posted. */
  balanceAfterPaise: MinorUnits;
  reason: LedgerReason;
  /** The space this leg moves money in or out of. */
  space: LedgerSpace;
  status: LedgerEntryStatus;
  /** Idempotency key — retries must never double-post. */
  idempotencyKey: string;
  /** Links double-entry pairs (e.g. space_move out + in). */
  counterEntryId?: LedgerEntryId;
  /** Shared by both legs of a pair so projections can collapse them. */
  groupId?: string;
  /** Human title rendered in Activity, e.g. "Monthly pocket money". */
  title: string;
  /** Source/recipient of the money. */
  counterparty: TransactionCounterparty;
  category: TransactionCategory;
  note?: string;
  metadata: LedgerMetadata;
  postedAt: string;
}
