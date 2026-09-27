import { describe, expect, it } from "vitest";
import { MISSIONS, type MissionProgress } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import { advanceMissionTransition, missionBoardFor, startMissionTransition } from "@/sandbox/missions";
import { isSandboxDatabase, migrateToCurrent, migrateV7, type V7Database } from "@/sandbox/persistence";
import { createLocalRepository, SANDBOX_BACKUP_KEY, SANDBOX_STORAGE_KEY } from "@/sandbox/repository";
import { buildSeedDatabase, buildSeedState, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SANDBOX_SCHEMA_VERSION, type SandboxDatabase } from "@/sandbox/types";

/**
 * Money Missions (Phase 11) — persistence. Progress lives in the one
 * sandbox database (optional `missionProgress`, additive in schema v8
 * — no new version, no separate storage). It survives reload, Reset
 * Sandbox clears it, and tampered progress is refused through the
 * existing backup-and-recover path instead of crashing.
 */

const AT = "2026-09-27T05:00:00.000Z";
const LATER = "2026-09-27T05:05:00.000Z";
const NOW = "2026-09-27T06:00:00.000Z";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

function ok(out: { db: SandboxDatabase; result: { ok: boolean } }): SandboxDatabase {
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.db;
}

/** Seed with one completed and one in-progress mission for Aarav, one started for Meera. */
function withProgress(): SandboxDatabase {
  let db = buildSeedDatabase();
  db = ok(startMissionTransition(db, { actorId: SEED_TEEN_ID, at: AT, missionId: "know-your-balance" }));
  for (const [stepId, answer] of [["total"], ["available"], ["check", 1]] as const) {
    db = ok(advanceMissionTransition(db, { actorId: SEED_TEEN_ID, at: LATER, missionId: "know-your-balance", stepId, ...(answer !== undefined ? { answer } : {}) }));
  }
  db = ok(startMissionTransition(db, { actorId: SEED_TEEN_ID, at: AT, missionId: "payment-safety" }));
  db = ok(advanceMissionTransition(db, { actorId: SEED_TEEN_ID, at: LATER, missionId: "payment-safety", stepId: "check-first" }));
  db = ok(startMissionTransition(db, { actorId: SEED_PEER_ID, at: AT, missionId: "send-vs-request" }));
  return db;
}

const withRecords = (records: unknown): SandboxDatabase => ({ ...withProgress(), missionProgress: records as MissionProgress[] });

const good = (): MissionProgress => ({
  ownerAccountId: SEED_TEEN_ID,
  missionId: "send-vs-request",
  stepsCompleted: 1,
  startedAt: AT,
  updatedAt: LATER,
});

describe("schema", () => {
  it("stays v8 — mission progress is optional and additive", () => {
    expect(SANDBOX_SCHEMA_VERSION).toBe(8);
    const seed = buildSeedDatabase();
    expect(seed.missionProgress).toBeUndefined();
    expect(isSandboxDatabase(seed)).toBe(true);
    expect(isSandboxDatabase(withProgress())).toBe(true);
    expect(isSandboxDatabase({ ...seed, missionProgress: [] })).toBe(true);
  });

  it("every catalog mission's full completion is valid stored data", () => {
    const records: MissionProgress[] = MISSIONS.map((m) => ({
      ownerAccountId: SEED_TEEN_ID,
      missionId: m.id,
      stepsCompleted: m.steps.length,
      startedAt: AT,
      updatedAt: LATER,
      completedAt: LATER,
    }));
    expect(isSandboxDatabase({ ...buildSeedDatabase(), missionProgress: records })).toBe(true);
  });
});

