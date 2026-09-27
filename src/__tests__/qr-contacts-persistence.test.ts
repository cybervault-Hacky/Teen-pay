import { describe, expect, it } from "vitest";
import { CONTACT_LIMIT, type Contact } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import { addContactTransition, removeContactTransition } from "@/sandbox/contacts";
import { createMoneyRequestTransition, sendMoneyTransition } from "@/sandbox/peer-transitions";
import { isSandboxDatabase, isV7Database, migrateToCurrent, migrateV7, type V7Database } from "@/sandbox/persistence";
import {
  createLocalRepository,
  describeLoadOutcome,
  SANDBOX_BACKUP_KEY,
  SANDBOX_STORAGE_KEY,
} from "@/sandbox/repository";
import { buildSeedDatabase, buildSeedState, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT } from "./helpers/fixtures";

/**
 * Phase 9 — persistence: schema v8 adds favourites (and nothing for
 * QR, which is derived). v7 data upgrades with every record kept;
 * favourites survive reload; tampered favourites are refused.
 */

const NOW = "2026-09-26T08:00:00.000Z";
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

/** A Phase 8 database with real peer activity (a transfer and a pending request). */
function v8WithActivity(): SandboxDatabase {
  let db = buildSeedDatabase();
  db = ok(sendMoneyTransition(db, { actorId: SEED_TEEN_ID, at: AT, recipient: "@meera", amount: 100, idempotencyKey: "snd_v7_0001" }));
  db = ok(createMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, payer: "@meera", amount: 60, idempotencyKey: "prq_v7_0001" }));
  return db;
}

/** The same data as stored by Phase 8 (schema v7: no favourites). */
function v7Database(): V7Database & Record<string, unknown> {
  const { contacts: _drop, ...rest } = clone(v8WithActivity());
  void _drop;
  return { ...rest, version: 7 };
}

