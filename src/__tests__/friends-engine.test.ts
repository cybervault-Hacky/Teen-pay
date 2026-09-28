import { describe, expect, it } from "vitest";
import { createAccount } from "@/sandbox/accounts";
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
 * Friend Circle engine (Phase 12): the request lifecycle, the pair
 * uniqueness rules, idempotency, account isolation — and the rule
 * that a friendship never touches money.
 */

const AT = "2026-09-26T06:00:00Z";
const LATER = "2026-09-26T09:00:00Z";

function freshDb(): SandboxDatabase {
  return buildSeedDatabase();
}

function mustSend(db: SandboxDatabase, actorId: string, teenPayId: string, requestId = "frd_engine_one") {
  const out = sendFriendRequestTransition(db, { actorId, at: AT, teenPayId, requestId });
  if (!out.result.ok) throw new Error(`send failed: ${JSON.stringify(out.result)}`);
  return out;
}

function notices(db: SandboxDatabase, to: string, title: string) {
  return db.notifications.filter((n) => n.recipientId === to && n.title === title);
}

/** Everything a friendship must never touch. */
function moneyFingerprint(db: SandboxDatabase) {
  return JSON.stringify({
    ledger: db.ledger,
    operations: db.operations,
    wallets: db.wallets,
    spaces: db.spaces,
    peerRequests: db.peerRequests,
    contacts: db.contacts,
    schedules: db.pocketMoneySchedules,
    teenRecords: db.teenRecords,
  });
}

