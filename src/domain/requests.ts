/**
 * Money-request domain (live in Phase 2).
 *
 * A request asks someone for money — it NEVER moves money by itself.
 * Only paying (via an allowance ledger entry) changes balances.
 * Requests are local records; a backend can adopt the same lifecycle.
 */

import type { LedgerEntryId } from "./ledger";
import type { UserId } from "./user";
import type { MinorUnits } from "./wallet";

export type RequestId = string;

export type RequestStatus = "pending" | "paid" | "cancelled";

export interface MoneyRequest {
  id: RequestId;
  /** The teen asking for money. */
  requesterId: UserId;
  /** Who is being asked, e.g. "Riya" or "Meera Sharma". */
  targetName: string;
  targetHandle?: string;
  targetKind: "parent" | "teen";
  amountPaise: MinorUnits;
  note?: string;
  status: RequestStatus;
  createdAt: string;
  /** When the request was paid or cancelled. */
  decidedAt?: string;
  /** Allowance entry that paid this request, if any. */
  paidEntryId?: LedgerEntryId;
}

export function isPendingRequest(request: MoneyRequest): boolean {
  return request.status === "pending";
}

export function isDecidedRequest(request: MoneyRequest): boolean {
  return request.status !== "pending";
}
