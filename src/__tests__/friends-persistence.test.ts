import { describe, expect, it } from "vitest";
import type { Friendship } from "@/domain";
import {
  acceptFriendRequestTransition,
  declineFriendRequestTransition,
  friendCircleFor,
  removeFriendTransition,
  sendFriendRequestTransition,
} from "@/sandbox/friends";
import { isSandboxDatabase } from "@/sandbox/persistence";
import { createLocalRepository, SANDBOX_BACKUP_KEY, SANDBOX_STORAGE_KEY } from "@/sandbox/repository";
import { buildSeedDatabase, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SANDBOX_SCHEMA_VERSION, type SandboxDatabase } from "@/sandbox/types";

/**
 * Friend Circles (Phase 12) — persistence. Friendships live in the
 * one sandbox database (optional `friendships`, additive in schema v8
 * — no new version, no separate storage). They survive reload, Reset
 * clears them, and tampered records are refused through the existing
 * backup-and-recover path instead of crashing.
 */

const AT = "2026-09-27T05:00:00.000Z";
const LATER = "2026-09-27T05:10:00.000Z";
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

/** Seed with one accepted friendship (Aarav ~ Meera) and one pending from Meera. */
function withFriendships(): SandboxDatabase {
  let db = buildSeedDatabase();
  const sent = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_persist_a" });
  if (!sent.result.ok) throw new Error(sent.result.error.message);
  db = sent.db;
  const accepted = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: sent.result.value.friendshipId });
  if (!accepted.result.ok) throw new Error(accepted.result.error.message);
  return accepted.db;
}

function goodRecord(over: Record<string, unknown> = {}): Friendship {
  return {
    friendshipId: "frd_record_one",
    requesterAccountId: SEED_TEEN_ID,
    recipientAccountId: SEED_PEER_ID,
    status: "pending",
    createdAt: AT,
    updatedAt: AT,
    ...over,
  } as Friendship;
}

const withRecords = (records: unknown): SandboxDatabase => ({
  ...buildSeedDatabase(),
  friendships: records as Friendship[],
});

describe("schema", () => {
  it("stays v8 — friendships are optional and additive", () => {
    expect(SANDBOX_SCHEMA_VERSION).toBe(8);
    const seed = buildSeedDatabase();
    expect(seed.friendships).toBeUndefined();
    expect(isSandboxDatabase(seed)).toBe(true); // an earlier v8 database is still valid
    expect(isSandboxDatabase(withFriendships())).toBe(true);
    expect(isSandboxDatabase({ ...seed, friendships: [] })).toBe(true);
  });

  it("accepts every lifecycle shape with coherent timestamps", () => {
    expect(isSandboxDatabase(withRecords([goodRecord()]))).toBe(true);
    expect(
      isSandboxDatabase(withRecords([goodRecord({ status: "accepted", acceptedAt: LATER, updatedAt: LATER })])),
    ).toBe(true);
    expect(
      isSandboxDatabase(withRecords([goodRecord({ status: "declined", endedAt: LATER, updatedAt: LATER })])),
    ).toBe(true);
    expect(
      isSandboxDatabase(withRecords([goodRecord({ status: "cancelled", endedAt: LATER, updatedAt: LATER })])),
    ).toBe(true);
    expect(
      isSandboxDatabase(
        withRecords([goodRecord({ status: "removed", acceptedAt: LATER, endedAt: LATER, updatedAt: LATER })]),
      ),
    ).toBe(true);
  });
});