/** Favourites on both sides, including one for a teen who later closed their account. */
function withContacts(): SandboxDatabase {
  let db = v8WithActivity();
  const made = createAccount(db, { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
  if ("code" in made) throw new Error(made.message);
  db = made.db;
  db = ok(addContactTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", contactId: "ctc_persist_01" }));
  db = ok(addContactTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@kabirrao", contactId: "ctc_persist_02" }));
  db = ok(addContactTransition(db, { actorId: SEED_PEER_ID, at: AT, teenPayId: "@aarav", contactId: "ctc_persist_03" }));
  // Kabir closes his account later: Aarav's favourite for him goes stale (still valid data).
  return { ...db, accounts: db.accounts.map((a) => (a.id === made.account.id ? { ...a, status: "closed" as const } : a)) };
}

describe("migration — Phase 8 (v7) → Phase 9 (v8 favourites)", () => {
  it("adds an empty contacts list and keeps every record untouched", () => {
    const v7 = v7Database();
    expect(isV7Database(v7)).toBe(true);
    expect(isSandboxDatabase(v7)).toBe(false);
    const db = migrateV7(clone(v7));
    expect(db.version).toBe(8);
    expect(db.contacts).toEqual([]);
    for (const key of [
      "accounts", "families", "wallets", "ledger", "operations", "spaces", "pocketMoneySchedules",
      "teenRecords", "peerRequests", "notifications", "familyLogs", "securityEvents", "recipients",
    ]) {
      expect((db as unknown as Record<string, unknown>)[key]).toEqual(v7[key]);
    }
    expect(isSandboxDatabase(db)).toBe(true);
  });

  it("anything a v7 payload stored under `contacts` is foreign and is dropped", () => {
    const v7 = { ...v7Database(), contacts: [{ contactId: "ctc_foreign_1", walletId: "wal_usr_meera" }] };
    const result = migrateToCurrent(v7, { seedView: buildSeedState, now: NOW });
    expect(result).toMatchObject({ kind: "migrated", from: 7 });
    if (result.kind === "migrated") expect(result.db.contacts).toEqual([]);
  });

  it("stored v7 data is backed up first, upgraded on load, and never migrated twice", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(v7Database());
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const repo = createLocalRepository(() => storage);
    const first = repo.load(NOW);
    expect(first.outcome).toEqual({ kind: "migrated", from: 7 });
    expect(describeLoadOutcome(first.outcome)).toMatch(/QR codes and favourites/);
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    expect(first.db.peerRequests).toHaveLength(1);
    expect(first.db.operations.filter((op) => op.type === "transfer" && op.id === "snd_v7_0001")).toHaveLength(1);
    repo.save(first.db);
    const second = repo.load(NOW);
    expect(second.outcome).toEqual({ kind: "loaded" });
    expect(second.db).toEqual(first.db);
  });

  it("the whole chain from older schemas still lands on v8", () => {
    // A Phase 7 (v6) payload: no money requests, no favourites.
    const plain = clone(buildSeedDatabase()) as unknown as Record<string, unknown>;
    delete plain.peerRequests;
    delete plain.contacts;
    const result = migrateToCurrent({ ...plain, version: 6 }, { seedView: buildSeedState, now: NOW });
    expect(result).toMatchObject({ kind: "migrated", from: 6 });
    if (result.kind === "migrated") expect(result.db).toMatchObject({ version: 8, peerRequests: [], contacts: [] });
  });
});

describe("persistence — favourites survive reload exactly", () => {
  it("round-trips (stale ones too), with no duplicates", () => {
    const db = withContacts();
    expect(isSandboxDatabase(clone(db))).toBe(true);
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(db);
    const loaded = repo.load(NOW);
    expect(loaded.outcome).toEqual({ kind: "loaded" });
    expect(loaded.db).toEqual(db);
    expect(loaded.db.contacts).toHaveLength(3);
    // Saving the same person again after reload is still refused.
    const dup = addContactTransition(loaded.db, { actorId: SEED_TEEN_ID, at: NOW, teenPayId: "@meera", contactId: "ctc_persist_09" });
    expect(dup.result).toMatchObject({ ok: false, error: { code: "contact_exists" } });
  });

  it("removal persists too", () => {
    const db = ok(removeContactTransition(withContacts(), { actorId: SEED_TEEN_ID, at: NOW, teenPayId: "@meera" }));
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(db);
    expect(repo.load(NOW).db.contacts.map((c) => c.contactId).sort()).toEqual(["ctc_persist_02", "ctc_persist_03"]);
  });

  it("reset is deterministic: the v8 seed has no favourites", () => {
    const storage = memoryStorage();
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(withContacts()));
    const seed = createLocalRepository(() => storage).reset();
    expect(seed).toEqual(buildSeedDatabase());
    expect(seed.contacts).toEqual([]);
  });
});

describe("persistence — malformed favourites are refused and recovered safely", () => {
  type Tamper = (db: SandboxDatabase) => unknown;
  const first = (db: SandboxDatabase, fn: (c: Contact) => unknown) => ({
    ...db,
    contacts: db.contacts.map((c, i) => (i === 0 ? fn(c) : c)),
  });
  const cases: [string, Tamper][] = [
    ["missing contacts", (db) => { const { contacts: _c, ...rest } = db; void _c; return rest; }],
    ["contacts not an array", (db) => ({ ...db, contacts: {} })],
    ["a smuggled wallet id", (db) => first(db, (c) => ({ ...c, walletId: "wal_usr_meera" }))],
    ["a smuggled account id", (db) => first(db, (c) => ({ ...c, targetAccountId: SEED_PEER_ID }))],
    ["a name snapshot", (db) => first(db, (c) => ({ ...c, name: "Meera Kapoor" }))],
    ["a missing field", (db) => first(db, (c) => { const { updatedAt: _u, ...rest } = c; void _u; return rest; })],
    ["a malformed contact id", (db) => first(db, (c) => ({ ...c, contactId: "abc" }))],
    ["an unknown owner", (db) => first(db, (c) => ({ ...c, ownerAccountId: "usr_ghost" }))],
    ["a parent owner", (db) => first(db, (c) => ({ ...c, ownerAccountId: SEED_PARENT_ID }))],
    ["an unknown TeenPay ID", (db) => first(db, (c) => ({ ...c, teenPayId: "nobody" }))],
    ["a TeenPay ID with @", (db) => first(db, (c) => ({ ...c, teenPayId: "@meera" }))],
    ["an internal id as the target", (db) => first(db, (c) => ({ ...c, teenPayId: SEED_PEER_ID }))],
    ["a parent as the target", (db) => first(db, (c) => ({ ...c, teenPayId: "priya" }))],
    ["yourself as the target", (db) => first(db, (c) => ({ ...c, teenPayId: "aarav" }))],
    ["a bad timestamp", (db) => first(db, (c) => ({ ...c, createdAt: "yesterday" }))],
    ["updated before created", (db) => first(db, (c) => ({ ...c, updatedAt: "2020-01-01T00:00:00.000Z" }))],
    ["duplicate contact ids", (db) => ({ ...db, contacts: db.contacts.map((c, i) => (i === 1 ? { ...c, contactId: db.contacts[0]!.contactId } : c)) })],
    ["the same person saved twice", (db) => ({ ...db, contacts: [...db.contacts, { ...db.contacts[0]!, contactId: "ctc_persist_99" }] })],
    [
      `more than ${CONTACT_LIMIT} for one owner`,
      (db) => ({
        ...db,
        contacts: [
          ...db.contacts,
          ...Array.from({ length: CONTACT_LIMIT }, (_, i) => ({ ...db.contacts[2]!, contactId: `ctc_extra_${String(i).padStart(3, "0")}` })),
        ],
      }),
    ],
  ];

  it.each(cases)("%s", (_label, tamper) => {
    const bad = clone(tamper(clone(withContacts())));
    expect(isSandboxDatabase(bad)).toBe(false);
    const storage = memoryStorage();
    const raw = JSON.stringify(bad);
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const loaded = createLocalRepository(() => storage).load(NOW);
    expect(loaded.outcome.kind).toBe("recovered");
    expect(loaded.db).toEqual(buildSeedDatabase());
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
  });
});
