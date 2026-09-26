/**
 * Transaction domain — the read-model the Activity feed renders.
 * Backed by mock data in Phase 1; later projected from the ledger.
 */

import type { MinorUnits } from "./wallet";

export type TransactionId = string;

export type TransactionDirection = "in" | "out";

export type TransactionStatus = "settled" | "pending" | "failed";

export type TransactionCategory =
  | "family"
  | "food"
  | "transport"
  | "shopping"
  | "education"
  | "entertainment"
  | "goals"
  | "transfer"
  | "other";

export interface TransactionCounterparty {
  name: string;
  /** "parent" | "teen" | "merchant" | "system" — who/what the other side is. */
  kind: "parent" | "teen" | "merchant" | "system";
}

export interface Transaction {
  id: TransactionId;
  title: string;
  counterparty: TransactionCounterparty;
  amountPaise: MinorUnits;
  direction: TransactionDirection;
  category: TransactionCategory;
  status: TransactionStatus;
  /** ISO timestamp. */
  occurredAt: string;
  /** Optional note shown under the title. */
  note?: string;
}

export function isCredit(tx: Transaction): boolean {
  return tx.direction === "in";
}

export type ActivityFilter = "all" | "in" | "out" | "pending";

export function matchesActivityFilter(tx: Transaction, filter: ActivityFilter): boolean {
  switch (filter) {
    case "all":
      return true;
    case "in":
      return tx.direction === "in";
    case "out":
      return tx.direction === "out";
    case "pending":
      return tx.status === "pending";
  }
}
