import { describe, expect, it } from "vitest";
import type { LedgerEntry } from "@/domain";
import {
  amountError,
  appendEntry,
  deriveBalance,
  deriveMoneySummary,
  deriveTotal,
  ENTRY_RULES,
  validateEntry,
} from "@/sandbox/engine";
import type { MoneyRequest } from "@/domain";

/** A minimal, deterministic entry factory for engine tests. */
function entry(partial: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "e_1",
    // Phase 5: every entry belongs to a wallet and an operation.
    walletId: "wal_test",
    accountId: "usr_test",
    operationId: partial.id ?? "e_1",
    reference: `PAY-${partial.id ?? "e_1"}`,
    status: "completed",
    createdBy: "usr_test",
    type: "payment_sent",
    direction: "debit",
    amount: 100,
    currency: "INR",
    description: "Test",
    counterparty: { kind: "person", id: "rec_1", name: "Riya" },
    createdAt: "2026-09-25T00:00:00Z",
    ...partial,
  };
}

describe("ledger engine — derivation", () => {
  it("derives balance as credits minus debits", () => {
    const entries = [
      entry({ id: "a", type: "allowance_credit", direction: "credit", amount: 500, counterparty: { kind: "guardian", id: "p", name: "Priya" } }),
      entry({ id: "b", amount: 200 }),
    ];
    expect(deriveBalance(entries)).toBe(300);
  });

  it("derives zero from an empty ledger", () => {
    expect(deriveBalance([])).toBe(0);
  });

  it("derives total as available + money in spaces (Save + goals)", () => {
    const entries = [
      entry({ id: "a", type: "allowance_credit", direction: "credit", amount: 1000, counterparty: { kind: "guardian", id: "p", name: "Priya" } }),
      entry({ id: "b", type: "space_allocation", direction: "debit", amount: 300, counterparty: { kind: "space", id: "s", name: "Save" }, spaceId: "s" }),
      entry({ id: "c", type: "space_allocation", direction: "debit", amount: 200, counterparty: { kind: "space", id: "g", name: "Bike" }, spaceId: "g" }),
    ];
    expect(deriveBalance(entries)).toBe(500);
    expect(deriveTotal(entries)).toBe(1000);
  });

  it("derives the money summary: available = balance, upcoming = pending requests", () => {
    const entries = [
      entry({ id: "a", type: "allowance_credit", direction: "credit", amount: 900, counterparty: { kind: "guardian", id: "p", name: "Priya" } }),
      entry({ id: "b", type: "space_allocation", direction: "debit", amount: 400, counterparty: { kind: "space", id: "g", name: "Bike" }, spaceId: "g" }),
    ];
    const requests: MoneyRequest[] = [
      { id: "r1", amount: 150, currency: "INR", recipientId: "rec_1", status: "pending", createdAt: "2026-09-25T00:00:00Z" },
      { id: "r2", amount: 999, currency: "INR", recipientId: "rec_2", status: "paid", createdAt: "2026-09-25T00:00:00Z" },
    ];
    expect(deriveMoneySummary(entries, requests)).toEqual({
      available: 500,
      allocated: 400,
      total: 900,
      upcoming: 150, // pending only — paid requests don't count
    });
  });
});

describe("ledger engine — invariants", () => {
  it("rejects zero, negative, and fractional amounts", () => {
    expect(amountError(0)?.message).toMatch(/above zero/i);
    expect(amountError(-50)?.message).toMatch(/above zero/i);
    expect(amountError(49.99)?.message).toMatch(/whole-rupee/i);
    expect(amountError(Number.NaN)?.message).toMatch(/whole-rupee/i);
  });

  it("rejects amounts above the sandbox cap but accepts the cap", () => {
    expect(amountError(10000)).toBeNull();
    expect(amountError(10001)?.code).toBe("exceeds_sandbox_limit");
  });

  it("rejects a debit that would make the balance negative", () => {
    const before = [
      entry({ id: "a", type: "allowance_credit", direction: "credit", amount: 100, counterparty: { kind: "guardian", id: "p", name: "Priya" } }),
    ];
    const error = validateEntry(
      entry({ id: "b", amount: 101 }),
      before,
    );
    expect(error?.code).toBe("insufficient_balance");
  });

  it("allows a debit up to exactly the balance", () => {
    const before = [
      entry({ id: "a", type: "allowance_credit", direction: "credit", amount: 100, counterparty: { kind: "guardian", id: "p", name: "Priya" } }),
    ];
    expect(validateEntry(entry({ id: "b", amount: 100 }), before)).toBeNull();
  });

  it("enforces type/direction consistency (a debit 'allowance' is rejected)", () => {
    const bad = entry({
      id: "x",
      type: "allowance_credit",
      direction: "debit",
      counterparty: { kind: "guardian", id: "p", name: "Priya" },
    });
    expect(validateEntry(bad, [])?.code).toBe("entry_rejected");
  });

  it("enforces counterparty kind per type (a space allocation needs 'space')", () => {
    const bad = entry({
      id: "x",
      type: "space_allocation",
      direction: "debit",
      counterparty: { kind: "person", id: "rec_1", name: "Riya" },
    });
    expect(validateEntry(bad, [])?.code).toBe("entry_rejected");
  });

  it("keeps every declared rule consistent with the types", () => {
    // Phase 5: 12 types (adds deposit, allowance_debit, transfer_in/out
    // and reversal); every one has a rule.
    const types = Object.keys(ENTRY_RULES);
    expect(types).toHaveLength(12);
  });
});

describe("ledger engine — immutability and idempotency", () => {
  it("appendEntry returns a new array and freezes the stored entry", () => {
    const before = [entry({ id: "a" })];
    const after = appendEntry(before, entry({ id: "b" }));
    expect(after).not.toBe(before);
    expect(after).toHaveLength(2);
    expect(Object.isFrozen(after[1])).toBe(true);
    // The original array is untouched.
    expect(before).toHaveLength(1);
  });

  it("replaying an entry with a known id is a no-op", () => {
    const before = [entry({ id: "a" })];
    const after = appendEntry(before, entry({ id: "a", amount: 999 }));
    expect(after).toBe(before);
  });
});
