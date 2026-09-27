import {
  checkMoney,
  MAX_SANDBOX_AMOUNT,
  type LedgerCounterpartyKind,
  type LedgerDirection,
  type LedgerEntry,
  type LedgerEntryType,
  type MoneyRequest,
} from "@/domain";
import { formatINR } from "@/lib/currency";
import type { SandboxError } from "./types";

/**
 * The ledger engine — entry-level rules, pure and deterministic.
 *
 * Every financial invariant for a single entry lives here, not in the
 * UI: whole-rupee positive amounts (via the domain's `checkMoney`),
 * the sandbox cap, supported currency, type/direction/counterparty
 * consistency, and the no-negative-balance rule per wallet. Entries
 * are only ever appended, frozen, and deduplicated by id.
 *
 * Whole operations (several legs, idempotency, wallet status, audit)
 * are posted by `operations.ts`, which uses these rules for each leg.
 */

/** What the engine accepts for each entry type. */
export const ENTRY_RULES: Record<
  LedgerEntryType,
  {
    direction: LedgerDirection | "either";
    counterparty: LedgerCounterpartyKind | "any";
  }
> = {
  deposit: { direction: "credit", counterparty: "sandbox" },
  allowance_credit: { direction: "credit", counterparty: "guardian" },
  allowance_debit: { direction: "debit", counterparty: "account" },
  payment_sent: { direction: "debit", counterparty: "person" },
  payment_received: { direction: "credit", counterparty: "person" },
  transfer_out: { direction: "debit", counterparty: "account" },
  transfer_in: { direction: "credit", counterparty: "account" },
  refund: { direction: "credit", counterparty: "person" },
  reversal: { direction: "either", counterparty: "any" },
  adjustment: { direction: "either", counterparty: "person" },
  space_allocation: { direction: "debit", counterparty: "space" },
  space_release: { direction: "credit", counterparty: "space" },
};

/** Entry types written by spending (count toward daily limits). */
export const SPENDING_TYPES: ReadonlySet<LedgerEntryType> = new Set([
  "payment_sent",
  "transfer_out",
]);

export function isIntegralAmount(amount: number): boolean {
  return Number.isFinite(amount) && Number.isInteger(amount);
}

/**
 * Validates an amount (and currency) with the domain's single money
 * check, as a user-facing error. Used by inputs and the engine alike.
 */
export function amountError(amount: number, currency = "INR"): SandboxError | null {
  switch (checkMoney(amount, { currency })) {
    case null:
      return null;
    case "unsupported_currency":
      return {
        code: "unsupported_currency",
        message: "Only Indian rupees (INR) are supported in the sandbox.",
      };
    case "not_positive":
      return { code: "invalid_amount", message: "Enter an amount above zero." };
    case "above_maximum":
      return {
        code: "exceeds_sandbox_limit",
        message: `Sandbox moves are capped at ${formatINR(MAX_SANDBOX_AMOUNT)}.`,
      };
    default:
      return { code: "invalid_amount", message: "Enter a whole-rupee amount." };
  }
}

/** Balance of a list of entries (one wallet). Never stored. */
export function deriveBalance(entries: readonly LedgerEntry[]): number {
  return entries.reduce(
    (sum, entry) =>
      entry.direction === "credit" ? sum + entry.amount : sum - entry.amount,
    0,
  );
}

/** One wallet's entries, in ledger (append) order. */
export function walletEntries(
  ledger: readonly LedgerEntry[],
  walletId: string,
): LedgerEntry[] {
  return ledger.filter((entry) => entry.walletId === walletId);
}

/** A wallet's available balance, derived from its entries. */
export function walletBalance(ledger: readonly LedgerEntry[], walletId: string): number {
  return deriveBalance(walletEntries(ledger, walletId));
}

/** Sum of a set of entries. */
export function sumEntries(
  entries: readonly LedgerEntry[],
  predicate: (entry: LedgerEntry) => boolean,
): number {
  return entries.filter(predicate).reduce((sum, entry) => sum + entry.amount, 0);
}

// ── Money Spaces (derived, never stored) ─────────────────────────

/** Is this entry a movement between a wallet and one of its Spaces? */
export function isSpaceEntry(entry: Pick<LedgerEntry, "type">): boolean {
  return entry.type === "space_allocation" || entry.type === "space_release";
}

export interface SpaceTotals {
  /** Rupees moved into the Space (space_allocation). */
  added: number;
  /** Rupees moved back out (space_release). */
  withdrawn: number;
}

