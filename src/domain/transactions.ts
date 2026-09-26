/**
 * Transaction domain — the read-model the Activity feed renders.
 * Projected from the sandbox ledger (+ pending requests) in Phase 2;
 * later projected from the backend ledger the same way.
 */

import type { LedgerReason } from "./ledger";
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

/** Where a feed row originates — ledger entries move money, requests don't. */
export type TransactionSource = "ledger" | "request";

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
  source: TransactionSource;
  /** Ledger reason — powers the detail sheet's "Type" row. */
  reason?: LedgerReason;
  /** Set for request rows — powers cancel-from-detail. */
  requestId?: string;
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

export function matchesActivityQuery(tx: Transaction, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    tx.title.toLowerCase().includes(q) ||
    tx.counterparty.name.toLowerCase().includes(q) ||
    (tx.note ?? "").toLowerCase().includes(q)
  );
}

export interface TransactionDayGroup {
  key: string;
  label: string;
  items: Transaction[];
}

/** Group newest-first transactions by calendar day (stable keys). */
export function groupTransactionsByDay(
  transactions: Transaction[],
  labelFor: (iso: string) => string,
): TransactionDayGroup[] {
  const groups = new Map<string, Transaction[]>();
  for (const tx of transactions) {
    const day = tx.occurredAt.slice(0, 10);
    const list = groups.get(day);
    if (list) list.push(tx);
    else groups.set(day, [tx]);
  }
  return [...groups.entries()].map(([key, items]) => ({
    key,
    label: labelFor(items[0].occurredAt),
    items,
  }));
}

export function sumByDirection(
  transactions: Transaction[],
  direction: "in" | "out",
): number {
  return transactions
    .filter((t) => t.direction === direction && t.status !== "failed")
    .reduce((sum, t) => sum + t.amountPaise, 0);
}
