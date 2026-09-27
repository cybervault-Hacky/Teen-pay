import { describe, expect, it } from "vitest";
import {
  acceptMoneyRequestTransition,
  cancelMoneyRequestTransition,
  createMoneyRequestTransition,
  declineMoneyRequestTransition,
  requestIdFor,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { isSandboxDatabase, isV6Database, isV7Database, migrateToCurrent, migrateV6, migrateV7 } from "@/sandbox/persistence";
import {
  createLocalRepository,
  describeLoadOutcome,
  SANDBOX_BACKUP_KEY,
  SANDBOX_STORAGE_KEY,
} from "@/sandbox/repository";
import { buildSeedDatabase, buildSeedState, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT } from "./helpers/fixtures";

const NOW = "2026-09-26T08:00:00.000Z";
const LATER = "2026-09-26T07:00:00Z";
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

function ok<T extends { result: { ok: boolean }; db: SandboxDatabase }>(out: T): SandboxDatabase {
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.db;
}

/** A Phase 7 (v6) database: today's minus peerRequests (and Meera, who arrived in the v7 seed). */
function v6Database(): Record<string, unknown> {
  // (Phase 9: nor favourites — v6 never had them.)
  const { peerRequests: _drop, contacts: _contacts, ...rest } = clone(buildSeedDatabase());
  void _drop;
  void _contacts;
  return { ...rest, version: 6 };
}

/** A database with a transfer and one request in each settled state, plus one pending. */
function withPeerActivity(): SandboxDatabase {
  let db = buildSeedDatabase();
  db = ok(sendMoneyTransition(db, { actorId: SEED_TEEN_ID, at: AT, recipient: "@meera", amount: 100, idempotencyKey: "snd_persist_1" }));
  const make = (key: string, amount: number) =>
    (db = ok(createMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, payer: "@meera", amount, note: "Lunch", idempotencyKey: key })));
  make("prq_persist_pay", 200);
  make("prq_persist_dec", 50);
  make("prq_persist_can", 60);
  make("prq_persist_open", 70);
  db = ok(acceptMoneyRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, requestId: requestIdFor("prq_persist_pay") }));
  db = ok(declineMoneyRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, requestId: requestIdFor("prq_persist_dec") }));
  db = ok(cancelMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, requestId: requestIdFor("prq_persist_can") }));
  return db;
}

describe("migration — Phase 7 (v6) → Phase 8 (v7 money requests)", () => {
  it("adds an empty peerRequests list and keeps every record", () => {
    const v6 = v6Database();
    expect(isV6Database(v6)).toBe(true);
    const db = migrateV6(clone(v6) as never);
    expect(db.version).toBe(7);
    expect(db.peerRequests).toEqual([]);
    for (const key of ["accounts", "wallets", "ledger", "operations", "spaces", "pocketMoneySchedules", "families", "notifications"]) {
      expect((db as unknown as Record<string, unknown>)[key]).toEqual(v6[key]);
    }
    // Phase 9: v7 is now a step on the way to v8 (favourites).
    expect(isV7Database(db)).toBe(true);
    expect(isSandboxDatabase(db)).toBe(false);
    expect(isSandboxDatabase(migrateV7(db))).toBe(true);
  });

  it("stored v6 data is backed up first, upgraded on load, and never migrated twice", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(v6Database());
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const repo = createLocalRepository(() => storage);
    const first = repo.load(NOW);
    expect(first.outcome).toEqual({ kind: "migrated", from: 6 });
    expect(describeLoadOutcome(first.outcome)).toMatch(/sending and requesting money/);
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    repo.save(first.db);
    const second = repo.load(NOW);
    expect(second.outcome).toEqual({ kind: "loaded" });
    expect(second.db).toEqual(first.db);
  });

  it("the whole chain still lands on the current schema (v8 since Phase 9)", () => {
    const result = migrateToCurrent(v6Database(), { seedView: buildSeedState, now: NOW });
    expect(result.kind).toBe("migrated");
    if (result.kind === "migrated") {
      expect(result.db.version).toBe(8);
      expect(result.db.peerRequests).toEqual([]);
      expect(result.db.contacts).toEqual([]);
    }
  });
});

