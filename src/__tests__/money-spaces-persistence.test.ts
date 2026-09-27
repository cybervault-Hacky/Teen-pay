import { describe, expect, it } from "vitest";
import { primaryWalletId, type LedgerEntry } from "@/domain";
import { spaceBalance, walletBalance } from "@/sandbox/engine";
import {
  databaseFromState,
  isSandboxDatabase,
  isV5Database,
  migrateToCurrent,
  migrateV1,
  migrateV3,
  migrateV4,
  migrateV5,
  migrateV6,
  parseLegacyDeadline,
  type V4Database,
} from "@/sandbox/persistence";
import { createLocalRepository, SANDBOX_BACKUP_KEY, SANDBOX_STORAGE_KEY } from "@/sandbox/repository";
import { scopeFor } from "@/sandbox/scope";
import {
  buildSeedDatabase,
  buildSeedState,
  SEED_GOAL_SPACE_ID,
  SEED_SAVE_SPACE_ID,
  SEED_TEEN_ID,
} from "@/sandbox/seed";
import { createSpaceTransition, moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { SANDBOX_SCHEMA_VERSION, type SandboxDatabase } from "@/sandbox/types";
import { LEGACY_SEED_GOALS, legacySeedLedger, must, TEEN, TEEN_WALLET } from "./helpers/fixtures";

const NOW = "2026-09-26T08:00:00.000Z";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

/** A real Phase 5 (v4) database, built through the real migrations. */
function v4Database(goals: unknown[] = LEGACY_SEED_GOALS): V4Database {
  const seed = buildSeedState();
  const v3 = migrateV1(
    {
      version: 1,
      ledger: legacySeedLedger(),
      payments: [],
      requests: [],
      notifications: [],
      recipients: seed.recipients,
      goals,
    },
    buildSeedState,
  );
  return JSON.parse(JSON.stringify(migrateV3(v3))) as V4Database;
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("migration — Phase 5 (v4) → Phase 6 (v5 Money Spaces)", () => {
  it("turns Save and goal allocations into Spaces without adding, removing or changing money", () => {
    const v4 = v4Database();
    // Phase 8: v4 → v5 → v6, then → v7 (the current schema).
    expect(isV5Database(clone(migrateV4(clone(v4), NOW)))).toBe(true);
    const db = migrateV6(migrateV5(migrateV4(clone(v4), NOW), NOW));
    expect(db.version).toBe(SANDBOX_SCHEMA_VERSION);
    expect(isSandboxDatabase(db)).toBe(true);

    // Spaces: a default Save and the goal, same id, target and a parsed date.
    const save = db.spaces.find((s) => s.id === SEED_SAVE_SPACE_ID);
    expect(save).toMatchObject({ type: "save", name: "Save", isDefault: true, walletId: TEEN_WALLET });
    const goal = db.spaces.find((s) => s.id === "goal_bike");
    expect(goal).toMatchObject({ type: "goal", name: "New Bike", targetAmount: 2500, deadline: "2026-11-30" });

    // Entries: same count, ids, amounts, dates and references (no dups).
    expect(db.ledger.map((e) => e.id)).toEqual(v4.ledger.map((e) => e.id));
    expect(db.ledger.map((e) => [e.amount, e.direction, e.createdAt, e.reference])).toEqual(
      v4.ledger.map((e) => [e.amount, e.direction, e.createdAt, e.reference]),
    );
    expect(db.operations.map((op) => op.id)).toEqual(v4.operations.map((op) => op.id));
    const moved = db.ledger.filter((e) => e.spaceId);
    expect(moved.map((e) => e.type)).toEqual(["space_allocation", "space_allocation"]);
    expect(moved.every((e) => !("goalId" in e))).toBe(true);

    // Balances: identical available money, Save ₹800, goal ₹1,500.
    const v4Ledger = v4.ledger as unknown as LedgerEntry[];
    expect(walletBalance(db.ledger, TEEN_WALLET)).toBe(walletBalance(v4Ledger, TEEN_WALLET));
    expect(walletBalance(db.ledger, TEEN_WALLET)).toBe(1850);
    expect(spaceBalance(db.ledger, SEED_SAVE_SPACE_ID)).toBe(800);
    expect(spaceBalance(db.ledger, "goal_bike")).toBe(1500);
    // Old goal records are gone from teen records (Spaces replace them).
    expect(db.teenRecords.every((r) => !("goals" in r))).toBe(true);
  });

  it("a goal entry whose goal record is missing gets a custom Space — its money stays visible", () => {
    const db = migrateV6(migrateV5(migrateV4(v4Database([]), NOW), NOW));
    expect(isSandboxDatabase(db)).toBe(true);
    const orphan = db.spaces.find((s) => s.id === "goal_bike");
    expect(orphan).toMatchObject({ type: "custom", ownerAccountId: SEED_TEEN_ID });
    expect(spaceBalance(db.ledger, "goal_bike")).toBe(1500);
    expect(walletBalance(db.ledger, TEEN_WALLET)).toBe(1850);
  });

  it("stored v4 data is backed up, upgraded on load, and never migrated twice", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(v4Database());
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const repo = createLocalRepository(() => storage);
    const first = repo.load(NOW);
    expect(first.outcome).toEqual({ kind: "migrated", from: 4 });
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    expect(repo.save(first.db)).toBe(true);

    const second = repo.load(NOW);
    expect(second.outcome).toEqual({ kind: "loaded" });
    expect(second.db.ledger).toHaveLength(first.db.ledger.length);
    expect(second.db.spaces).toHaveLength(first.db.spaces.length);
    expect(new Set(second.db.ledger.map((e) => e.id)).size).toBe(second.db.ledger.length);
    // Migration runs through the current check first: a v5 payload is untouched.
    expect(migrateToCurrent(second.db, { seedView: buildSeedState, now: NOW })).toMatchObject({ kind: "current" });
  });

  it("reads legacy free-text goal dates, or drops an unreadable one", () => {
    const ref = "2026-09-01T00:00:00Z";
    expect(parseLegacyDeadline("Nov 30", ref)).toBe("2026-11-30");
    expect(parseLegacyDeadline("Jan 5", ref)).toBe("2027-01-05");
    expect(parseLegacyDeadline("December 25, 2027", ref)).toBe("2027-12-25");
    expect(parseLegacyDeadline("2026-12-01", ref)).toBe("2026-12-01");
    expect(parseLegacyDeadline("Feb 30", ref)).toBeUndefined();
    expect(parseLegacyDeadline("soon", ref)).toBeUndefined();
    expect(parseLegacyDeadline(undefined, ref)).toBeUndefined();
  });
});

describe("v5 integrity — tampered Space data is refused, not loaded", () => {
  const seed = () => clone(buildSeedDatabase());
  const goalEntryIndex = (db: SandboxDatabase) => db.ledger.findIndex((e) => e.spaceId === SEED_GOAL_SPACE_ID);

  const cases: [string, (db: SandboxDatabase) => unknown][] = [
    ["a Space entry naming an unknown Space", (db) => {
      db.ledger[goalEntryIndex(db)] = { ...db.ledger[goalEntryIndex(db)]!, spaceId: "spc_nope" };
      return db;
    }],
    ["a spaceId on a non-Space entry", (db) => {
      const i = db.ledger.findIndex((e) => e.type === "payment_sent");
      db.ledger[i] = { ...db.ledger[i]!, spaceId: SEED_SAVE_SPACE_ID };
      return db;
    }],
    ["a Space on another account's wallet", (db) => {
      db.spaces[0] = { ...db.spaces[0]!, walletId: primaryWalletId("usr_priya") };
      return db;
    }],
    ["a Space whose owner doesn't exist", (db) => {
      db.spaces[0] = { ...db.spaces[0]!, ownerAccountId: "usr_ghost" };
      return db;
    }],
    ["a goal without a target", (db) => {
      const { targetAmount: _t, ...rest } = db.spaces[1]!;
      void _t;
      db.spaces[1] = rest;
      return db;
    }],
    ["a zero target", (db) => {
      db.spaces[1] = { ...db.spaces[1]!, targetAmount: 0 };
      return db;
    }],
    ["an invalid deadline", (db) => {
      db.spaces[1] = { ...db.spaces[1]!, deadline: "2026-02-30" };
      return db;
    }],
    ["an unknown icon", (db) => ({ ...db, spaces: db.spaces.map((s) => ({ ...s, icon: "rocket" })) })],
    ["duplicate Space ids", (db) => ({ ...db, spaces: [...db.spaces, db.spaces[0]] })],
    ["a Space balance below ₹0 (money moved back that was never added)", (db) => {
      const i = goalEntryIndex(db);
      const e = db.ledger[i]!;
      // Turn the goal's allocation into a release: the Space goes below ₹0.
      db.ledger[i] = { ...e, type: "space_release", direction: "credit" };
      return db;
    }],
    ["missing spaces array", (db) => {
      const { spaces: _s, ...rest } = db;
      void _s;
      return rest;
    }],
  ];

  it.each(cases)("%s", (_label, tamper) => {
    const bad = tamper(seed());
    expect(isSandboxDatabase(bad)).toBe(false);
    // On load: the raw data is backed up and the seed is used instead.
    const storage = memoryStorage();
    const raw = JSON.stringify(bad);
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const loaded = createLocalRepository(() => storage).load(NOW);
    expect(loaded.outcome.kind).toBe("recovered");
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    expect(loaded.db).toEqual(buildSeedDatabase());
  });
});

describe("reload and reset", () => {
  it("Spaces, their balances and history survive a save + reload exactly", () => {
    let s = scopeFor(buildSeedDatabase(), SEED_TEEN_ID)!.state;
    s = must(
      createSpaceTransition(s, {
        ...TEEN,
        spaceId: "spc_trip",
        name: "Trip",
        type: "goal",
        icon: "plane",
        targetAmount: 3000,
        deadline: "2027-03-01",
        startingAmount: 400,
      }),
    );
    s = must(moveSpaceMoneyTransition(s, { ...TEEN, operationId: "back_1", spaceId: "spc_trip", amount: 150, direction: "withdraw" }));
    const db = databaseFromState(s);
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(db);
    const { db: loaded, outcome } = repo.load(NOW);
    expect(outcome).toEqual({ kind: "loaded" });
    expect(loaded.spaces).toEqual(db.spaces);
    expect(loaded.ledger).toEqual(db.ledger);
    expect(spaceBalance(loaded.ledger, "spc_trip")).toBe(250);
    expect(walletBalance(loaded.ledger, TEEN_WALLET)).toBe(1600);
  });

  it("reset is deterministic and restores the seed Spaces", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    storage.setItem(SANDBOX_STORAGE_KEY, "{}");
    storage.setItem(SANDBOX_BACKUP_KEY, "{}");
    const a = repo.reset();
    const b = repo.reset();
    expect(a).toEqual(b);
    // Phase 8: plus the seeded peer teen's own (empty) default Save.
    expect(a.spaces.map((sp) => sp.id)).toEqual([SEED_SAVE_SPACE_ID, SEED_GOAL_SPACE_ID, "spc_save_usr_meera"]);
    expect(storage.getItem(SANDBOX_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBeNull();
  });
});
