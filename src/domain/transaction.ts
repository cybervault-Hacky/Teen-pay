import type { LedgerEntryType, TransactionStatus } from "./ledger";

/**
 * Domain: transactions — display-safe projections of ledger entries.
 *
 * Screens never read raw entries: they get these from the central
 * transaction queries (`sandbox/selectors`), so titles, signs and
 * statuses are decided once. No internal ids or implementation
 * details are exposed beyond the human-facing reference.
 */
export type TransactionDirection = "in" | "out";

export interface Transaction {
  /** Stable key for lists. */
  id: string;
  title: string;
  subtitle: string;
  /** Signed whole rupees: positive is money in, negative is out. */
  amount: number;
  direction: TransactionDirection;
  /** Pre-formatted display timestamp. */
  when: string;
  /** Only set when not simply "completed" (rows show it as text). */
  statusLabel?: string;
}

export interface TransactionDetails extends Transaction {
  type: LedgerEntryType;
  typeLabel: string;
  status: TransactionStatus;
  /** "Completed", "Refunded", "Reversed"… */
  statusText: string;
  /** Unique, human-facing, e.g. "PAY-7K2M9QXA". */
  reference: string;
  /** ISO 8601. */
  createdAt: string;
  /** Rupees, always positive. */
  magnitude: number;
  description: string;
  /** Whose wallet, e.g. "Aarav's wallet". */
  walletLabel: string;
  counterparty: { label: "From" | "To"; name: string };
  /** When a guardian approval authorized this payment. */
  approval?: { decidedByName: string; decidedAt?: string };
  /** For refunds/reversals: the reference of the original. */
  compensates?: string;
  /** For Money Space moves, when the viewer owns the Space. */
  space?: { id: string; name: string; archived: boolean };
  /** Refunds/reversals recorded against this entry. */
  compensatedBy: { reference: string; amount: number; kind: "refund" | "reversal" }[];
  /** Rupees still refundable (payments only; 0 otherwise). */
  refundable: number;
}