describe("Friend engine — sending requests", () => {
  it("creates one pending record and tells only the recipient", () => {
    const db = freshDb();
    const out = mustSend(db, SEED_TEEN_ID, "@meera");
    expect(out.result).toMatchObject({ ok: true, value: { replayed: false, recipient: { handle: "@meera" } } });
    expect(out.db.friendships).toHaveLength(1);
    expect(out.db.friendships![0]).toMatchObject({
      requesterAccountId: SEED_TEEN_ID,
      recipientAccountId: SEED_PEER_ID,
      status: "pending",
      createdAt: AT,
      updatedAt: AT,
    });
    expect(notices(out.db, SEED_PEER_ID, "New friend request")).toHaveLength(1);
    expect(notices(out.db, SEED_PEER_ID, "New friend request")[0]!.body).toBe("@aarav wants to join your Friend Circle.");
    expect(notices(out.db, SEED_TEEN_ID, "New friend request")).toHaveLength(0);
  });

  it("accepts the ID with or without @ and with the sandbox: prefix", () => {
    for (const raw of ["meera", "@meera", "sandbox:meera", " MEERA "]) {
      const out = sendFriendRequestTransition(freshDb(), { actorId: SEED_TEEN_ID, at: AT, teenPayId: raw, requestId: "frd_parse_case" });
      expect(out.result.ok, raw).toBe(true);
    }
  });

  it("refuses malformed, internal-id-shaped and empty input", () => {
    for (const raw of ["", "  ", "m", "usr_meera", "frd_abc123", "wal_x", "@meera!", "a".repeat(41)]) {
      const db = freshDb();
      const out = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: raw, requestId: "frd_bad_input" });
      expect(out.result.ok, raw).toBe(false);
      if (!out.result.ok) expect(out.result.error.message).toBe("Enter a TeenPay ID like @meera.");
      expect(out.db).toBe(db); // nothing written
    }
  });

  it("refuses self, unknown users, parents and closed accounts alike or as self", () => {
    const self = sendFriendRequestTransition(freshDb(), { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@aarav", requestId: "frd_self_case" });
    expect(self.result).toMatchObject({ ok: false, error: { code: "self_friend" } });

    const unknown = sendFriendRequestTransition(freshDb(), { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@nobody", requestId: "frd_unknown1" });
    expect(unknown.result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });

    const parent = sendFriendRequestTransition(freshDb(), { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@priya", requestId: "frd_parent_x" });
    expect(parent.result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });

    const closed: SandboxDatabase = {
      ...freshDb(),
      accounts: freshDb().accounts.map((a) => (a.id === SEED_PEER_ID ? { ...a, status: "closed" } : a)),
    };
    const gone = sendFriendRequestTransition(closed, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_closed_x" });
    expect(gone.result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    for (const [out, input] of [
      [self, freshDb()],
      [unknown, freshDb()],
      [parent, freshDb()],
      [gone, closed],
    ] as const) {
      expect(out.db.friendships ?? []).toEqual(input.friendships ?? []);
    }
  });

  it("refuses a malformed request id and never writes", () => {
    const before = freshDb();
    for (const requestId of ["", "nope", "ctc_123456", "frd_short"]) {
      const out = sendFriendRequestTransition(before, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId });
      expect(out.result.ok).toBe(false);
      expect(out.db).toBe(before);
    }
  });
});

describe("Friend engine — duplicates and pair rules", () => {
  it("is idempotent: same action key replays, repeated sends create nothing new", () => {
    const db = freshDb();
    const first = mustSend(db, SEED_TEEN_ID, "@meera");
    const replay = sendFriendRequestTransition(first.db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", requestId: "frd_engine_one" });
    expect(replay.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(replay.db.friendships).toEqual(first.db.friendships);

    // A second click with a fresh key: still one record, answered as pending.
    const again = sendFriendRequestTransition(first.db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", requestId: "frd_engine_two" });
    expect(again.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(again.db.friendships).toHaveLength(1);
  });

  it("a reverse request while one is pending says: respond to theirs", () => {
    const db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const reverse = sendFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav", requestId: "frd_reverse1" });
    expect(reverse.result).toMatchObject({ ok: false, error: { code: "friend_request_pending" } });
    expect(reverse.db.friendships).toHaveLength(1);
  });

  it("never allows two open records for a pair, in either direction", () => {
    const db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const accepted = acceptFriendRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: LATER,
      friendshipId: db.friendships![0]!.friendshipId,
    });
    expect(accepted.result.ok).toBe(true);
    const duplicate = sendFriendRequestTransition(accepted.db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav", requestId: "frd_dup_pair" });
    expect(duplicate.result).toMatchObject({ ok: false, error: { code: "friend_exists" } });
    expect(duplicate.db.friendships!.filter((f) => f.status === "accepted")).toHaveLength(1);
  });

  it("after a decline, a fresh request starts a fresh record", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const declined = declineFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId });
    expect(declined.result).toMatchObject({ ok: true, value: { status: "declined" } });
    db = declined.db;
    const fresh = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", requestId: "frd_second_x" });
    expect(fresh.result).toMatchObject({ ok: true, value: { replayed: false } });
    expect(fresh.db.friendships).toHaveLength(2);
    expect(fresh.db.friendships!.map((f) => f.status).sort()).toEqual(["declined", "pending"]);
  });
});

describe("Friend engine — accept, decline, cancel, remove", () => {
  it("accept: the recipient only; both are friends; the requester hears it once", () => {
    const db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;

    const byRequester = acceptFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: id });
    expect(byRequester.result).toMatchObject({ ok: false, error: { code: "unknown_friendship" } });

    const accepted = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id });
    expect(accepted.result).toMatchObject({ ok: true, value: { status: "accepted", replayed: false, friend: { handle: "@aarav" } } });
    expect(accepted.db.friendships![0]).toMatchObject({ status: "accepted", acceptedAt: LATER, updatedAt: LATER });
    expect(notices(accepted.db, SEED_TEEN_ID, "Friend request accepted")).toHaveLength(1);
    expect(notices(accepted.db, SEED_PEER_ID, "Friend request accepted")).toHaveLength(0);

    // A double accept is a safe replay.
    const replay = acceptFriendRequestTransition(accepted.db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id });
    expect(replay.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(replay.db.friendships).toEqual(accepted.db.friendships);
    expect(notices(replay.db, SEED_TEEN_ID, "Friend request accepted")).toHaveLength(1);
  });

  it("accept re-checks the requester: a closed account can't be accepted", () => {
    const db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const closed: SandboxDatabase = {
      ...db,
      accounts: db.accounts.map((a) => (a.id === SEED_TEEN_ID ? { ...a, status: "closed" } : a)),
    };
    const out = acceptFriendRequestTransition(closed, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId });
    expect(out.result).toMatchObject({ ok: false, error: { message: "This friend request can't be accepted any more." } });
    expect(out.db.friendships![0]!.status).toBe("pending");
  });

  it("decline: the recipient only, idempotent, quiet", () => {
    const db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;

    const byRequester = declineFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: id });
    expect(byRequester.result).toMatchObject({ ok: false, error: { code: "unknown_friendship" } });

    const declined = declineFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id });
    expect(declined.result).toMatchObject({ ok: true, value: { status: "declined" } });
    expect(declined.db.friendships![0]).toMatchObject({ status: "declined", endedAt: LATER, updatedAt: LATER });
    expect(declined.db.notifications).toEqual(db.notifications); // quiet
    const replay = declineFriendRequestTransition(declined.db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id });
    expect(replay.result).toMatchObject({ ok: true, value: { status: "declined" } });
  });

  it("declining an accepted request is an invalid transition", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).db;
    const declined = declineFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id });
    expect(declined.result).toMatchObject({ ok: false, error: { code: "invalid_transition" } });
  });

  it("cancel: the requester only, idempotent, quiet", () => {
    const db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;

    const byRecipient = cancelFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id });
    expect(byRecipient.result).toMatchObject({ ok: false, error: { code: "unknown_friendship" } });

    const cancelled = cancelFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: id });
    expect(cancelled.result).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(cancelled.db.friendships![0]).toMatchObject({ status: "cancelled", endedAt: LATER });
    expect(cancelled.db.notifications).toEqual(db.notifications);

    // After a cancel the pair is open again.
    const fresh = sendFriendRequestTransition(cancelled.db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav", requestId: "frd_after_can" });
    expect(fresh.result.ok).toBe(true);
  });

  it("cancelling an accepted friendship is refused", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).db;
    const cancelled = cancelFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: id });
    expect(cancelled.result).toMatchObject({ ok: false, error: { code: "invalid_transition" } });
  });

  it("remove: either friend can, idempotently, and the pair can reconnect later", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).db;

    const byRecipient = removeFriendTransition(db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav" });
    expect(byRecipient.result).toMatchObject({ ok: true, value: { removed: "@aarav" } });
    expect(byRecipient.db.friendships![0]).toMatchObject({ status: "removed", endedAt: LATER, acceptedAt: LATER });
    expect(byRecipient.db.notifications).toEqual(db.notifications); // quiet

    // Removing again changes nothing.
    const replay = removeFriendTransition(byRecipient.db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav" });
    expect(replay.result).toMatchObject({ ok: true, value: { removed: "@aarav" } });

    // A removed friendship doesn't block a new request.
    const fresh = sendFriendRequestTransition(byRecipient.db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", requestId: "frd_reconnect" });
    expect(fresh.result).toMatchObject({ ok: true, value: { replayed: false } });
  });

  it("the requester can remove too", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).db;
    const out = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera" });
    expect(out.result).toMatchObject({ ok: true, value: { removed: "@meera" } });
  });

  it("removing someone who isn't a friend is refused", () => {
    const db = freshDb();
    const out = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera" });
    expect(out.result).toMatchObject({ ok: false, error: { code: "not_friends" } });
    const self = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@aarav" });
    expect(self.result).toMatchObject({ ok: false, error: { code: "not_friends" } });
  });

  it("timestamps never move backwards", () => {
    const db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    const id = db.friendships![0]!.friendshipId;
    const early = "2026-09-25T00:00:00Z"; // before the request
    const declined = declineFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: early, friendshipId: id });
    expect(declined.result.ok).toBe(true);
    expect(declined.db.friendships![0]!.updatedAt).toBe(AT);
  });
});

