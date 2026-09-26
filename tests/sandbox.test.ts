import { describe, expect, it } from "vitest";
import { goalBlueprints } from "@/data/mock";
import {
  MAX_SANDBOX_TX_PAISE,
  MIN_TX_PAISE,
  parseAmountInput,
  validateTransferPaise,
} from "@/sandbox";
import {
  deriveBalance,
  deriveSpaceBalances,
  postAllowance,
  postGoalContribution,
  postPayment,
  postSpaceMove,
  type PostOutcome,
} from "@/sandbox";
import {
  createSeedState,
  deriveGoals,
  deriveWallet,
  projectTransactions,
  reasonLabel,
  SANDBOX_WALLET_ID,
} from "@/sandbox";
import {
  clearPersistedState,
  createMemoryStorage,
  isSandboxState,
  loadPersistedState,
  SANDBOX_STORAGE_KEY,
  SANDBOX_VERSION,
  savePersistedState,
} from "@/sandbox";
import { newOperationKey, uid } from "@/sandbox";
import { walletInvariantHolds, type MoneyRequest } from "@/domain";

const NOW = new Date("2026-09-26T12:00:00.000Z");

function seed() {
  return createSeedState(NOW);
}

function pendingRequest(overrides: Partial<MoneyRequest> = {}): MoneyRequest {
  return {
    id: "req_test",
    requesterId: "teen_aarav",
    targetName: "Meera Sharma",
    targetKind: "parent",
    amountPaise: 20_000,
    status: "pending",
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

describe("amount parsing", () => {
  it("parses plain, formatted and decimal input into paise", () => {
    expect(parseAmountInput("250")).toEqual({ ok: true, paise: 25_000 });
    expect(parseAmountInput("₹1,000.50")).toEqual({ ok: true, paise: 100_050 });
    expect(parseAmountInput(" 40 ")).toEqual({ ok: true, paise: 4_000 });
  });

  it("rejects blanks, garbage and bad precision", () => {
    expect(parseAmountInput("")).toMatchObject({ ok: false });
    expect(parseAmountInput("abc")).toEqual({ ok: false, error: "Enter an amount like 250." });
    expect(parseAmountInput("250.555")).toMatchObject({ ok: false });
    expect(parseAmountInput("-50")).toMatchObject({ ok: false });
    expect(parseAmountInput("0")).toMatchObject({ ok: false });
  });

  it("enforces the ₹1 minimum and ₹10,000 sandbox cap", () => {
    expect(MIN_TX_PAISE).toBe(100);
    expect(MAX_SANDBOX_TX_PAISE).toBe(1_000_000);
    expect(parseAmountInput("0.50")).toMatchObject({ ok: false, error: "Minimum is ₹1." });
    expect(parseAmountInput("100000")).toEqual({
      ok: false,
      error: "Sandbox limit is ₹10,000 per transaction.",
    });
  });

  it("re-validates paise defensively at the engine boundary", () => {
    expect(validateTransferPaise(99)).toMatchObject({ ok: false });
    expect(validateTransferPaise(100)).toEqual({ ok: true, paise: 100 });
    expect(validateTransferPaise(2.5)).toMatchObject({ ok: false });
    expect(validateTransferPaise(1_000_001)).toMatchObject({ ok: false });
  });
});

describe("seed derivation", () => {
  it("opens at ₹2,450 across Spend ₹850 / Save ₹1,200 / Goals ₹400", () => {
    const entries = seed().entries;
    expect(entries).toHaveLength(11);
    expect(deriveBalance(entries)).toBe(245_000);
    expect(deriveSpaceBalances(entries)).toEqual({ spend: 85_000, save: 120_000, goals: 40_000 });
  });

  it("excludes the pending ₹150 split from every balance", () => {
    const entries = seed().entries;
    const pending = entries.filter((e) => e.status === "pending");
    expect(pending).toHaveLength(1);
    expect(pending[0].amountPaise).toBe(15_000);
    expect(deriveBalance(entries.filter((e) => e.status === "posted"))).toBe(245_000);
  });
});

describe("postPayment", () => {
  const payment = {
    walletId: SANDBOX_WALLET_ID,
    recipientName: "Diya Patel",
    recipientId: "rcp_diya",
    recipientKind: "teen" as const,
    handle: "@diya",
    now: NOW.toISOString(),
  };

  it("posts a Spend debit with a payment event", () => {
    const entries = seed().entries;
    const outcome = postPayment(entries, {
      ...payment,
      amountPaise: 20_000,
      idempotencyKey: "op_pay_1",
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.replayed).toBe(false);
    expect(outcome.entries).toHaveLength(1);
    const entry = outcome.entries[0];
    expect(entry.direction).toBe("debit");
    expect(entry.space).toBe("spend");
    expect(entry.reason).toBe("peer_transfer");
    expect(entry.title).toBe("Sent to Diya");
    expect(entry.balanceAfterPaise).toBe(225_000);
    expect(outcome.events).toEqual([
      {
        type: "payment_sent",
        entryId: entry.id,
        recipientName: "Diya Patel",
        handle: "@diya",
        amountPaise: 20_000,
        note: undefined,
      },
    ]);
    expect(deriveBalance([...entries, ...outcome.entries])).toBe(225_000);
  });

  it("refuses to overdraw Spend with a human-readable error", () => {
    const outcome = postPayment(seed().entries, {
      ...payment,
      amountPaise: 85_001,
      idempotencyKey: "op_pay_2",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("insufficient_funds");
    expect(outcome.error.message).toContain("Only ₹850 in Spend");
  });

  it("rejects invalid amounts before touching the ledger", () => {
    const outcome = postPayment(seed().entries, {
      ...payment,
      amountPaise: 50,
      idempotencyKey: "op_pay_3",
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("invalid_amount");
  });

  it("replays idempotency keys instead of double-posting", () => {
    const entries = seed().entries;
    const input = { ...payment, amountPaise: 5_000, idempotencyKey: "op_pay_replay" };
    const first = postPayment(entries, input);
    expect(first.ok && !first.replayed).toBe(true);
    if (!first.ok) return;
    const withFirst = [...entries, ...first.entries];
    const second: PostOutcome = postPayment(withFirst, input);
    expect(second).toEqual({ ok: true, entries: [], replayed: true, events: [] });
    expect(deriveBalance(withFirst)).toBe(240_000);
  });
});

describe("postAllowance", () => {
  it("lands pocket money in Spend, linked to requests when paying one", () => {
    const entries = seed().entries;
    const outcome = postAllowance(entries, {
      walletId: SANDBOX_WALLET_ID,
      parentName: "Meera Sharma",
      amountPaise: 50_000,
      note: "September allowance",
      requestId: "req_1",
      idempotencyKey: "op_allow_1",
      now: NOW.toISOString(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const entry = outcome.entries[0];
    expect(entry.direction).toBe("credit");
    expect(entry.space).toBe("spend");
    expect(entry.title).toBe("Pocket money");
    expect(entry.metadata.requestId).toBe("req_1");
    expect(entry.balanceAfterPaise).toBe(295_000);
    expect(outcome.events[0]).toMatchObject({ type: "allowance_received", requestId: "req_1" });
  });
});

describe("postSpaceMove", () => {
  it("refuses same-space moves", () => {
    const outcome = postSpaceMove(seed().entries, {
      walletId: SANDBOX_WALLET_ID,
      fromSpace: "save",
      toSpace: "save",
      amountPaise: 1_000,
      idempotencyKey: "op_move_same",
      now: NOW.toISOString(),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("same_space");
  });

  it("refuses to overdraw the source space", () => {
    const outcome = postSpaceMove(seed().entries, {
      walletId: SANDBOX_WALLET_ID,
      fromSpace: "spend",
      toSpace: "save",
      amountPaise: 90_000,
      idempotencyKey: "op_move_broke",
      now: NOW.toISOString(),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("insufficient_funds");
  });

  it("posts linked legs that shift spaces without changing the total", () => {
    const entries = seed().entries;
    const outcome = postSpaceMove(entries, {
      walletId: SANDBOX_WALLET_ID,
      fromSpace: "spend",
      toSpace: "save",
      amountPaise: 10_000,
      idempotencyKey: "op_move_1",
      now: NOW.toISOString(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [debit, credit] = outcome.entries;
    expect(debit.counterEntryId).toBe(credit.id);
    expect(credit.counterEntryId).toBe(debit.id);
    expect(debit.groupId).toBe(credit.groupId);
    const next = [...entries, ...outcome.entries];
    expect(deriveBalance(next)).toBe(245_000);
    expect(deriveSpaceBalances(next)).toEqual({ spend: 75_000, save: 130_000, goals: 40_000 });
  });
});

describe("postGoalContribution", () => {
  it("refuses to fund Goals from Goals", () => {
    const outcome = postGoalContribution(seed().entries, {
      walletId: SANDBOX_WALLET_ID,
      goalId: "goal_buds",
      goalName: "Noise Buds Pro",
      fromSpace: "goals",
      amountPaise: 1_000,
      idempotencyKey: "op_goal_same",
      now: NOW.toISOString(),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.error.code).toBe("same_space");
  });

  it("posts linked legs into the Goals space", () => {
    const entries = seed().entries;
    const outcome = postGoalContribution(entries, {
      walletId: SANDBOX_WALLET_ID,
      goalId: "goal_buds",
      goalName: "Noise Buds Pro",
      fromSpace: "spend",
      amountPaise: 5_000,
      idempotencyKey: "op_goal_1",
      now: NOW.toISOString(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    const [debit, credit] = outcome.entries;
    expect(debit.space).toBe("spend");
    expect(credit.space).toBe("goals");
    expect(credit.metadata.goalId).toBe("goal_buds");
    const next = [...entries, ...outcome.entries];
    expect(deriveBalance(next)).toBe(245_000);
    expect(deriveSpaceBalances(next).goals).toBe(45_000);
    expect(outcome.events[0]).toMatchObject({ type: "goal_funded", goalId: "goal_buds" });
  });
});

describe("projection", () => {
  it("projects newest-first, collapsing paired credit legs", () => {
    const txs = projectTransactions(seed().entries, []);
    expect(txs[0].title).toBe("Monthly pocket money");
    for (let i = 1; i < txs.length; i++) {
      expect(txs[i - 1].occurredAt >= txs[i].occurredAt).toBe(true);
    }
    const ids = txs.map((t) => t.id);
    expect(ids).toContain("seed_05");
    expect(ids).not.toContain("seed_06");
    const split = txs.find((t) => t.id === "seed_04");
    expect(split?.status).toBe("pending");
    expect(split?.direction).toBe("in");
  });

  it("adds a row per pending request, excluding decided ones", () => {
    const txs = projectTransactions(seed().entries, [
      pendingRequest(),
      pendingRequest({ id: "req_paid", status: "paid" }),
      pendingRequest({ id: "req_cancelled", status: "cancelled" }),
    ]);
    const row = txs.find((t) => t.id === "req_test");
    expect(row).toMatchObject({
      title: "Money request",
      direction: "in",
      status: "pending",
      source: "request",
      requestId: "req_test",
    });
    expect(txs.find((t) => t.id === "req_paid")).toBeUndefined();
    expect(txs.find((t) => t.id === "req_cancelled")).toBeUndefined();
  });

  it("derives the wallet with Upcoming from pending entries + requests", () => {
    const plain = deriveWallet(seed().entries, [], { teenId: "teen_aarav" });
    expect(plain.availablePaise).toBe(245_000);
    expect(plain.upcomingPaise).toBe(15_000);
    expect(walletInvariantHolds(plain)).toBe(true);

    const withRequest = deriveWallet(seed().entries, [pendingRequest()], {
      teenId: "teen_aarav",
    });
    expect(withRequest.availablePaise).toBe(245_000);
    expect(withRequest.upcomingPaise).toBe(35_000);
  });

  it("derives goal progress from goal_contribution legs", () => {
    const goals = deriveGoals(seed().entries, goalBlueprints);
    expect(goals).toHaveLength(2);
    expect(goals[0]).toMatchObject({
      id: "goal_buds",
      name: "Noise Buds Pro",
      targetPaise: 299_900,
      savedPaise: 40_000,
    });
    expect(goals[1]).toMatchObject({ id: "goal_cycle", savedPaise: 0 });
  });

  it("labels ledger reasons for humans", () => {
    expect(reasonLabel("allowance")).toBe("Pocket money");
    expect(reasonLabel("peer_transfer")).toBe("Payment");
    expect(reasonLabel("space_move")).toBe("Space transfer");
  });
});

describe("storage", () => {
  it("round-trips state through memory storage", () => {
    const storage = createMemoryStorage();
    const state = seed();
    expect(savePersistedState(state, storage)).toBe(true);
    const loaded = loadPersistedState(storage);
    expect(loaded.issue).toBeNull();
    expect(loaded.state).toEqual(state);
    clearPersistedState(storage);
    expect(loadPersistedState(storage)).toEqual({ state: null, issue: null });
  });

  it("reports fresh installs as empty, not corrupt", () => {
    expect(loadPersistedState(createMemoryStorage())).toEqual({ state: null, issue: null });
  });

  it("reports malformed or versioned-out payloads as corrupted", () => {
    const storage = createMemoryStorage();
    storage.setItem(SANDBOX_STORAGE_KEY, "{not json");
    expect(loadPersistedState(storage).issue).toBe("corrupted");

    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({ ...seed(), version: 999 }));
    expect(loadPersistedState(storage).issue).toBe("corrupted");

    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify({ ...seed(), entries: [{ junk: true }] }));
    expect(loadPersistedState(storage).issue).toBe("corrupted");
  });

  it("never throws — storage failures surface as unavailable", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    expect(loadPersistedState(throwing)).toEqual({ state: null, issue: "unavailable" });
    expect(savePersistedState(seed(), throwing)).toBe(false);
    expect(() => clearPersistedState(throwing)).not.toThrow();
    expect(loadPersistedState(null)).toEqual({ state: null, issue: "unavailable" });
    expect(savePersistedState(seed(), null)).toBe(false);
  });

  it("validates the sandbox state shape", () => {
    expect(SANDBOX_VERSION).toBe(2);
    expect(isSandboxState(seed())).toBe(true);
    expect(isSandboxState({})).toBe(false);
    expect(isSandboxState(null)).toBe(false);
  });
});

describe("ids", () => {
  it("mints prefixed, unique-enough identifiers", () => {
    expect(uid("le")).toMatch(/^le_[0-9a-z]+$/);
    expect(uid("req")).not.toBe(uid("req"));
    expect(newOperationKey()).toMatch(/^op_[0-9a-z]+$/);
  });
});
