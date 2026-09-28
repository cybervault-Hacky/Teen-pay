import { describe, expect, it } from "vitest";
import { addContactTransition, selectContactViews } from "@/sandbox/contacts";
import {
  acceptFriendRequestTransition,
  removeFriendTransition,
  sendFriendRequestTransition,
} from "@/sandbox/friends";
import {
  createMoneyRequestTransition,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { qrIdentityFor } from "@/sandbox/qr";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { linkedDatabase, AT } from "./helpers/fixtures";

/**
 * Friend Circle integration (Phase 12): friendship only *selects* a
 * trusted peer — Send Money, Request Money, favourites and QR all
 * stay exactly the systems they were, and friendship never bypasses
 * a payment rule.
 */

const LATER = "2026-09-26T09:00:00Z";

function withFriend(rules?: { threshold?: number | null; daily?: number | null }): SandboxDatabase {
  let db = linkedDatabase(rules ? { threshold: rules.threshold ?? null, daily: rules.daily ?? null } : undefined);
  const sent = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_integ_one" });
  if (!sent.result.ok) throw new Error(sent.result.error.message);
  db = acceptFriendRequestTransition(sent.db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: sent.result.value.friendshipId }).db;
  return db;
}

describe("Send Money through a friend uses the existing engine", () => {
  it("moves money through sendMoneyTransition, once, with idempotency", () => {
    const db = withFriend();
    const outcome = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      recipient: "@meera",
      amount: 100,
      idempotencyKey: "snd_friend_case",
    });
    expect(outcome.result).toMatchObject({ ok: true, value: { status: "completed", amount: 100 } });
    const replay = sendMoneyTransition(outcome.db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      recipient: "@meera",
      amount: 100,
      idempotencyKey: "snd_friend_case",
    });
    expect(replay.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(replay.db.ledger.length - db.ledger.length).toBe(2); // one transfer, two legs
  });

  it("guardian rules still bind between friends", () => {
    // Approval threshold: ₹100 is above ₹50, so it waits for Priya.
    const db = withFriend({ threshold: 50 });
    const outcome = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      recipient: "@meera",
      amount: 100,
      idempotencyKey: "snd_friend_apr",
    });
    expect(outcome.result).toMatchObject({ ok: true, value: { status: "approval_requested" } });
    expect(outcome.db.ledger.length).toBe(db.ledger.length); // nothing moved

    // Daily limit: ₹200/day refuses ₹300 even to a friend.
    const strict = withFriend({ daily: 200 });
    const refused = sendMoneyTransition(strict, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      recipient: "@meera",
      amount: 300,
      idempotencyKey: "snd_friend_lim",
    });
    expect(refused.result).toMatchObject({ ok: false, error: { code: "exceeds_daily_limit" } });
    expect(refused.db.ledger.length).toBe(strict.ledger.length);
  });

  it("available balance still binds between friends", () => {
    const db = withFriend();
    const outcome = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      recipient: "@meera",
      amount: 9999,
      idempotencyKey: "snd_friend_bal",
    });
    expect(outcome.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
  });
});

describe("Request Money through a friend uses the existing engine", () => {
  it("creates a standard peer request with the 7-day expiry", () => {
    const db = withFriend();
    const outcome = createMoneyRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      payer: "@meera",
      amount: 60,
      note: "Snacks",
      idempotencyKey: "prq_friend_case",
    });
    expect(outcome.result).toMatchObject({ ok: true, value: { amount: 60 } });
    expect(outcome.db.peerRequests).toHaveLength(1);
    expect(outcome.db.peerRequests[0]).toMatchObject({ amount: 60, note: "Snacks", status: "pending" });
    // Friendship records and money requests stay separate collections.
    expect(outcome.db.friendships).toHaveLength(1);
  });
});

describe("Favourites stay independent of friendships", () => {
  it("a friend is not automatically a favourite, and removing one keeps the other", () => {
    let db = withFriend();
    expect(selectContactViews(db, SEED_TEEN_ID)).toHaveLength(0);

    const fav = addContactTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera", contactId: "ctc_integ_one" });
    expect(fav.result.ok).toBe(true);
    db = fav.db;
    expect(selectContactViews(db, SEED_TEEN_ID)).toHaveLength(1);

    db = removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera" }).db;
    // The favourite survives the friendship.
    expect(selectContactViews(db, SEED_TEEN_ID)).toHaveLength(1);
    expect(db.friendships![0]).toMatchObject({ status: "removed" });
  });
});

describe("QR stays identity-only", () => {
  it("the payload format is unchanged and carries no friendship data", () => {
    const db = withFriend();
    const identity = qrIdentityFor(db, SEED_TEEN_ID);
    expect(identity).toMatchObject({ ok: true, value: { payload: "teenpay://user/@aarav?v=1" } });
    expect(JSON.stringify(identity)).not.toMatch(/frd_|friend/i);
  });

  it("parents still have no QR, friends or not", () => {
    expect(qrIdentityFor(withFriend(), SEED_PARENT_ID)).toMatchObject({ ok: false });
  });
});
