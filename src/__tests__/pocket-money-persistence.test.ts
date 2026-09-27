import { describe, expect, it } from "vitest";
import {
  createPocketMoneyScheduleTransition,
  executeDuePocketMoneyTransition,
  resumePocketMoneyScheduleTransition,
} from "@/sandbox/allowance-transitions";
import { walletBalance } from "@/sandbox/engine";
import { databaseFromState, isSandboxDatabase, isV5Database, migrateToCurrent } from "@/sandbox/persistence";
import { createLocalRepository, SANDBOX_BACKUP_KEY, SANDBOX_STORAGE_KEY } from "@/sandbox/repository";
import { scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, buildSeedState, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { disconnectTransition } from "@/sandbox/family-transitions";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { AT, PARENT, PARENT_WALLET, TEEN_WALLET, linkedState, must } from "./helpers/fixtures";

const NOW = "2026-09-26T08:00:00.000Z";
const MON1 = "2026-09-28T06:00:00Z";
const MON2 = "2026-10-05T06:00:00Z";

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

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/**
 * A Phase 6 (v5) database: a v6 one without schedules, where the
 * parent had saved the old "recurring pocket money preview" on the
 * teen's controls.
 */
function v5Database(
  allowance: Record<string, unknown> | null = { amount: 500, frequency: "weekly", weekday: 1, dayOfMonth: 1 },
  base: SandboxState = linkedState(),
): Record<string, unknown> {
  const { pocketMoneySchedules: _drop, ...rest } = clone(databaseFromState(base));
  void _drop;
  return {
    ...rest,
    version: 5,
    families: rest.families.map((f) => ({
      ...f,
      controls: f.controls.map((c) => ({ ...c, allowance })),
    })),
  };
}

function withRun(): SandboxDatabase {
  let s = must(
    createPocketMoneyScheduleTransition(linkedState(), {
      ...PARENT,
      scheduleId: "pms_1",
      teenId: SEED_TEEN_ID,
      amount: 500,
      frequency: "weekly",
      dayOfWeek: 1,
      dayOfMonth: 1,
      startDate: "2026-09-26",
    }),
  );
  s = must(executeDuePocketMoneyTransition(s, { ...PARENT, at: MON1 }));
  return databaseFromState(s);
}

const moneyOf = (db: { ledger: unknown; operations: unknown; spaces: unknown }) =>
  JSON.stringify([db.ledger, db.operations, db.spaces]);

describe("migration — Phase 6 (v5) → Phase 7 (v6 pocket money schedules)", () => {
  it("keeps every record and turns the saved preview into a paused schedule", () => {
    const v5 = v5Database();
    expect(isV5Database(clone(v5))).toBe(true);
    const result = migrateToCurrent(clone(v5), { seedView: buildSeedState, now: NOW });
    expect(result.kind).toBe("migrated");
    if (result.kind !== "migrated") return;
    expect(result.from).toBe(5);
    const db = result.db;
    expect(db.version).toBe(6);
    expect(isSandboxDatabase(clone(db))).toBe(true);

    // Money, accounts, Spaces, notifications: untouched.
    expect(moneyOf(db)).toBe(moneyOf(v5 as never));
    expect(db.accounts).toEqual(v5.accounts);
    expect(db.wallets).toEqual(v5.wallets);
    expect(db.notifications).toEqual(v5.notifications);
    expect(walletBalance(db.ledger, TEEN_WALLET)).toBe(1850);
    expect(walletBalance(db.ledger, PARENT_WALLET)).toBe(5500);

    // The preview became one paused schedule (nothing will run until
    // the parent resumes it), and the old field is gone.
    expect(db.pocketMoneySchedules).toEqual([
      expect.objectContaining({
        id: `pms_legacy_${SEED_TEEN_ID}`,
        parentAccountId: SEED_PARENT_ID,
        teenAccountId: SEED_TEEN_ID,
        sourceWalletId: PARENT_WALLET,
        destinationWalletId: TEEN_WALLET,
        amount: 500,
        frequency: "weekly",
        dayOfWeek: 1,
        status: "paused",
        nextRunAt: null,
        startDate: "2026-09-26",
        version: 1,
        runs: [],
      }),
    ]);
    expect(db.families[0]!.controls.every((c) => !("allowance" in c))).toBe(true);
    // Everything else on the controls is preserved.
    const { allowance: _a, ...restControls } = (v5.families as SandboxDatabase["families"])[0]!.controls[0] as never as Record<string, unknown>;
    void _a;
    expect(db.families[0]!.controls[0]).toEqual(restControls);
  });

  it("the migrated schedule is usable: resume, then execute through the ledger", () => {
    const result = migrateToCurrent(v5Database(), { seedView: buildSeedState, now: NOW });
    if (result.kind !== "migrated") throw new Error("expected migration");
    let s = scopeFor(result.db, SEED_PARENT_ID)!.state;
    s = must(resumePocketMoneyScheduleTransition(s, { ...PARENT, scheduleId: `pms_legacy_${SEED_TEEN_ID}` }));
    s = must(executeDuePocketMoneyTransition(s, { ...PARENT, at: MON1 }));
    expect(walletBalance(s.ledger, TEEN_WALLET)).toBe(2350);
    expect(walletBalance(s.ledger, PARENT_WALLET)).toBe(5000);
  });

  it("stored v5 data is backed up, upgraded on load, and never migrated twice", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(v5Database());
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const repo = createLocalRepository(() => storage);
    const first = repo.load(NOW);
    expect(first.outcome).toEqual({ kind: "migrated", from: 5 });
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    repo.save(first.db);
    const second = repo.load(NOW);
    expect(second.outcome).toEqual({ kind: "loaded" });
    expect(second.db.pocketMoneySchedules).toHaveLength(1);
    expect(second.db).toEqual(first.db);
    // The backup still holds the original preview for recovery.
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toContain('"allowance"');
  });

  it("skips a preview that can't become a safe schedule", () => {
    for (const allowance of [
      { amount: 0, frequency: "weekly", weekday: 1, dayOfMonth: 1 },
      { amount: 500, frequency: "daily", weekday: 1, dayOfMonth: 1 },
      { amount: 500, frequency: "monthly", weekday: 1, dayOfMonth: 31 },
    ]) {
      const result = migrateToCurrent(v5Database(allowance), { seedView: buildSeedState, now: NOW });
      // Out-of-range previews are unreadable as v5, or migrate with no schedule.
      if (result.kind === "migrated") expect(result.db.pocketMoneySchedules).toEqual([]);
    }
    // Unlinked: nothing to pay from.
    const unlinked = must(disconnectTransition(linkedState(), { ...PARENT, teenId: SEED_TEEN_ID }));
    const result = migrateToCurrent(v5Database(undefined, unlinked), { seedView: buildSeedState, now: NOW });
    expect(result.kind).toBe("migrated");
    if (result.kind === "migrated") expect(result.db.pocketMoneySchedules).toEqual([]);
    // No preview at all.
    const none = migrateToCurrent(v5Database(null), { seedView: buildSeedState, now: NOW });
    if (none.kind === "migrated") expect(none.db.pocketMoneySchedules).toEqual([]);
  });

  it("the seed is v6 with no schedules; reset is deterministic", () => {
    const seed = buildSeedDatabase();
    expect(seed.version).toBe(6);
    expect(seed.pocketMoneySchedules).toEqual([]);
    expect(buildSeedDatabase()).toEqual(seed);
    const storage = memoryStorage();
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(withRun()));
    const repo = createLocalRepository(() => storage);
    expect(repo.reset()).toEqual(seed);
    expect(storage.getItem(SANDBOX_STORAGE_KEY)).toBeNull();
  });
});

