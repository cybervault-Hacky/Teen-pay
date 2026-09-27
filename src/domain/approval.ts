/**
 * Domain: guardian approvals.
 *
 * An approval request is created when a teen's payment is above
 * the guardian's approval threshold. Creating it moves no money.
 * Only an "approved" decision executes the payment — through the
 * same ledger engine as every other payment, exactly once, keyed
 * by `paymentEntryId`.
 */
export type ApprovalStatus = "pending" | "approved" | "declined" | "cancelled";

/** Extensible: future kinds could be "new_recipient", "limit_raise"… */
export type ApprovalKind = "payment";

export interface ApprovalRequest {
  id: string;
  kind: ApprovalKind;
  teenId: string;
  guardianId: string;
  /** Whole rupees, always positive. */
  amount: number;
  currency: "INR";
  recipientId: string;
  /** Snapshot for display, in case the recipient list changes. */
  recipientName: string;
  note?: string;
  status: ApprovalStatus;
  /**
   * The ledger entry id the payment will use on approval. Doubles
   * as the idempotency key: approving twice can never post twice.
   */
  paymentEntryId: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  decidedAt?: string;
  /** Who approved, declined, or cancelled. */
  decidedBy?: string;
  /** Why it was cancelled, when the system cancelled it. */
  cancelReason?: string;
}
