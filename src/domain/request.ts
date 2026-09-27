/**
 * Domain: money requests.
 *
 * A request is an ask for money from a recipient. Creating a
 * request moves nothing — it only changes the request's state.
 * Only the "paid" transition touches the ledger (a credit).
 */
export type MoneyRequestStatus = "pending" | "paid" | "cancelled";

export interface MoneyRequest {
  id: string;
  /** Whole rupees, always positive. */
  amount: number;
  currency: "INR";
  /** Recipient the money is requested from. */
  recipientId: string;
  note?: string;
  status: MoneyRequestStatus;
  createdAt: string;
  paidAt?: string;
  cancelledAt?: string;
}
