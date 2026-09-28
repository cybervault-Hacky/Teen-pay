import { describe, expect, it } from "vitest";
import { FRIENDSHIP_KEYS } from "@/domain";
import {
  acceptFriendRequestTransition,
  cancelFriendRequestTransition,
  declineFriendRequestTransition,
  friendCircleFor,
  friendLookup,
  removeFriendTransition,
  sendFriendRequestTransition,
} from "@/sandbox/friends";
import { buildSeedDatabase, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";

/**
 * Friend Circle privacy (Phase 12): friend-facing data exposes only
 * what the TeenPay directory already makes public — @handle, name,
 * initials — plus the viewer's own relationship state. Never the
 * other account's ids, wallet, balance, history, Spaces, pocket
 * money, guardian settings or notifications.
 */

const AT = "2026-09-26T06:00:00Z";
const LATER = "2026-09-26T09:00:00Z";

/** Everything a friend must never learn, as substrings. */
const PRIVATE_MARKERS = [
  SEED_PEER_ID, // the other teen's account id
  "wal_usr_meera",
  "fam_kapoor",
  "balance",
  "1200", // Meera's starting funds
  "guardian",
  "pocketMoney",
];

function assertPublicOnly(label: string, payload: unknown) {
  const text = JSON.stringify(payload);
  for (const marker of PRIVATE_MARKERS) {
    expect(text, `${label} leaks "${marker}"`).not.toContain(marker);
  }
  expect(text).not.toMatch(/usr_meera|walletId|accountId|ledger|spaces/i);
}

function withFriends(): SandboxDatabase {
  let db = buildSeedDatabase();
  const sent = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_privacy_a" });
  if (!sent.result.ok) throw new Error(sent.result.error.message);
  db = acceptFriendRequestTransition(sent.db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: sent.result.value.friendshipId }).db;
  return db;
}

describe("friend-facing views are public-profile-only", () => {
  it("the circle exposes handles, names, initials — nothing private", () => {
    const db = withFriends();
    const circle = friendCircleFor(db, SEED_TEEN_ID);
    if (!circle.ok) throw new Error("circle failed");
    assertPublicOnly("friend circle", circle.value);
    expect(circle.value.friends[0]).toEqual({
      handle: "@meera",
      name: "Meera Kapoor",
      initials: "MK",
      friendshipId: expect.stringMatching(/^frd_/),
      friendsSince: LATER,
      available: true,
    });
  });

  it("the safe lookup preview exposes no private data, in any relation state", () => {
    let db = buildSeedDatabase();
    assertPublicOnly("lookup none", friendLookup(db, SEED_TEEN_ID, "@meera"));
    db = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_privacy_b" }).db;
    assertPublicOnly("lookup pending", friendLookup(db, SEED_TEEN_ID, "@meera"));
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId }).db;
    assertPublicOnly("lookup friends", friendLookup(db, SEED_TEEN_ID, "@meera"));
    assertPublicOnly("lookup friends (other side)", friendLookup(db, SEED_PEER_ID, "@aarav"));
  });

  it("stored records hold only the documented fields", () => {
    const db = withFriends();
    for (const record of db.friendships ?? []) {
      expect(Object.keys(record).sort()).toEqual([...FRIENDSHIP_KEYS].filter((k) => record[k as keyof typeof record] !== undefined).sort());
      expect(JSON.stringify(record)).not.toMatch(/balan|wallet|amount|ledger/i);
    }
  });

  it("ineligible accounts all read the same — no existence leak", () => {
    const db = buildSeedDatabase();
    const closed: SandboxDatabase = {
      ...db,
      accounts: db.accounts.map((a) => (a.id === SEED_PEER_ID ? { ...a, status: "closed" } : a)),
    };
    const unknown = friendLookup(db, SEED_TEEN_ID, "@nobody");
    const parent = friendLookup(db, SEED_TEEN_ID, "@priya");
    const gone = friendLookup(closed, SEED_TEEN_ID, "@meera");
    for (const result of [unknown, parent, gone]) {
      expect(result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    }
  });
});

describe("notifications stay minimal and id-free", () => {
  it("only a request and an acceptance notify — and only with handles", () => {
    let db = buildSeedDatabase();
    const before = db.notifications.length;
    db = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_privacy_c" }).db;
    const id = db.friendships![0]!.friendshipId;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).db;
    db = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera" }).db;

    const fresh = db.notifications.slice(0, db.notifications.length - before);
    expect(fresh).toHaveLength(2); // request + acceptance; removal is quiet
    for (const n of fresh) {
      expect(`${n.title} ${n.body}`).not.toMatch(/usr_|wal_|fam_|frd_/);
    }

    // Decline and cancel add nothing.
    db = sendFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav", requestId: "frd_privacy_d" }).db;
    db = declineFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: db.friendships![1]!.friendshipId }).db;
    const count = db.notifications.length;
    db = sendFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav", requestId: "frd_privacy_e" }).db;
    db = cancelFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![2]!.friendshipId }).db;
    // Only the new request notified; the cancellation stayed quiet.
    expect(db.notifications.length).toBe(count + 1);
  });
});

describe("friend actions never move money", () => {
  it("the whole lifecycle leaves every financial collection byte-identical", () => {
    const seed = buildSeedDatabase();
    const moneyOf = (db: SandboxDatabase) =>
      JSON.stringify([db.ledger, db.operations, db.wallets, db.spaces, db.peerRequests, db.pocketMoneySchedules, db.teenRecords, db.recipients]);
    const before = moneyOf(seed);

    let db = sendFriendRequestTransition(seed, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_privacy_f" }).db;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId }).db;
    db = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera" }).db;
    expect(moneyOf(db)).toBe(before);
  });
});
