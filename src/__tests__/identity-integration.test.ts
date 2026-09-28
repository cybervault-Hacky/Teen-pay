import { describe, expect, it } from "vitest";
import { createAccount } from "@/sandbox/accounts";
import { addContactTransition, removeContactTransition, selectContactViews } from "@/sandbox/contacts";
import { walletBalance } from "@/sandbox/engine";
import {
  acceptFriendRequestTransition,
  friendCircleFor,
  sendFriendRequestTransition,
} from "@/sandbox/friends";
import {
  acceptMoneyRequestTransition,
  createMoneyRequestTransition,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { primaryWalletId } from "@/domain";
import { qrIdentityFor } from "@/sandbox/qr";
import { changeTeenPayIdTransition, identityProfileFor } from "@/sandbox/teenpay-id";
import { SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT, linkedDatabase } from "./helpers/fixtures";

/**
 * TeenPay ID integration (Phase 13): changing an ID is an alias
 * change. Money flows, guardian rules, favourites, Friend Circles,
 * request lifecycles and QR all keep working — resolved through the
 * stable account id — and a freed ID never inherits its previous
 * owner's money or relationships.
 */

const LATER = "2026-09-26T09:00:00Z";
const EVEN_LATER = "2026-09-27T06:00:00Z";

function changed(rules?: { threshold?: number | null; daily?: number | null }): SandboxDatabase {
  const db = linkedDatabase(
    rules ? { threshold: rules.threshold ?? null, daily: rules.daily ?? null } : undefined,
  );
  return changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "rohan" }).db;
}

describe("money flows resolve the changed ID", () => {
  it("sending to the new ID reaches the same account", () => {
    const db = changed();
    const meeraBefore = walletBalance(db.ledger, primaryWalletId(SEED_PEER_ID));
    const outcome = sendMoneyTransition(db, {
      actorId: SEED_PEER_ID,
      at: LATER,
      recipient: "@rohan",
      amount: 100,
      idempotencyKey: "snd_id_after_change",
    });
    expect(outcome.result).toMatchObject({ ok: true, value: { status: "completed" } });
    expect(walletBalance(outcome.db.ledger, primaryWalletId(SEED_PEER_ID))).toBe(meeraBefore - 100);
    expect(walletBalance(outcome.db.ledger, primaryWalletId(SEED_TEEN_ID))).toBe(1850 + 100);
  });

  it("the old ID stops resolving — nobody inherits it mid-flight", () => {
    const db = changed();
    expect(
      sendMoneyTransition(db, {
        actorId: SEED_PEER_ID,
        at: LATER,
        recipient: "@aarav",
        amount: 100,
        idempotencyKey: "snd_id_old_handle",
      }).result,
    ).toMatchObject({ ok: false, error: { code: "unknown_recipient" } });
  });

  it("a new account claiming the freed ID gets no old money or friendships", () => {
    let db = changed();
    const created = createAccount(db, { role: "teen", displayName: "New Aarav", username: "aarav" }, LATER);
    if (!("account" in created)) throw new Error("create failed");
    db = created.db;
    const newcomer = created.account.id;

    // Payments to @aarav now go to the newcomer — not the old owner.
    const outcome = sendMoneyTransition(db, {
      actorId: SEED_PEER_ID,
      at: LATER,
      recipient: "@aarav",
      amount: 40,
      idempotencyKey: "snd_id_hijack_check",
    });
    expect(outcome.result).toMatchObject({ ok: true, value: { status: "completed" } });
    expect(walletBalance(outcome.db.ledger, primaryWalletId(newcomer))).toBe(40);
    expect(walletBalance(outcome.db.ledger, primaryWalletId(SEED_TEEN_ID))).toBe(1850);

    // The newcomer has no Friend Circle history.
    const circle = friendCircleFor(db, newcomer);
    expect(circle.ok && circle.value.friends).toEqual([]);
  });

  it("guardian rules bind exactly as before after a change", () => {
    // Threshold ₹50: ₹100 waits for Priya.
    const withThreshold = changed({ threshold: 50 });
    expect(
      sendMoneyTransition(withThreshold, {
        actorId: SEED_TEEN_ID,
        at: LATER,
        recipient: "@meera",
        amount: 100,
        idempotencyKey: "snd_id_threshold",
      }).result,
    ).toMatchObject({ ok: true, value: { status: "approval_requested" } });

    // Daily limit ₹200: ₹300 exceeds it.
    const withDaily = changed({ daily: 200 });
    expect(
      sendMoneyTransition(withDaily, {
        actorId: SEED_TEEN_ID,
        at: LATER,
        recipient: "@meera",
        amount: 300,
        idempotencyKey: "snd_id_daily",
      }).result,
    ).toMatchObject({ ok: false, error: { code: "exceeds_daily_limit" } });
  });

  it("insufficient balance still binds after a change", () => {
    const db = changed();
    expect(
      sendMoneyTransition(db, {
        actorId: SEED_TEEN_ID,
        at: LATER,
        recipient: "@meera",
        amount: 9999,
        idempotencyKey: "snd_id_balance",
      }).result,
    ).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
  });

  it("send idempotency keys survive the change", () => {
    const db = changed();
    const first = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      recipient: "@meera",
      amount: 60,
      idempotencyKey: "snd_id_replay",
    });
    expect(first.result).toMatchObject({ ok: true, value: { status: "completed" } });
    const replay = sendMoneyTransition(first.db, {
      actorId: SEED_TEEN_ID,
      at: EVEN_LATER,
      recipient: "@meera",
      amount: 60,
      idempotencyKey: "snd_id_replay",
    });
    expect(replay.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(replay.db.ledger.length).toBe(first.db.ledger.length);
  });
});

