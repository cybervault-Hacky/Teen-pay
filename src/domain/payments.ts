/**
 * Payments domain (conceptual in Phase 1 — no real money movement).
 *
 * Teens can only pay *trusted* destinations: parent-approved recipients
 * (live in the Phase 2 sandbox against the local ledger).
 * and vetted merchants. There is intentionally no "pay anyone" path.
 * Real rails (UPI, cards, bank APIs) integrate behind `PaymentIntent`
 * in a later phase.
 */

import type { MinorUnits } from "./wallet";

export type RecipientId = string;

/** A person the teen may send money to (family, approved friends). */
export interface TrustedRecipient {
  id: RecipientId;
  name: string;
  /** Payment handle shown in review/success, e.g. "@riya". */
  handle: string;
  /** Who the recipient is — drives counterparty kind + request routing. */
  kind: "parent" | "teen";
  avatarSeed: string;
  relationship: string;
  /** Parent approval is required before a recipient becomes payable. */
  parentApproved: boolean;
  /** Most recent transfer, for "send again" shortcuts. */
  lastAmountPaise?: MinorUnits;
}

/** A business the teen may pay (vetted catalogue in later phases). */
export interface Merchant {
  id: RecipientId;
  name: string;
  category: string;
  avatarSeed: string;
}

export type PayDestination =
  | { kind: "recipient"; recipient: TrustedRecipient }
  | { kind: "merchant"; merchant: Merchant };

/**
 * Future payment instruction. Created client-side, authorized (possibly
 * by a parent), then executed server-side against real rails.
 */
export interface PaymentIntent {
  id: string;
  destination: PayDestination;
  amountPaise: MinorUnits;
  note?: string;
  /** Idempotency key — retries must never double-charge. */
  idempotencyKey: string;
  status: "draft" | "awaiting_approval" | "authorized" | "submitted" | "settled" | "failed";
  createdAt: string;
}
