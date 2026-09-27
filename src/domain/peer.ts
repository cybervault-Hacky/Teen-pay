import type { CurrencyCode } from "./money";

/**
 * Domain: TeenPay-to-TeenPay money (Phase 8).
 *
 * Two things live here, and neither is a new kind of money:
 *
 *  · A **peer transfer** is the existing `transfer` operation (one
 *    `transfer_out` leg on the sender's wallet, one `transfer_in` leg on
 *    the recipient's, reference `TRF-…`), posted through the one ledger
 *    write path. There is no peer ledger and no peer balance.
 *
 *  · A **money request** is an ask, not money. Creating, declining,
 *    cancelling or expiring one never touches a balance, a Money Space
 *    or a daily total. Only accepting it moves money — as one peer
 *    transfer from the payer to the requester, linked back by
 *    `resultingPaymentReference`.
 *
 * Only teen accounts send, receive and request (the teen-only rule).
 * Pocket money between a parent and a teen stays in its own flow.
 */

/** What is stored. `expired` is also derived on read (see below). */
export type PeerRequestStatus = "pending" | "accepted" | "declined" | "cancelled" | "expired";

/**
 * How long a request stays open: 7 days from creation, to the
 * millisecond. Deterministic — no timer runs; expiry is computed from
 * timestamps whenever a request is read or acted on.
 */
export const PEER_REQUEST_TTL_DAYS = 7;
const TTL_MS = PEER_REQUEST_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Longest note a request (or a transfer) can carry. */
export const PEER_NOTE_MAX = 60;

export interface PeerRequest {
  requestId: string;
  /** Who asks for the money (and receives it if accepted). */
  requesterAccountId: string;
  requesterWalletId: string;
  /** Who is asked to pay. */
  payerAccountId: string;
  payerWalletId: string;
  /**
   * Display snapshots ("@aarav", "Aarav Sharma") so each side can show
   * the other without reading the other's account. Never an id.
   */
  requesterHandle: string;
  requesterName: string;
  payerHandle: string;
  payerName: string;
  /** Whole rupees, always positive. */
  amount: number;
  currency: CurrencyCode;
  note?: string;
  status: PeerRequestStatus;
  /** One per user action: a double submit creates one request. */
  idempotencyKey: string;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  /** When it was accepted, declined, cancelled or marked expired. */
  respondedAt?: string;
  /** The TRF- reference of the transfer that paid it (accepted only). */
  resultingPaymentReference?: string;
}

/** The safe, public face of a TeenPay account. No ids, no family. */
export interface PeerProfile {
  /** "@meera" */
  handle: string;
  /** "Meera Kapoor" */
  name: string;
  initials: string;
}

export function peerRequestExpiresAt(createdAt: string): string {
  return new Date(Date.parse(createdAt) + TTL_MS).toISOString();
}

/** True once `at` has reached the request's expiry instant. */
export function isPastExpiry(request: Pick<PeerRequest, "expiresAt">, at: string): boolean {
  return Date.parse(at) >= Date.parse(request.expiresAt);
}

/**
 * The status to show and to act on at `at`: a stored `pending` request
 * whose time is up is `expired`, whether or not that was written yet.
 */
export function effectivePeerRequestStatus(
  request: Pick<PeerRequest, "status" | "expiresAt">,
  at: string,
): PeerRequestStatus {
  return request.status === "pending" && isPastExpiry(request, at) ? "expired" : request.status;
}

export const PEER_REQUEST_STATUS_LABEL: Record<PeerRequestStatus, string> = {
  pending: "Pending",
  accepted: "Accepted",
  declined: "Declined",
  cancelled: "Cancelled",
  expired: "Expired",
};