describe("money requests survive the change by account id", () => {
  it("a request made under the old ID is paid to the renamed account", () => {
    let db = linkedDatabase();
    // Aarav requests ₹60 from Meera while still @aarav.
    const requested = createMoneyRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      payer: "@meera",
      amount: 60,
      note: "chai",
      idempotencyKey: "prq_id_before_change",
    });
    if (!requested.result.ok) throw new Error("request failed");
    const requestedId = requested.result.value.requestId;
    db = changeTeenPayIdTransition(requested.db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "rohan" }).db;

    // The snapshot keeps the historical handle; the account id moves the money.
    const record = db.peerRequests.find((r) => r.requestId === requestedId);
    expect(record).toMatchObject({ requesterAccountId: SEED_TEEN_ID, requesterHandle: "@aarav" });

    const paid = acceptMoneyRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: EVEN_LATER,
      requestId: record!.requestId,
    });
    expect(paid.result).toMatchObject({ ok: true });
    expect(walletBalance(paid.db.ledger, primaryWalletId(SEED_TEEN_ID))).toBe(1850 + 60);
  });

  it("requesting through the new ID works, lifecycle intact", () => {
    const db = changed();
    const requested = createMoneyRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      payer: "@meera",
      amount: 30,
      idempotencyKey: "prq_id_after_change",
    });
    if (!requested.result.ok) throw new Error("request failed");
    expect(requested.result.value).toMatchObject({ amount: 30, replayed: false });
    const paid = acceptMoneyRequestTransition(requested.db, {
      actorId: SEED_PEER_ID,
      at: EVEN_LATER,
      requestId: requested.result.value.requestId,
    });
    expect(paid.result.ok).toBe(true);
    expect(walletBalance(paid.db.ledger, primaryWalletId(SEED_TEEN_ID))).toBe(1850 + 30);
  });
});

describe("favourites and Friend Circles keep their meaning", () => {
  it("a favourite saved under the old handle degrades gracefully, then re-adds", () => {
    let db = linkedDatabase();
    db = addContactTransition(db, {
      actorId: SEED_PEER_ID,
      at: AT,
      teenPayId: "@aarav",
      contactId: "ctc_id_old",
    }).db;
    db = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "rohan" }).db;

    // The stored favourite now points at nobody — shown as unavailable,
    // never silently re-pointed at the renamed account.
    const views = selectContactViews(db, SEED_PEER_ID);
    const stale = views.find((c) => c.handle === "@aarav");
    expect(stale).toMatchObject({ available: false });

    // Removing the stale entry and adding the new handle both work.
    db = removeContactTransition(db, { actorId: SEED_PEER_ID, at: EVEN_LATER, teenPayId: "@aarav" }).db;
    const added = addContactTransition(db, {
      actorId: SEED_PEER_ID,
      at: EVEN_LATER,
      teenPayId: "@rohan",
      contactId: "ctc_id_new",
    });
    expect(added.result).toMatchObject({ ok: true });
    const fresh = selectContactViews(added.db, SEED_PEER_ID);
    expect(fresh.map((c) => c.handle)).toEqual(["@rohan"]);
  });

  it("Friend Circles follow the rename for everyone involved", () => {
    let db = linkedDatabase();
    const sent = sendFriendRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      teenPayId: "@meera",
      requestId: "frd_id_rename",
    });
    if (!sent.result.ok) throw new Error("send failed");
    db = acceptFriendRequestTransition(sent.db, {
      actorId: SEED_PEER_ID,
      at: LATER,
      friendshipId: sent.result.value.friendshipId,
    }).db;
    db = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: EVEN_LATER, teenPayId: "rohan" }).db;

    const meeraCircle = friendCircleFor(db, SEED_PEER_ID);
    expect(meeraCircle.ok && meeraCircle.value.friends.map((f) => f.handle)).toEqual(["@rohan"]);
    const aaravCircle = friendCircleFor(db, SEED_TEEN_ID);
    expect(aaravCircle.ok && aaravCircle.value.friends.map((f) => f.handle)).toEqual(["@meera"]);

    // Both sides can still act through the circle.
    expect(identityProfileFor(db, SEED_PEER_ID, "@rohan")).toMatchObject({
      ok: true,
      value: { relation: { kind: "friends" } },
    });
  });
});

describe("QR follows the alias", () => {
  it("regenerates with the new handle and stays identity-only", () => {
    const db = changed();
    const qr = qrIdentityFor(db, SEED_TEEN_ID);
    expect(qr).toMatchObject({
      ok: true,
      value: { payload: "teenpay://user/@rohan?v=1", profile: { handle: "@rohan" } },
    });
  });
});
