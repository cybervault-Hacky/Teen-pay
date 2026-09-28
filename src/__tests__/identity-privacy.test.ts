import { describe, expect, it } from "vitest";
import { addContactTransition } from "@/sandbox/contacts";
import {
  acceptFriendRequestTransition,
  friendLookup,
  sendFriendRequestTransition,
} from "@/sandbox/friends";
import { qrIdentityFor } from "@/sandbox/qr";
import {
  changeTeenPayIdTransition,
  checkTeenPayIdAvailability,
  identityProfileFor,
} from "@/sandbox/teenpay-id";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { AT } from "./helpers/fixtures";

/**
 * TeenPay ID privacy audit (Phase 13): the identity surface is a
 * projection, never an account dump. These tests pin the exact shape
 * that can leave the engine and prove parents get no identity powers.
 */

const LATER = "2026-09-26T09:00:00Z";

const PRIVATE_PATTERNS =
  /usr_|wal_|fam_|mem_|ledger|wallet|balance|₹|controls|guardian|security|notification|mission|coach/i;

describe("the public projection shape", () => {
  it("carries exactly the public fields — nothing more", () => {
    let db = buildSeedDatabase();
    db = sendFriendRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      teenPayId: "@meera",
      requestId: "frd_priv_identity",
    }).db;
    db = acceptFriendRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: LATER,
      friendshipId: db.friendships![0]!.friendshipId,
    }).db;
    db = addContactTransition(db, {
      actorId: SEED_TEEN_ID,
      at: LATER,
      teenPayId: "@meera",
      contactId: "ctc_priv_identity",
    }).db;

    const result = identityProfileFor(db, SEED_TEEN_ID, "@meera");
    if (!result.ok) throw new Error("expected ok");
    const value = result.value as unknown as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual(
      ["available", "favourite", "profile", "relation", "self"].sort(),
    );
    expect(Object.keys(value.profile as object).sort()).toEqual(["handle", "initials", "name"]);
    const relation = value.relation as Record<string, unknown>;
    // The relationship carries the friendship record id and a timestamp —
    // both belong to the viewer's own circle — and nothing else.
    expect(Object.keys(relation).sort()).toEqual(["friendsSince", "friendshipId", "kind"]);
  });

  it("never serializes private data for any seed account", () => {
    const db = buildSeedDatabase();
    for (const viewer of [SEED_TEEN_ID, SEED_PEER_ID]) {
      for (const raw of ["@aarav", "@meera", "@priya", "@nobody"]) {
        const result = identityProfileFor(db, viewer, raw);
        expect(JSON.stringify(result)).not.toMatch(PRIVATE_PATTERNS);
      }
    }
  });

  it("availability results stay faceless", () => {
    const db = buildSeedDatabase();
    for (const raw of ["@meera", "@priya", "admin", "ab", "rohan"]) {
      const result = checkTeenPayIdAvailability(db, SEED_TEEN_ID, raw);
      expect(JSON.stringify(result)).not.toMatch(/usr_|wal_|Kapoor|Sharma/i);
    }
    // An internal-id-shaped input is refused as reserved; the echoed
    // normalized form is the caller's own input, not a leak.
    expect(checkTeenPayIdAvailability(db, SEED_TEEN_ID, "usr_meera")).toMatchObject({
      ok: true,
      value: { status: "reserved" },
    });
  });
});

describe("identity isolation between accounts", () => {
  it("each viewer sees only public data, never the other's state", () => {
    let db = buildSeedDatabase();
    db = addContactTransition(db, {
      actorId: SEED_PEER_ID,
      at: AT,
      teenPayId: "@aarav",
      contactId: "ctc_priv_meera",
    }).db;
    // Meera favourites Aarav; Aarav's view of Meera must not show it.
    const aaravSees = identityProfileFor(db, SEED_TEEN_ID, "@meera");
    expect(aaravSees).toMatchObject({ ok: true, value: { favourite: false } });
    const meeraSees = identityProfileFor(db, SEED_PEER_ID, "@aarav");
    expect(meeraSees).toMatchObject({ ok: true, value: { favourite: true } });
  });

  it("identity lookup and Friend Circle lookup agree", () => {
    let db = buildSeedDatabase();
    db = sendFriendRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      teenPayId: "@meera",
      requestId: "frd_priv_agree",
    }).db;
    const identity = identityProfileFor(db, SEED_PEER_ID, "@aarav");
    const friend = friendLookup(db, SEED_PEER_ID, "@aarav");
    expect(identity).toMatchObject({ ok: true, value: { relation: { kind: "request_received" } } });
    expect(friend).toMatchObject({ ok: true, value: { relation: { kind: "request_received" } } });
  });
});

describe("parents have no identity powers", () => {
  it("lookup, availability and change are all refused", () => {
    const db = buildSeedDatabase();
    expect(identityProfileFor(db, SEED_PARENT_ID, "@meera")).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
    expect(checkTeenPayIdAvailability(db, SEED_PARENT_ID, "rohan")).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
    expect(
      changeTeenPayIdTransition(db, { actorId: SEED_PARENT_ID, at: LATER, teenPayId: "rohan" }).result,
    ).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });

  it("a parent can't claim a teen's ID through change either", () => {
    const db = buildSeedDatabase();
    const out = changeTeenPayIdTransition(db, {
      actorId: SEED_PARENT_ID,
      at: LATER,
      teenPayId: "aarav",
    });
    expect(out.result.ok).toBe(false);
    expect(out.db).toBe(db);
  });
});

describe("change-ID never leaks or re-targets", () => {
  it("the QR payload follows the new handle and carries no account data", () => {
    let db = buildSeedDatabase();
    db = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "rohan" }).db;
    const qr = qrIdentityFor(db, SEED_TEEN_ID);
    expect(qr).toMatchObject({ ok: true, value: { payload: "teenpay://user/@rohan?v=1" } });
    if (!qr.ok) throw new Error("expected ok");
    expect(JSON.stringify(qr.value)).not.toMatch(/usr_|wal_/);
  });

  it("notifications from before the change keep their historical text", () => {
    let db = buildSeedDatabase();
    db = sendFriendRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      teenPayId: "@meera",
      requestId: "frd_priv_history",
    }).db;
    const before = db.notifications.find((n) => n.recipientId === SEED_PEER_ID);
    expect(before?.body).toContain("@aarav");
    db = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "rohan" }).db;
    const after = db.notifications.find((n) => n.id === before!.id);
    // History is immutable — the old handle stays in the old message.
    expect(after?.body).toContain("@aarav");
  });
});
