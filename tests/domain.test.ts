import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavActive } from "@/design/navigation";
import {
  getTransactions,
  groupTransactionsByDay,
  mockGoals,
  mockHousehold,
  mockTeen,
  mockTransactions,
  mockWallet,
  sumByDirection,
} from "@/data/mock";
import {
  goalProgress,
  goalRemaining,
  isCredit,
  isGoalComplete,
  isParent,
  isTeen,
  matchesActivityFilter,
  walletInvariantHolds,
  type Transaction,
} from "@/domain";
import { formatDayLabel } from "@/lib/format";

describe("wallet invariants", () => {
  it("mock wallet holds: spend + save + goals === available", () => {
    expect(walletInvariantHolds(mockWallet)).toBe(true);
    const { spend, save, goals } = mockWallet.spaces;
    expect(spend.balancePaise + save.balancePaise + goals.balancePaise).toBe(
      mockWallet.availablePaise,
    );
  });

  it("rejects negative or mismatched wallets", () => {
    expect(
      walletInvariantHolds({ ...mockWallet, availablePaise: 1 }),
    ).toBe(false);
    expect(
      walletInvariantHolds({
        ...mockWallet,
        spaces: { ...mockWallet.spaces, spend: { ...mockWallet.spaces.spend, balancePaise: -5 } },
      }),
    ).toBe(false);
  });
});

describe("goals", () => {
  it("computes progress, remaining and completion", () => {
    const goal = mockGoals[0];
    expect(goalProgress(goal)).toBeCloseTo(goal.savedPaise / goal.targetPaise);
    expect(goalRemaining(goal)).toBe(goal.targetPaise - goal.savedPaise);
    expect(isGoalComplete(goal)).toBe(false);
    expect(isGoalComplete({ ...goal, savedPaise: goal.targetPaise })).toBe(true);
  });
});

describe("activity selectors", () => {
  it("returns transactions newest-first", () => {
    const txs = getTransactions();
    expect(txs.length).toBe(mockTransactions.length);
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i - 1].occurredAt >= txs[i].occurredAt).toBe(true);
    }
  });

  it("groups transactions by day with stable keys", () => {
    const groups = groupTransactionsByDay(getTransactions(), (iso) =>
      formatDayLabel(iso),
    );
    expect(groups.length).toBeGreaterThan(0);
    const keys = groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groups[0].label).toBe("Today");
  });

  it("sums money in and out", () => {
    const txs = getTransactions();
    const expected = (dir: Transaction["direction"]) =>
      txs.filter((t) => t.direction === dir).reduce((s, t) => s + t.amountPaise, 0);
    expect(sumByDirection(txs, "in")).toBe(expected("in"));
    expect(sumByDirection(txs, "out")).toBe(expected("out"));
  });

  it("filters activity by tab", () => {
    const txs = getTransactions();
    expect(txs.filter((t) => matchesActivityFilter(t, "all")).length).toBe(txs.length);
    expect(
      txs.filter((t) => matchesActivityFilter(t, "in")).every((t) => t.direction === "in"),
    ).toBe(true);
    expect(
      txs.filter((t) => matchesActivityFilter(t, "pending")).every((t) => t.status === "pending"),
    ).toBe(true);
  });
});

describe("navigation model", () => {
  it("defines five unique tabs with unique routes", () => {
    expect(NAV_ITEMS).toHaveLength(5);
    expect(new Set(NAV_ITEMS.map((n) => n.id)).size).toBe(5);
    expect(new Set(NAV_ITEMS.map((n) => n.href)).size).toBe(5);
  });

  it("matches active routes exactly for home, by prefix elsewhere", () => {
    expect(isNavActive("/", "/")).toBe(true);
    expect(isNavActive("/pay", "/")).toBe(false);
    expect(isNavActive("/pay", "/pay")).toBe(true);
    expect(isNavActive("/money/goals", "/money")).toBe(true);
    expect(isNavActive("/profile", "/pay")).toBe(false);
  });
});

describe("user roles", () => {
  it("distinguishes teens from parents", () => {
    expect(isTeen(mockTeen)).toBe(true);
    expect(isParent(mockTeen)).toBe(false);
    const parent = mockHousehold.parents[0];
    expect(isParent(parent)).toBe(true);
    expect(isTeen(parent)).toBe(false);
  });

  it("flags credit transactions", () => {
    const txs = getTransactions();
    expect(txs.some(isCredit)).toBe(true);
    expect(txs.filter(isCredit).every((t) => t.direction === "in")).toBe(true);
  });
});