describe("persistence — transfers and requests survive reload exactly", () => {
  it("round-trips, validates, and a reloaded accepted request still can't pay twice", () => {
    const db = withPeerActivity();
    expect(isSandboxDatabase(clone(db))).toBe(true);
    expect(db.peerRequests.map((r) => r.status).sort()).toEqual(["accepted", "cancelled", "declined", "pending"]);
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(db);
    const loaded = repo.load(NOW);
    expect(loaded.outcome).toEqual({ kind: "loaded" });
    expect(loaded.db).toEqual(db);
    const again = acceptMoneyRequestTransition(loaded.db, { actorId: SEED_PEER_ID, at: NOW, requestId: requestIdFor("prq_persist_pay") });
    expect(again.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(again.db).toBe(loaded.db);
    const resend = sendMoneyTransition(loaded.db, { actorId: SEED_TEEN_ID, at: NOW, recipient: "@meera", amount: 100, idempotencyKey: "snd_persist_1" });
    expect(resend.db).toBe(loaded.db);
  });

  it("reset is deterministic: the current (v8) seed, with no requests", () => {
    const storage = memoryStorage();
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(withPeerActivity()));
    const repo = createLocalRepository(() => storage);
    const seed = repo.reset();
    expect(seed).toEqual(buildSeedDatabase());
    expect(seed.version).toBe(8);
    expect(seed.peerRequests).toEqual([]);
    expect(seed.contacts).toEqual([]);
  });
});

describe("persistence — malformed peer data is refused and recovered safely", () => {
  type Tamper = (db: SandboxDatabase) => unknown;
  const mapRequests = (db: SandboxDatabase, fn: (r: SandboxDatabase["peerRequests"][number]) => unknown) => ({
    ...db,
    peerRequests: db.peerRequests.map(fn),
  });
  const accepted = (db: SandboxDatabase) => db.peerRequests.find((r) => r.status === "accepted")!;
  const cases: [string, Tamper][] = [
    ["missing peerRequests", (db) => { const { peerRequests: _p, ...rest } = db; void _p; return rest; }],
    ["peerRequests not an array", (db) => ({ ...db, peerRequests: {} })],
    ["negative amount", (db) => mapRequests(db, (r) => ({ ...r, amount: -5 }))],
    ["decimal amount", (db) => mapRequests(db, (r) => ({ ...r, amount: 10.5 }))],
    ["unknown status", (db) => mapRequests(db, (r) => ({ ...r, status: "paid" }))],
    ["wrong currency", (db) => mapRequests(db, (r) => ({ ...r, currency: "USD" }))],
    ["self request", (db) => mapRequests(db, (r) => ({ ...r, payerAccountId: r.requesterAccountId, payerWalletId: r.requesterWalletId }))],
    ["wallet not owned by the party", (db) => mapRequests(db, (r) => ({ ...r, payerWalletId: r.requesterWalletId }))],
    ["unknown account", (db) => mapRequests(db, (r) => ({ ...r, payerAccountId: "usr_ghost" }))],
    ["note too long", (db) => mapRequests(db, (r) => ({ ...r, note: "x".repeat(61) }))],
    ["tampered expiry", (db) => mapRequests(db, (r) => ({ ...r, expiresAt: "2030-01-01T00:00:00.000Z" }))],
    ["duplicate request ids", (db) => ({ ...db, peerRequests: [...db.peerRequests, db.peerRequests[0]] })],
    ["duplicate idempotency keys", (db) => ({ ...db, peerRequests: db.peerRequests.map((r, i) => (i === 1 ? { ...r, idempotencyKey: db.peerRequests[0]!.idempotencyKey } : r)) })],
    ["pending with a payment reference", (db) => mapRequests(db, (r) => (r.status === "pending" ? { ...r, resultingPaymentReference: "TRF-FAKE" } : r))],
    ["declined pointing at money", (db) => mapRequests(db, (r) => (r.status === "declined" ? { ...r, resultingPaymentReference: accepted(db).resultingPaymentReference } : r))],
    ["accepted with no transfer", (db) => ({ ...db, operations: db.operations.filter((o) => !o.requestId), ledger: db.ledger.filter((e) => !e.requestId) })],
    ["accepted with the wrong reference", (db) => mapRequests(db, (r) => (r.status === "accepted" ? { ...r, resultingPaymentReference: "TRF-OTHER" } : r))],
    ["accepted amount disagrees with the ledger", (db) => mapRequests(db, (r) => (r.status === "accepted" ? { ...r, amount: 999 } : r))],
    ["a request transfer whose request is gone", (db) => ({ ...db, peerRequests: db.peerRequests.filter((r) => r.status !== "accepted") })],
    ["a non-pending request with no respondedAt", (db) => mapRequests(db, (r) => (r.status === "declined" ? { ...r, respondedAt: undefined } : r))],
    [
      "a transfer with two debits",
      (db) => ({ ...db, ledger: db.ledger.map((e) => (e.operationId === "snd_persist_1" ? { ...e, direction: "debit" } : e)) }),
    ],
  ];

  it.each(cases)("%s", (_label, tamper) => {
    const bad = clone(tamper(clone(withPeerActivity())));
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
    expect(isSandboxDatabase(clone(withPeerActivity()))).toBe(true);
  });
});