describe("refuses tampered records (backup + recover, never crash)", () => {
  const bad: [string, unknown][] = [
    ["unknown field (a smuggled balance)", [goodRecord({ balance: 500 })]],
    ["unknown field (a wallet id)", [goodRecord({ walletId: "wal_usr_meera" })]],
    ["missing field", [{ ...goodRecord(), status: undefined }]],
    ["invalid status", [goodRecord({ status: "engaged" })]],
    ["malformed record id", [goodRecord({ friendshipId: "frd_x" })]],
    ["internal-id-shaped record id", [goodRecord({ friendshipId: "usr_meera" })]],
    ["self relationship", [goodRecord({ recipientAccountId: SEED_TEEN_ID })]],
    ["unknown requester", [goodRecord({ requesterAccountId: "usr_ghost" })]],
    ["parent as a party", [goodRecord({ recipientAccountId: "usr_priya" })]],
    ["duplicate record ids", [goodRecord(), goodRecord()]],
    ["two pending records for one pair", [goodRecord(), goodRecord({ friendshipId: "frd_record_two", requesterAccountId: SEED_PEER_ID, recipientAccountId: SEED_TEEN_ID })]],
    ["pending plus accepted for one pair", [goodRecord(), goodRecord({ friendshipId: "frd_record_two", status: "accepted", acceptedAt: LATER, updatedAt: LATER })]],
    ["two accepted records for one pair (A→B and B→A)", [
      goodRecord({ friendshipId: "frd_record_one", status: "accepted", acceptedAt: LATER, updatedAt: LATER }),
      goodRecord({ friendshipId: "frd_record_two", status: "accepted", acceptedAt: LATER, updatedAt: LATER, requesterAccountId: SEED_PEER_ID, recipientAccountId: SEED_TEEN_ID }),
    ]],
    ["pending with an acceptedAt", [goodRecord({ acceptedAt: LATER })]],
    ["pending with an endedAt", [goodRecord({ endedAt: LATER })]],
    ["accepted without acceptedAt", [goodRecord({ status: "accepted", updatedAt: LATER })]],
    ["accepted with an endedAt", [goodRecord({ status: "accepted", acceptedAt: LATER, endedAt: LATER, updatedAt: LATER })]],
    ["declined keeping acceptedAt", [goodRecord({ status: "declined", acceptedAt: LATER, endedAt: LATER, updatedAt: LATER })]],
    ["removed without ever being accepted", [goodRecord({ status: "removed", endedAt: LATER, updatedAt: LATER })]],
    ["removed before it was accepted", [goodRecord({ status: "removed", acceptedAt: LATER, endedAt: AT, updatedAt: LATER })]],
    ["updatedAt before createdAt", [goodRecord({ updatedAt: "2026-09-26T00:00:00.000Z" })]],
    ["not-an-iso timestamp", [goodRecord({ createdAt: "yesterday" })]],
    ["not a list", { one: goodRecord() }],
  ];
  it.each(bad)("%s", (_label, records) => {
    expect(isSandboxDatabase(withRecords(records))).toBe(false);
  });

  it("rejects more than FRIEND_LIMIT accepted friends for one teen", () => {
    const records: Friendship[] = [];
    const accounts = [...buildSeedDatabase().accounts];
    for (let i = 0; i < 51; i += 1) {
      const id = `usr_friend_${i}`;
      accounts.push({
        id,
        role: "teen",
        identifier: `sandbox:friend${i}`,
        name: `Friend ${i}`,
        displayName: `Friend ${i}`,
        username: `friend${i}`,
        avatarInitials: "F",
        status: "active",
        identitySource: "sandbox",
        createdAt: AT,
        updatedAt: AT,
      });
      records.push(goodRecord({
        friendshipId: `frd_bulk_${i}_xxxx`,
        recipientAccountId: id,
        status: "accepted",
        acceptedAt: LATER,
        updatedAt: LATER,
      }));
    }
    expect(isSandboxDatabase({ ...buildSeedDatabase(), accounts, friendships: records })).toBe(false);
  });
});

describe("save → load (reload)", () => {
  it("friendships survive a reload exactly", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    const db = withFriendships();
    expect(repo.save(db)).toBe(true);
    const { db: loaded, outcome } = repo.load(NOW);
    expect(outcome.kind).toBe("loaded");
    expect(loaded.friendships).toEqual(db.friendships);
    expect(friendCircleFor(loaded, SEED_TEEN_ID)).toMatchObject({
      ok: true,
      value: { friends: [{ handle: "@meera" }] },
    });
  });

  it("corrupt stored friendships recover: backup kept, fresh seed, no crash", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    const corrupt = withRecords([goodRecord({ balance: 1000 })]);
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(corrupt));
    const { db, outcome } = repo.load(NOW);
    expect(outcome.kind).toBe("recovered");
    expect(db.friendships).toBeUndefined();
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toContain("balance");
  });

  it("garbage bytes recover the same way", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    storage.setItem(SANDBOX_STORAGE_KEY, "{not json");
    const { outcome } = repo.load(NOW);
    expect(outcome.kind).toBe("recovered");
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe("{not json");
  });
});

describe("reset", () => {
  it("Reset clears friendships and the backup", () => {
    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(withFriendships());
    const seed = repo.reset();
    expect(seed.friendships).toBeUndefined();
    expect(storage.getItem(SANDBOX_STORAGE_KEY)).toBeNull();
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBeNull();
  });
});

describe("lifecycle integrity through storage", () => {
  it("decline and removal round-trip with their history fields", () => {
    let db = buildSeedDatabase();
    const sent = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_round_one" });
    if (!sent.result.ok) throw new Error(sent.result.error.message);
    db = declineFriendRequestTransition(sent.db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: sent.result.value.friendshipId }).db;
    expect(isSandboxDatabase(clone(db))).toBe(true);

    const second = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", requestId: "frd_round_two" });
    if (!second.result.ok) throw new Error(second.result.error.message);
    db = acceptFriendRequestTransition(second.db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: second.result.value.friendshipId }).db;
    db = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: NOW, teenPayId: "@meera" }).db;
    expect(isSandboxDatabase(clone(db))).toBe(true);

    const storage = memoryStorage();
    const repo = createLocalRepository(() => storage);
    repo.save(db);
    const { db: loaded, outcome } = repo.load(NOW);
    expect(outcome.kind).toBe("loaded");
    expect(loaded.friendships!.map((f) => f.status)).toEqual(["declined", "removed"]);
    expect(loaded.friendships![1]!).toMatchObject({ acceptedAt: LATER, endedAt: NOW });
  });
});
