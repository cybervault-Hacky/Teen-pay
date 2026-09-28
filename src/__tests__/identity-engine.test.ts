import { describe, expect, it } from "vitest";
import { createAccount } from "@/sandbox/accounts";
import { addContactTransition } from "@/sandbox/contacts";
import {
  acceptFriendRequestTransition,
  friendLookup,
  sendFriendRequestTransition,
} from "@/sandbox/friends";
import {
  changeTeenPayIdTransition,
  checkTeenPayIdAvailability,
  identityProfileFor,
  searchTeenPayId,
} from "@/sandbox/teenpay-id";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";

/**
 * TeenPay ID engine (Phase 13): availability states, the safe public
 * projection, canonical search, and changing your own ID without
 * touching anything behind it.
 */

const AT = "2026-09-26T06:00:00Z";
const LATER = "2026-09-26T09:00:00Z";

const freshDb = (): SandboxDatabase => buildSeedDatabase();

describe("availability (engine)", () => {
  it("reports a free ID as available", () => {
    const result = checkTeenPayIdAvailability(freshDb(), SEED_TEEN_ID, "rohan");
    expect(result).toMatchObject({ ok: true, value: { status: "available", normalized: "rohan" } });
  });

  it("normalizes before checking", () => {
    const result = checkTeenPayIdAvailability(freshDb(), SEED_TEEN_ID, "  @ROHAN ");
    expect(result).toMatchObject({ ok: true, value: { status: "available", normalized: "rohan" } });
  });

  it("reports someone else's ID as taken — without revealing who", () => {
    const result = checkTeenPayIdAvailability(freshDb(), SEED_TEEN_ID, "@meera");
    expect(result).toMatchObject({ ok: true, value: { status: "taken", normalized: "meera" } });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/usr_|wal_|Meera|Kapoor|name|status":"active/);
  });

  it("treats the viewer's own current ID as available (no-op change)", () => {
    const result = checkTeenPayIdAvailability(freshDb(), SEED_TEEN_ID, "@aarav");
    expect(result).toMatchObject({ ok: true, value: { status: "available" } });
  });

  it("reports reserved and invalid states", () => {
    expect(
      checkTeenPayIdAvailability(freshDb(), SEED_TEEN_ID, "admin"),
    ).toMatchObject({ ok: true, value: { status: "reserved" } });
    expect(
      checkTeenPayIdAvailability(freshDb(), SEED_TEEN_ID, "ab"),
    ).toMatchObject({ ok: true, value: { status: "invalid" } });
    expect(
      checkTeenPayIdAvailability(freshDb(), SEED_TEEN_ID, "usr_meera"),
    ).toMatchObject({ ok: true, value: { status: "reserved" } });
  });

  it("refuses parents", () => {
    const result = checkTeenPayIdAvailability(freshDb(), SEED_PARENT_ID, "rohan");
    expect(result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });
});

describe("the safe public projection", () => {
  it("resolves self", () => {
    const result = identityProfileFor(freshDb(), SEED_TEEN_ID, "@aarav");
    expect(result).toMatchObject({
      ok: true,
      value: {
        profile: { handle: "@aarav", name: "Aarav Sharma", initials: "AS" },
        self: true,
        relation: null,
        favourite: false,
      },
    });
  });

  it("resolves another teen with only public fields", () => {
    const result = identityProfileFor(freshDb(), SEED_TEEN_ID, "MEERA");
    expect(result).toMatchObject({
      ok: true,
      value: {
        profile: { handle: "@meera", name: "Meera Kapoor", initials: "MK" },
        self: false,
        available: true,
        favourite: false,
      },
    });
    if (!result.ok) throw new Error("expected ok");
    expect(result.value.relation).toEqual({ kind: "none" });
    const json = JSON.stringify(result.value);
    expect(json).not.toMatch(/usr_|wal_|fam_|balance|ledger|₹/);
  });

  it("reads unknown, malformed, internal and parent IDs all as 'not found'", () => {
    for (const raw of ["@nobody", "usr_meera", "wal_abc", "@priya"]) {
      expect(identityProfileFor(freshDb(), SEED_TEEN_ID, raw)).toMatchObject({
        ok: false,
        error: { code: "unknown_recipient" },
      });
    }
    expect(identityProfileFor(freshDb(), SEED_TEEN_ID, "🎈🎈")).toMatchObject({
      ok: false,
      error: { message: "Enter a TeenPay ID like @meera." },
    });
  });

  it("never confirms a closed account exists", () => {
    let db = freshDb();
    db = {
      ...db,
      accounts: db.accounts.map((a) => (a.id === SEED_PEER_ID ? { ...a, status: "closed" } : a)),
    };
    expect(identityProfileFor(db, SEED_TEEN_ID, "@meera")).toMatchObject({
      ok: false,
      error: { code: "unknown_recipient" },
    });
  });

  it("carries the Friend Circles relationship", () => {
    let db = freshDb();
    db = sendFriendRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      teenPayId: "@meera",
      requestId: "frd_identity_one",
    }).db;
    db = acceptFriendRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: LATER,
      friendshipId: db.friendships![0]!.friendshipId,
    }).db;
    expect(identityProfileFor(db, SEED_TEEN_ID, "@meera")).toMatchObject({
      ok: true,
      value: { relation: { kind: "friends" } },
    });
    expect(identityProfileFor(db, SEED_PEER_ID, "@aarav")).toMatchObject({
      ok: true,
      value: { relation: { kind: "friends" } },
    });
  });

  it("carries favourite state", () => {
    let db = freshDb();
    db = addContactTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      teenPayId: "@meera",
      contactId: "ctc_identity_one",
    }).db;
    expect(identityProfileFor(db, SEED_TEEN_ID, "@meera")).toMatchObject({
      ok: true,
      value: { favourite: true },
    });
    // The other side's view is unaffected.
    expect(identityProfileFor(db, SEED_PEER_ID, "@aarav")).toMatchObject({
      ok: true,
      value: { favourite: false },
    });
  });

  it("searchTeenPayId is the same canonical lookup", () => {
    const db = freshDb();
    expect(searchTeenPayId(db, SEED_TEEN_ID, "@meera")).toEqual(
      identityProfileFor(db, SEED_TEEN_ID, "@meera"),
    );
  });

  it("refuses parents and strangers alike", () => {
    expect(identityProfileFor(freshDb(), SEED_PARENT_ID, "@meera")).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
    expect(identityProfileFor(freshDb(), "usr_ghost", "@meera")).toMatchObject({
      ok: false,
      error: { code: "account_unavailable" },
    });
  });
});