const spaceTotalsCache = new WeakMap<readonly LedgerEntry[], ReadonlyMap<string, SpaceTotals>>();

/**
 * Every Space's totals in one pass over the ledger, memoized per
 * ledger array (the ledger is immutable, so a new array means new
 * data). Screens that render many Spaces read from this map.
 */
export function spaceTotals(ledger: readonly LedgerEntry[]): ReadonlyMap<string, SpaceTotals> {
  const cached = spaceTotalsCache.get(ledger);
  if (cached) return cached;
  const totals = new Map<string, SpaceTotals>();
  for (const entry of ledger) {
    if (!entry.spaceId || !isSpaceEntry(entry)) continue;
    const current = totals.get(entry.spaceId) ?? { added: 0, withdrawn: 0 };
    totals.set(
      entry.spaceId,
      entry.type === "space_allocation"
        ? { ...current, added: current.added + entry.amount }
        : { ...current, withdrawn: current.withdrawn + entry.amount },
    );
  }
  spaceTotalsCache.set(ledger, totals);
  return totals;
}

/** A Space's balance: money moved in minus money moved back. */
export function spaceBalance(ledger: readonly LedgerEntry[], spaceId: string): number {
  const totals = spaceTotals(ledger).get(spaceId);
  return totals ? totals.added - totals.withdrawn : 0;
}

/** Money set aside in Spaces, for a list of (one wallet's) entries. */
export function deriveAllocated(entries: readonly LedgerEntry[]): number {
  return entries.reduce(
    (sum, e) =>
      e.type === "space_allocation" ? sum + e.amount : e.type === "space_release" ? sum - e.amount : sum,
    0,
  );
}

/** Total money = available balance + money set aside in Spaces. */
export function deriveTotal(entries: readonly LedgerEntry[]): number {
  return deriveBalance(entries) + deriveAllocated(entries);
}

export interface MoneySummary {
  /** Spendable now: the wallet's derived balance. */
  available: number;
  /** Set aside in Money Spaces (not spendable until moved back). */
  allocated: number;
  /** Total = available + allocated. */
  total: number;
  /** Expected: pending money requests (not money yet). */
  upcoming: number;
}

/** One wallet's money, derived from its entries and pending requests. */
export function deriveMoneySummary(
  entries: readonly LedgerEntry[],
  requests: readonly MoneyRequest[],
): MoneySummary {
  const available = deriveBalance(entries);
  const allocated = deriveAllocated(entries);
  return {
    available,
    allocated,
    total: available + allocated,
    upcoming: requests
      .filter((request) => request.status === "pending")
      .reduce((sum, request) => sum + request.amount, 0),
  };
}

/**
 * Full entry validation against the rules and the running balance.
 * Returns null when the entry may be appended.
 */
export function validateEntry(
  entry: LedgerEntry,
  entriesBefore: readonly LedgerEntry[],
): SandboxError | null {
  const rule = ENTRY_RULES[entry.type];
  if (!rule) {
    return {
      code: "entry_rejected",
      message: "This ledger entry type is not recognized.",
    };
  }
  const error = amountError(entry.amount, entry.currency);
  if (error) return error;
  if (entry.status !== "completed") {
    return { code: "entry_rejected", message: "Only completed movements can be recorded." };
  }
  if (rule.direction !== "either" && rule.direction !== entry.direction) {
    return {
      code: "entry_rejected",
      message: "This move doesn't match its type.",
    };
  }
  if (rule.counterparty !== "any" && rule.counterparty !== entry.counterparty.kind) {
    return {
      code: "entry_rejected",
      message: "This move has the wrong counterparty.",
    };
  }
  // The balance rule is per wallet: only this wallet's entries count.
  const before = walletEntries(entriesBefore, entry.walletId);
  if (entry.direction === "debit" && entry.amount > deriveBalance(before)) {
    return {
      code: "insufficient_balance",
      message:
        "Your available balance isn't enough for this. Nothing was changed.",
    };
  }
  return null;
}

/**
 * Appends an entry immutably. Idempotent by entry id: replaying an
 * entry that already exists is a no-op, which is what makes double
 * submissions safe.
 */
export function appendEntry(
  entries: readonly LedgerEntry[],
  entry: LedgerEntry,
): LedgerEntry[] {
  if (entries.some((existing) => existing.id === entry.id)) {
    return entries as LedgerEntry[];
  }
  return [...entries, Object.freeze({ ...entry })];
}