describe("save → load (reload)", () => {
  it("progress survives a reload exactly", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    const db = withProgress();
    expect(repo.save(db)).toBe(true);
    const loaded = createLocalRepository(() => storage).load(NOW);
    expect(loaded.outcome).toEqual({ kind: "loaded" });
    expect(loaded.db.missionProgress).toEqual(db.missionProgress);
    const board = missionBoardFor(loaded.db, SEED_TEEN_ID);
    expect(board.ok && board.value.completed).toBe(1);
    expect(board.ok && board.value.next?.id).toBe("payment-safety");
    expect(board.ok && board.value.next?.statusLabel).toBe("In progress · Step 2 of 4");
  });

  it("stored v8 data from before Phase 11 (no missionProgress) loads as-is — no migration", () => {
    const storage = memoryStorage();
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(buildSeedDatabase()));
    const loaded = createLocalRepository(() => storage).load(NOW);
    expect(loaded.outcome).toEqual({ kind: "loaded" });
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBeNull();
    const board = missionBoardFor(loaded.db, SEED_TEEN_ID);
    expect(board.ok && board.value.completed).toBe(0);
  });

  it("older schemas still migrate and start with no missions", () => {
    const { contacts: _c, ...rest } = clone(buildSeedDatabase());
    void _c;
    const v7 = { ...rest, version: 7 } as V7Database;
    const migrated = migrateV7(clone(v7));
    expect(migrated.missionProgress).toBeUndefined();
    expect(isSandboxDatabase(migrated)).toBe(true);
    const result = migrateToCurrent(v7, { seedView: buildSeedState, now: NOW });
    expect(result).toMatchObject({ kind: "migrated", from: 7 });
  });
});

describe("Reset Sandbox", () => {
  it("clears mission progress (and its backup)", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(withProgress());
    storage.setItem(SANDBOX_BACKUP_KEY, JSON.stringify(withProgress()));
    const fresh = repo.reset();
    expect(fresh.missionProgress).toBeUndefined();
    expect(storage.getItem(SANDBOX_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBeNull();
    const board = missionBoardFor(fresh, SEED_TEEN_ID);
    expect(board.ok && board.value.completed).toBe(0);
  });
});

describe("tampered or malformed progress is refused (and recovered from)", () => {
  const cases: Array<[string, unknown]> = [
    ["not a list", { ownerAccountId: SEED_TEEN_ID }],
    ["null", null],
    ["a non-object record", ["know-your-balance"]],
    ["a smuggled balance", [{ ...good(), balance: 100000 }]],
    ["a smuggled reward", [{ ...good(), reward: 500 }]],
    ["a smuggled wallet id", [{ ...good(), walletId: "wal_aarav" }]],
    ["an unknown mission", [{ ...good(), missionId: "free-money" }]],
    ["a prototype-ish mission id", [{ ...good(), missionId: "__proto__" }]],
    ["a parent owner", [{ ...good(), ownerAccountId: SEED_PARENT_ID }]],
    ["an unknown owner", [{ ...good(), ownerAccountId: "usr_ghost" }]],
    ["negative steps", [{ ...good(), stepsCompleted: -1 }]],
    ["fractional steps", [{ ...good(), stepsCompleted: 1.5 }]],
    ["steps as text", [{ ...good(), stepsCompleted: "2" }]],
    ["too many steps", [{ ...good(), stepsCompleted: 4 }]],
    ["finished without completedAt", [{ ...good(), stepsCompleted: 3 }]],
    ["completedAt before finishing", [{ ...good(), completedAt: LATER }]],
    ["a bad timestamp", [{ ...good(), startedAt: "yesterday" }]],
    ["updated before started", [{ ...good(), startedAt: LATER, updatedAt: AT }]],
    ["completed after the last update", [{ ...good(), stepsCompleted: 3, completedAt: NOW }]],
    ["a duplicate record", [good(), { ...good(), stepsCompleted: 2 }]],
  ];

  it.each(cases)("refuses %s", (_label, records) => {
    expect(isSandboxDatabase(withRecords(records))).toBe(false);
  });

  it("a corrupt stored database loads the seed, keeps a backup, and doesn't crash", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(withRecords([{ ...good(), stepsCompleted: 99 }]));
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const loaded = createLocalRepository(() => storage).load(NOW);
    expect(loaded.outcome).toEqual({ kind: "recovered" });
    expect(loaded.db.missionProgress).toBeUndefined();
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    expect(missionBoardFor(loaded.db, SEED_TEEN_ID).ok).toBe(true);
  });

  it("a teen who later closes their account keeps valid records (still a teen)", () => {
    const made = createAccount(buildSeedDatabase(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    let db = ok(startMissionTransition(made.db, { actorId: made.account.id, at: AT, missionId: "know-your-balance" }));
    db = { ...db, accounts: db.accounts.map((a) => (a.id === made.account.id ? { ...a, status: "closed" as const } : a)) };
    expect(isSandboxDatabase(db)).toBe(true);
  });
});