describe("persistence — schedules and runs survive reload exactly", () => {
  it("a schedule with a completed run round-trips and validates", () => {
    const db = withRun();
    const round = clone(db);
    expect(isSandboxDatabase(round)).toBe(true);
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(db);
    const loaded = repo.load(NOW);
    expect(loaded.outcome).toEqual({ kind: "loaded" });
    expect(loaded.db).toEqual(db);
    // After reload the same occurrence still can't pay twice.
    const s = scopeFor(loaded.db, SEED_PARENT_ID)!.state;
    const again = executeDuePocketMoneyTransition(s, { ...PARENT, at: MON1 });
    expect(again.state).toBe(s);
    const next = must(executeDuePocketMoneyTransition(s, { ...PARENT, at: MON2 }));
    expect(next.operations.filter((op) => op.scheduleId)).toHaveLength(2);
  });
});

describe("persistence — malformed schedules are refused and recovered safely", () => {
  type Tamper = (db: SandboxDatabase) => unknown;
  const cases: [string, Tamper][] = [
    ["negative amount", (db) => ({ ...db, pocketMoneySchedules: db.pocketMoneySchedules.map((s) => ({ ...s, amount: -5 })) })],
    ["unknown status", (db) => ({ ...db, pocketMoneySchedules: db.pocketMoneySchedules.map((s) => ({ ...s, status: "running" })) })],
    ["duplicate schedule ids", (db) => ({ ...db, pocketMoneySchedules: [...db.pocketMoneySchedules, ...db.pocketMoneySchedules] })],
    [
      "two open schedules for the same pair",
      (db) => ({
        ...db,
        pocketMoneySchedules: [
          ...db.pocketMoneySchedules,
          { ...db.pocketMoneySchedules[0]!, id: "pms_2", runs: [] },
        ],
      }),
    ],
    [
      "a completed run with no ledger operation",
      (db) => ({ ...db, operations: db.operations.filter((op) => !op.scheduleId), ledger: db.ledger.filter((e) => !e.scheduleId) }),
    ],
    [
      "a scheduled operation with no recorded run",
      (db) => ({ ...db, pocketMoneySchedules: db.pocketMoneySchedules.map((s) => ({ ...s, runs: [] })) }),
    ],
    [
      "a run whose amount disagrees with the ledger",
      (db) => ({
        ...db,
        pocketMoneySchedules: db.pocketMoneySchedules.map((s) => ({ ...s, runs: s.runs.map((r) => ({ ...r, amount: 900 })) })),
      }),
    ],
    [
      "a failed run that points at money",
      (db) => ({
        ...db,
        pocketMoneySchedules: db.pocketMoneySchedules.map((s) => ({ ...s, runs: s.runs.map((r) => ({ ...r, status: "failed", reason: "insufficient_funds" })) })),
      }),
    ],
    ["missing schedules array", (db) => { const { pocketMoneySchedules: _p, ...rest } = db; void _p; return rest; }],
  ];

  it.each(cases)("%s", (_label, tamper) => {
    const bad = clone(tamper(clone(withRun())));
    expect(isSandboxDatabase(bad)).toBe(false);
    const storage = memoryStorage();
    const raw = JSON.stringify(bad);
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const loaded = createLocalRepository(() => storage).load(NOW);
    expect(loaded.outcome.kind).toBe("recovered");
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    expect(loaded.db).toEqual(buildSeedDatabase());
  });

  it("an untouched database still validates (the tamper cases are meaningful)", () => {
    expect(isSandboxDatabase(clone(withRun()))).toBe(true);
    expect(AT < MON1).toBe(true);
  });
});
