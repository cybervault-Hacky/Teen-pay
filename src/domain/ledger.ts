import type { CurrencyCode } from "./money";

/**
 * Domain: the ledger.
 *
 * The ledger is the only financial source of truth. It is an
 * append-only list of entries; each entry belongs to one wallet and
 * records one completed movement of sandbox rupees in or out of it.
 *
 *  · Entries are immutable. There is no update or delete — a mistake
 *    is corrected by a new, compensating entry (a refund or reversal
 *    that points at the original).
 *  · An entry exists only for money that actually moved, so its
 *    `status` is always "completed". Pending things (approvals,
 *    requests) are separate records and never touch the ledger.
 *  · Balances are derived from entries and never stored.
 *
 * Every entry is written by a `MoneyOperation` — the audit record of
 * one atomic, idempotent financial action. An operation's legs
 * balance (debits = credits): wallet legs become ledger entries;
 * legs outside the sandbox (a fictional recipient, sandbox funding)
 * are recorded on the operation only.
 */
export type LedgerDirection = "credit" | "debit";

export type LedgerEntryType =
  /** Sandbox funding into a wallet (no real money). */
  | "deposit"
  /** Pocket money arriving in a teen wallet. */
  | "allowance_credit"
  /** Pocket money leaving a guardian wallet. */
  | "allowance_debit"
  /** A payment to a fictional recipient. */
  | "payment_sent"
  /** A settled money request (money in from a fictional person). */
  | "payment_received"
  /**
   * Wallet-to-wallet transfer legs — TeenPay-to-TeenPay money (Phase 8):
   * sending, and paying a money request.
   */
  | "transfer_out"
  | "transfer_in"
  /** Money returned against an earlier payment. */
  | "refund"
  /** A correction: the exact opposite of an earlier entry. */
  | "reversal"
  /** Legacy (Phase 2): accepted when reading old data, never written. */
  | "adjustment"
  /** Money moved from the available balance into a Money Space. */
  | "space_allocation"
  /** Money moved from a Money Space back to the available balance. */
  | "space_release";

export type LedgerCounterpartyKind =
  | "person"
  | "guardian"
  /** Another TeenPay account's wallet (transfers, pocket money). */
  | "account"
  /** Sandbox funding — explicitly not a real source of money. */
  | "sandbox"
  /** One of the wallet's own Money Spaces (money set aside, not spent). */
  | "space";

export interface LedgerCounterparty {
  kind: LedgerCounterpartyKind;
  id: string;
  name: string;
  /**
   * Peer transfers only: the other account's TeenPay ID ("@meera"), a
   * display snapshot so each side can show the other without reading
   * the other's account.
   */
  handle?: string;
}

/** An entry exists only once money has moved. */
export type LedgerEntryStatus = "completed";

export interface LedgerEntry {
  /** Stable, unique id. Never reused, never edited. */
  id: string;
  /** The wallet this entry moves money in or out of. */
  walletId: string;
  /** The wallet's owner (denormalized for account-scoped queries). */
  accountId: string;
  /** The operation that wrote this entry (its idempotency key). */
  operationId: string;
  /** Human-facing reference shared by the operation, e.g. "PAY-7K2M9QXA". */
  reference: string;
  type: LedgerEntryType;
  direction: LedgerDirection;
  /** Whole rupees, always positive. Direction carries the sign. */
  amount: number;
  currency: CurrencyCode;
  status: LedgerEntryStatus;
  /** Human-readable description, e.g. "Movie night". */
  description: string;
  counterparty: LedgerCounterparty;
  /** Set for space_allocation / space_release entries. */
  spaceId?: string;
  /** Set when the entry settles a money request. */
  requestId?: string;
  /** Set when a guardian approval authorized this payment. */
  approvalId?: string;
  /** For refunds and reversals: the entry being compensated. */
  relatedEntryId?: string;
  /**
   * Scheduled pocket money (allowance entries only): the schedule and
   * the occurrence day (YYYY-MM-DD) this entry paid.
   */
  scheduleId?: string;
  scheduledFor?: string;
  /** ISO 8601 timestamp. */
  createdAt: string;
  /** The account whose action wrote the entry. */
  createdBy: string;
}

// ── Operations (audit + idempotency) ──────────────────────────────

export type MoneyOperationType =
  | "deposit"
  | "payment"
  | "allowance"
  | "transfer"
  | "refund"
  | "reversal"
  /** Wallet ⇄ Money Space movement. */
  | "space"
  | "request_settlement"
  | "adjustment";

/** One side of an operation. Wallet legs become ledger entries. */
export interface OperationLeg {
  direction: LedgerDirection;
  amount: number;
  /** Set for legs inside the sandbox; the entry written for it. */
  walletId?: string;
  entryId?: string;
  /** Set for legs outside any wallet (recipient, sandbox funding). */
  external?: LedgerCounterparty;
}

/**
 * The audit record of one financial action. Written only when the
 * action succeeds, in the same atomic step as its entries — a failed
 * action leaves no operation, no entry and no notification.
 */
export interface MoneyOperation {
  /** Idempotency key: replaying it never moves money twice. */
  id: string;
  /** Unique, human-facing, e.g. "ALW-3F9Q2M7K". */
  reference: string;
  type: MoneyOperationType;
  status: "completed";
  /** Who performed it. */
  actorId: string;
  /** Total moved (the sum of either side). */
  amount: number;
  currency: CurrencyCode;
  legs: OperationLeg[];
  createdAt: string;
  description: string;
  recipientId?: string;
  approvalId?: string;
  requestId?: string;
  /** For refunds/reversals: the operation being compensated. */
  relatedOperationId?: string;
  /**
   * Scheduled pocket money: the schedule and occurrence day. The
   * operation id is then the execution id `scheduleId:YYYY-MM-DD`.
   */
  scheduleId?: string;
  scheduledFor?: string;
}

/** Reference prefixes, one per operation type. */
export const REFERENCE_PREFIX: Record<MoneyOperationType, string> = {
  deposit: "DEP",
  payment: "PAY",
  allowance: "ALW",
  transfer: "TRF",
  refund: "REF",
  reversal: "REV",
  space: "SPC",
  request_settlement: "REQ",
  adjustment: "ADJ",
};

// ── Transaction status (derived, never stored) ────────────────────

/**
 * What a person sees about a transaction. Derived from records:
 *  · pending   — a payment waiting for guardian approval (no entry)
 *  · completed — money moved (a ledger entry)
 *  · failed    — an approval request that ended without paying
 *  · reversed  — completed, then fully compensated by a refund or
 *                reversal (the original entry is unchanged)
 */
export type TransactionStatus = "pending" | "completed" | "failed" | "reversed";