describe("changing your own TeenPay ID", () => {
  it("changes the alias — and nothing else", () => {
    const db = freshDb();
    const withoutAccounts = { ...db, accounts: [] };
    const out = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@rohan" });
    expect(out.result).toMatchObject({ ok: true, value: { username: "rohan", handle: "@rohan", replayed: false } });
    const aarav = out.db.accounts.find((a) => a.id === SEED_TEEN_ID)!;
    expect(aarav.username).toBe("rohan");
    expect(aarav.identifier).toBe("sandbox:rohan");
    // Everything but the accounts array is untouched.
    expect({ ...out.db, accounts: [] }).toEqual(withoutAccounts);
    // Other accounts keep their identities.
    expect(out.db.accounts.find((a) => a.id === SEED_PEER_ID)!.username).toBe("meera");
  });

  it("asking for your own ID is an idempotent no-op", () => {
    const db = freshDb();
    const out = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "AARAV" });
    expect(out.result).toMatchObject({ ok: true, value: { replayed: true, handle: "@aarav" } });
    expect(out.db).toBe(db);
  });

  it("validates format, reserved and internal-id shapes", () => {
    const db = freshDb();
    for (const bad of ["ab", "admin", "usr_meera", "aa rav", "1rohan"]) {
      expect(
        changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: bad }).result,
      ).toMatchObject({ ok: false, error: { code: "invalid_account" } });
    }
  });

  it("refuses taken IDs with the taken error", () => {
    const out = changeTeenPayIdTransition(freshDb(), {
      actorId: SEED_TEEN_ID,
      at: LATER,
      teenPayId: "@meera",
    });
    expect(out.result).toMatchObject({ ok: false, error: { code: "username_taken" } });
  });

  it("refuses parents and unknown actors", () => {
    expect(
      changeTeenPayIdTransition(freshDb(), { actorId: SEED_PARENT_ID, at: LATER, teenPayId: "rohan" }).result,
    ).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(
      changeTeenPayIdTransition(freshDb(), { actorId: "usr_ghost", at: LATER, teenPayId: "rohan" }).result,
    ).toMatchObject({ ok: false, error: { code: "account_unavailable" } });
  });

  it("keeps timestamps monotonic", () => {
    const db = freshDb();
    const earlier = "2020-01-01T00:00:00Z";
    const before = db.accounts.find((a) => a.id === SEED_TEEN_ID)!.updatedAt;
    const out = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: earlier, teenPayId: "rohan" });
    expect(out.db.accounts.find((a) => a.id === SEED_TEEN_ID)!.updatedAt).toBe(before);
  });

  it("a freed ID can be claimed by a new account — old references keep their account", () => {
    let db = freshDb();
    db = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "rohan" }).db;
    const created = createAccount(db, { role: "teen", displayName: "New Aarav", username: "aarav" }, LATER);
    expect("account" in created).toBe(true);
    if (!("account" in created)) return;
    // The fresh @aarav is a different account entirely.
    expect(created.account.id).not.toBe(SEED_TEEN_ID);
    expect(identityProfileFor(created.db, SEED_PEER_ID, "@aarav")).toMatchObject({
      ok: true,
      value: { profile: { name: "New Aarav" }, self: false },
    });
    expect(identityProfileFor(created.db, SEED_PEER_ID, "@rohan")).toMatchObject({
      ok: true,
      value: { profile: { name: "Aarav Sharma" } },
    });
  });

  it("friendships survive the change and resolve by the new ID", () => {
    let db = freshDb();
    db = sendFriendRequestTransition(db, {
      actorId: SEED_TEEN_ID,
      at: AT,
      teenPayId: "@meera",
      requestId: "frd_identity_two",
    }).db;
    db = acceptFriendRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: LATER,
      friendshipId: db.friendships![0]!.friendshipId,
    }).db;
    db = changeTeenPayIdTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "rohan" }).db;

    // Meera still has the friendship — now under the new handle.
    const meeraLookup = friendLookup(db, SEED_PEER_ID, "@rohan");
    expect(meeraLookup).toMatchObject({
      ok: true,
      value: { kind: "peer", profile: { handle: "@rohan" }, relation: { kind: "friends" } },
    });
    // The old handle belongs to nobody now.
    expect(friendLookup(db, SEED_PEER_ID, "@aarav")).toMatchObject({
      ok: false,
      error: { code: "unknown_recipient" },
    });
  });
});
