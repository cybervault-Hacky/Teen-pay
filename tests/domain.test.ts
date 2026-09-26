import { describe, expect, it } from "vitest";
import { NAV_ITEMS, isNavActive } from "@/design/navigation";
import { mockHousehold, mockTeen } from "@/data/mock";
import {
  goalProgress,
  goalRemaining,
  groupTransactionsByDay,
  isCredit,
  isDecidedRequest,
  isGoalComplete,
  isParent,
  isPendingRequest,
  isTeen,
  matchesActivityFilter,
  matchesActivityQuery,
  spaceShare,
  sumByDirection,
  walletInvariantHolds,
  type MoneyRequest,
  type TeenWallet,
  type Transaction,
} from "@/domain";

function tx(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "tx_base",
    title: "Base transaction",
    counterparty: { name: "Someone", kind: "teen" },
    amountPaise: 1000,
    direction: "out",
    category: "other",
    status: "settled",
    occurredAt: "2026-09-20T10:00:00.000Z",
    source: "ledger",
    ...overrides,
  };
}

function wallet(overrides: Partial<TeenWallet> = {}): TeenWallet {
  return {
    teenId: "teen_aarav",
    currency: "INR",
    availablePaise: 245_000,
    spaces: {
      spend: { type: "spend", label: "Spend", description: "", balancePaise: 85_000, currency: "INR" },
      save: { type: "save", label: "Save", description: "", balancePaise: 120_000, currency: "INR" },
      goals: { type: "goals", label: "Goals", description: "", balancePaise: 40_000, currency: "INR" },
    },
    upcomingPaise: 15_000,
    ...overrides,
  };
}

describe("wallet invariants", () => {
  it("holds when spend + save + goals === available", () => {
    expect(walletInvariantHolds(wallet())).toBe(true);
  });

  it("rejects mismatched or negative wallets", () => {
    expect(walletInvariantHolds(wallet({ availablePaise: 1 }))).toBe(false);
    expect(
      walletInvariantHolds(
        wallet({
          availablePaise: 245_000,
          spaces: {
            ...wallet().spaces,
            spend: { ...wallet().spaces.spend, balancePaise: -5 },
          },
        }),
      ),
    ).toBe(false);
  });

  it("computes space share, guarding divide-by-zero", () => {
    expect(spaceShare(85_000, 245_000)).toBeCloseTo(85_000 / 245_000);
    expect(spaceShare(100, 0)).toBe(0);
  });
});

describe("goals", () => {
  it("computes progress, remaining and completion", () => {
    const goal = {
      id: "goal_buds",
      teenId: "teen_aarav",
      name: "Noise Buds Pro",
      targetPaise: 299_900,
      savedPaise: 40_000,
      createdAt: "2026-09-01T09:00:00.000Z",
    };
    expect(goalProgress(goal)).toBeCloseTo(40_000 / 299_900);
    expect(goalRemaining(goal)).toBe(259_900);
    expect(isGoalComplete(goal)).toBe(false);
    expect(isGoalComplete({ ...goal, savedPaise: goal.targetPaise })).toBe(true);
    expect(goalProgress({ ...goal, targetPaise: 0 })).toBe(0);
  });
});

describe("activity selectors", () => {
  const feed = [
    tx({ id: "a", title: "Pocket money", direction: "in", occurredAt: "2026-09-26T09:00:00.000Z" }),
    tx({ id: "b", title: "Crossword", direction: "out", occurredAt: "2026-09-25T09:00:00.000Z" }),
    tx({ id: "c", title: "Split", direction: "in", status: "pending", occurredAt: "2026-09-24T09:00:00.000Z" }),
    tx({ id: "d", title: "Old", direction: "out", status: "failed", amountPaise: 500, occurredAt: "2026-09-24T08:00:00.000Z" }),
  ];

  it("groups transactions by day with stable keys", () => {
    const groups = groupTransactionsByDay(feed, (iso) => iso.slice(0, 10));
    expect(groups).toHaveLength(3);
    const keys = groups.map((g) => g.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(groups[0].items.map((t) => t.id)).toEqual(["a"]);
    expect(groups[2].items.map((t) => t.id)).toEqual(["c", "d"]);
  });

  it("sums money in and out, excluding failed", () => {
    expect(sumByDirection(feed, "in")).toBe(2000);
    expect(sumByDirection(feed, "out")).toBe(1000);
  });

  it("filters activity by tab", () => {
    expect(feed.filter((t) => matchesActivityFilter(t, "all"))).toHaveLength(4);
    expect(feed.filter((t) => matchesActivityFilter(t, "in")).map((t) => t.id)).toEqual(["a", "c"]);
    expect(feed.filter((t) => matchesActivityFilter(t, "out")).map((t) => t.id)).toEqual(["b", "d"]);
    expect(feed.filter((t) => matchesActivityFilter(t, "pending")).map((t) => t.id)).toEqual(["c"]);
  });

  it("matches queries against title, counterparty and note", () => {
    const note = tx({ id: "n", title: "Café", note: "Birthday treat" });
    expect(matchesActivityQuery(note, "")).toBe(true);
    expect(matchesActivityQuery(note, "café")).toBe(true);
    expect(matchesActivityQuery(note, "SOMEONE")).toBe(true);
    expect(matchesActivityQuery(note, "birthday")).toBe(true);
    expect(matchesActivityQuery(note, "metro")).toBe(false);
  });

  it("flags credit transactions", () => {
    expect(feed.filter(isCredit).map((t) => t.id)).toEqual(["a", "c"]);
  });
});

describe("money requests", () => {
  const pending: MoneyRequest = {
    id: "req_1",
    requesterId: "teen_aarav",
    targetName: "Meera Sharma",
    targetKind: "parent",
    amountPaise: 20_000,
    status: "pending",
    createdAt: "2026-09-26T10:00:00.000Z",
  };

  it("distinguishes pending from decided requests", () => {
    expect(isPendingRequest(pending)).toBe(true);
    expect(isDecidedRequest(pending)).toBe(false);
    expect(isPendingRequest({ ...pending, status: "paid" })).toBe(false);
    expect(isDecidedRequest({ ...pending, status: "paid" })).toBe(true);
    expect(isDecidedRequest({ ...pending, status: "cancelled" })).toBe(true);
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
});