describe("Friend engine — account isolation", () => {
  function thirdTeen(db: SandboxDatabase): SandboxDatabase {
    const created = createAccount(db, { role: "teen", displayName: "Kabir Mehta", username: "kabir" }, AT);
    if ("code" in created) throw new Error("setup failed");
    return created.db;
  }

  it("a third teen can't read, decide or break someone else's request", () => {
    const db = thirdTeen(mustSend(freshDb(), SEED_TEEN_ID, "@meera").db);
    const kabir = db.accounts.find((a) => a.username === "kabir")!.id;
    const id = db.friendships![0]!.friendshipId;

    for (const action of [
      () => acceptFriendRequestTransition(db, { actorId: kabir, at: LATER, friendshipId: id }),
      () => declineFriendRequestTransition(db, { actorId: kabir, at: LATER, friendshipId: id }),
      () => cancelFriendRequestTransition(db, { actorId: kabir, at: LATER, friendshipId: id }),
    ]) {
      expect(action().result).toMatchObject({ ok: false, error: { code: "unknown_friendship" } });
    }
    const remove = removeFriendTransition(db, { actorId: kabir, at: LATER, teenPayId: "@meera" });
    expect(remove.result).toMatchObject({ ok: false, error: { code: "not_friends" } });

    // Kabir's circle stays empty; Aarav's and Meera's are untouched.
    expect(friendCircleFor(db, kabir)).toMatchObject({ ok: true, value: { friends: [], incoming: [], outgoing: [] } });
    expect(friendCircleFor(db, SEED_TEEN_ID)).toMatchObject({ ok: true, value: { outgoing: [{ handle: "@meera" }] } });
  });

  it("a third teen can still build their own circle in parallel", () => {
    const db = thirdTeen(mustSend(freshDb(), SEED_TEEN_ID, "@meera").db);
    const kabir = db.accounts.find((a) => a.username === "kabir")!.id;
    const own = sendFriendRequestTransition(db, { actorId: kabir, at: LATER, teenPayId: "@meera", requestId: "frd_kabir_x" });
    expect(own.result.ok).toBe(true);
    // One open record per pair: Aarav~Meera pending, Kabir~Meera pending — different pairs.
    expect(own.db.friendships).toHaveLength(2);
  });
});

describe("Friend engine — no money side effects", () => {
  it("no friend action ever touches money data", () => {
    let db = freshDb();
    const fingerprint = moneyFingerprint(db);

    db = mustSend(db, SEED_TEEN_ID, "@meera").db;
    expect(moneyFingerprint(db)).toBe(fingerprint);

    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId }).db;
    expect(moneyFingerprint(db)).toBe(fingerprint);

    db = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera" }).db;
    expect(moneyFingerprint(db)).toBe(fingerprint);

    db = sendFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@aarav", requestId: "frd_money_x" }).db;
    db = declineFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: db.friendships![1]!.friendshipId }).db;
    expect(moneyFingerprint(db)).toBe(fingerprint);

    db = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", requestId: "frd_money_y" }).db;
    db = cancelFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: db.friendships![2]!.friendshipId }).db;
    expect(moneyFingerprint(db)).toBe(fingerprint);
  });
});

describe("Friend engine — the circle and safe lookups", () => {
  it("friendCircleFor splits friends, incoming and outgoing", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    expect(friendCircleFor(db, SEED_TEEN_ID)).toMatchObject({
      ok: true,
      value: { friends: [], incoming: [], outgoing: [{ handle: "@meera", name: "Meera Kapoor" }] },
    });
    expect(friendCircleFor(db, SEED_PEER_ID)).toMatchObject({
      ok: true,
      value: { friends: [], incoming: [{ handle: "@aarav" }], outgoing: [] },
    });

    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId }).db;
    expect(friendCircleFor(db, SEED_TEEN_ID)).toMatchObject({
      ok: true,
      value: { friends: [{ handle: "@meera", friendsSince: LATER }], incoming: [], outgoing: [] },
    });
    expect(friendCircleFor(db, SEED_PEER_ID)).toMatchObject({
      ok: true,
      value: { friends: [{ handle: "@aarav" }] },
    });
  });

  it("friendLookup: self is neutral, eligible peers carry their relation, others are not found", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;

    expect(friendLookup(db, SEED_TEEN_ID, "@aarav")).toMatchObject({ ok: true, value: { kind: "self" } });
    expect(friendLookup(db, SEED_TEEN_ID, "@meera")).toMatchObject({
      ok: true,
      value: { kind: "peer", profile: { handle: "@meera" }, relation: { kind: "request_sent" } },
    });
    expect(friendLookup(db, SEED_PEER_ID, "@aarav")).toMatchObject({
      ok: true,
      value: { relation: { kind: "request_received" } },
    });
    expect(friendLookup(db, SEED_TEEN_ID, "@priya")).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    expect(friendLookup(db, SEED_TEEN_ID, "@ghost")).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    expect(friendLookup(db, SEED_TEEN_ID, "usr_meera")).toMatchObject({ ok: false });

    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId }).db;
    expect(friendLookup(db, SEED_TEEN_ID, "@meera")).toMatchObject({
      ok: true,
      value: { relation: { kind: "friends" } },
    });
  });

  it("a friend who closed their account shows as unavailable, not as a crash", () => {
    let db = mustSend(freshDb(), SEED_TEEN_ID, "@meera").db;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: db.friendships![0]!.friendshipId }).db;
    const closed: SandboxDatabase = {
      ...db,
      accounts: db.accounts.map((a) => (a.id === SEED_PEER_ID ? { ...a, status: "closed" } : a)),
    };
    const circle = friendCircleFor(closed, SEED_TEEN_ID);
    expect(circle).toMatchObject({ ok: true, value: { friends: [{ handle: "@meera", available: false }] } });
  });

  it("caps the circle at FRIEND_LIMIT", () => {
    let db = freshDb();
    // Build 50 accepted friendships with freshly created teens.
    for (let i = 0; i < 50; i += 1) {
      const created = createAccount(db, { role: "teen", displayName: `Friend ${i}`, username: `friend${i}` }, AT);
      if ("code" in created) throw new Error("setup failed");
      db = created.db;
      const other = created.account;
      const sent = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: other.username, requestId: `frd_bulk_${i}_xx` });
      if (!sent.result.ok) throw new Error(`bulk send failed: ${sent.result.error.message}`);
      const accepted = acceptFriendRequestTransition(sent.db, { actorId: other.id, at: AT, friendshipId: sent.result.value.friendshipId });
      if (!accepted.result.ok) throw new Error("bulk accept failed");
      db = accepted.db;
    }
    expect(friendCircleFor(db, SEED_TEEN_ID).ok && (friendCircleFor(db, SEED_TEEN_ID) as { ok: true; value: { friends: unknown[] } }).value.friends).toHaveLength(50);

    const oneMore = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", requestId: "frd_bulk_over" });
    expect(oneMore.result).toMatchObject({ ok: false, error: { code: "friend_limit_reached" } });
  });
});
