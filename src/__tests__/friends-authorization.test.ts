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
import { buildSeedDatabase, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { linkedDatabase, AT } from "./helpers/fixtures";

/**
 * Friend Circle authorization (Phase 12): teen-only, own circle only,
 * and every mutation decided by exactly the right party — checked in
 * the engine, never by the UI alone.
 */

const LATER = "2026-09-26T09:00:00Z";

function pending(db: SandboxDatabase): { db: SandboxDatabase; id: string } {
  const out = sendFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", requestId: "frd_authz_one" });
  if (!out.result.ok) throw new Error(out.result.error.message);
  return { db: out.db, id: out.result.value.friendshipId };
}

describe("teen-only", () => {
  it("a teen reads and writes their own circle", () => {
    const db = pending(buildSeedDatabase()).db;
    expect(friendCircleFor(db, SEED_TEEN_ID)).toMatchObject({ ok: true });
    expect(friendLookup(db, SEED_TEEN_ID, "@meera")).toMatchObject({ ok: true });
  });

  it("a parent can't read a teen's Friend Circle — even their own teen's", () => {
    const db = pending(buildSeedDatabase()).db;
    expect(friendCircleFor(db, SEED_PARENT_ID)).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
    expect(friendLookup(db, SEED_PARENT_ID, "@meera")).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });

  it("linking a guardian gives them money oversight, still not the circle", () => {
    const linked = pending(linkedDatabase()).db;
    expect(friendCircleFor(linked, SEED_PARENT_ID)).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(friendLookup(linked, SEED_PARENT_ID, "@aarav")).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });

  it("a parent can't send, decide or remove friendships", () => {
    const { db, id } = pending(buildSeedDatabase());
    expect(
      sendFriendRequestTransition(db, { actorId: SEED_PARENT_ID, at: AT, teenPayId: "@meera", requestId: "frd_parent_t" }).result,
    ).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    // Records only answer to their own parties, so a parent's attempt
    // reads as "not available" — even quieter than a refusal.
    expect(acceptFriendRequestTransition(db, { actorId: SEED_PARENT_ID, at: AT, friendshipId: id }).result).toMatchObject({
      ok: false,
      error: { code: "unknown_friendship" },
    });
    expect(declineFriendRequestTransition(db, { actorId: SEED_PARENT_ID, at: AT, friendshipId: id }).result).toMatchObject({
      ok: false,
      error: { code: "unknown_friendship" },
    });
    expect(cancelFriendRequestTransition(db, { actorId: SEED_PARENT_ID, at: AT, friendshipId: id }).result).toMatchObject({
      ok: false,
      error: { code: "unknown_friendship" },
    });
    expect(removeFriendTransition(db, { actorId: SEED_PARENT_ID, at: AT, teenPayId: "@meera" }).result).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
  });

  it("family membership never becomes a friendship", () => {
    // Aarav can't friend his own parent — the directory refuses parents.
    const out = sendFriendRequestTransition(buildSeedDatabase(), { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@priya", requestId: "frd_family_x" });
    expect(out.result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    // And nothing in a teen's circle is ever a family member.
    const db = pending(buildSeedDatabase()).db;
    const circle = friendCircleFor(db, SEED_TEEN_ID);
    if (!circle.ok) throw new Error("circle failed");
    const handles = [...circle.value.friends, ...circle.value.incoming, ...circle.value.outgoing].map((v) => v.handle);
    expect(handles).not.toContain("@priya");
  });
});

describe("per-action party rules", () => {
  it("only the recipient accepts or declines", () => {
    const { db, id } = pending(buildSeedDatabase());
    expect(acceptFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: id }).result).toMatchObject({
      ok: false,
      error: { code: "unknown_friendship" },
    });
    expect(declineFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: id }).result).toMatchObject({
      ok: false,
      error: { code: "unknown_friendship" },
    });
    expect(acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).result).toMatchObject({ ok: true });
  });

  it("only the requester cancels", () => {
    const { db, id } = pending(buildSeedDatabase());
    expect(cancelFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).result).toMatchObject({
      ok: false,
      error: { code: "unknown_friendship" },
    });
    expect(cancelFriendRequestTransition(db, { actorId: SEED_TEEN_ID, at: LATER, friendshipId: id }).result).toMatchObject({ ok: true });
  });

  it("either friend removes; a stranger never", () => {
    const start = pending(buildSeedDatabase());
    let db = start.db;
    const id = start.id;
    db = acceptFriendRequestTransition(db, { actorId: SEED_PEER_ID, at: LATER, friendshipId: id }).db;
    const created = createAccount(db, { role: "teen", displayName: "Kabir Mehta", username: "kabir" }, AT);
    if ("code" in created) throw new Error("setup failed");
    db = created.db;
    const stranger = created.account.id;

    expect(removeFriendTransition(db, { actorId: stranger, at: LATER, teenPayId: "@aarav" }).result).toMatchObject({
      ok: false,
      error: { code: "not_friends" },
    });
    // The requester side can remove.
    expect(removeFriendTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera" }).result).toMatchObject({ ok: true });
  });

  it("a record id from another pair is not available to outsiders", () => {
    const { db, id } = pending(buildSeedDatabase());
    const created = createAccount(db, { role: "teen", displayName: "Kabir Mehta", username: "kabir" }, AT);
    if ("code" in created) throw new Error("setup failed");
    for (const action of [
      acceptFriendRequestTransition(created.db, { actorId: created.account.id, at: LATER, friendshipId: id }),
      declineFriendRequestTransition(created.db, { actorId: created.account.id, at: LATER, friendshipId: id }),
      cancelFriendRequestTransition(created.db, { actorId: created.account.id, at: LATER, friendshipId: id }),
    ]) {
      expect(action.result).toMatchObject({ ok: false, error: { code: "unknown_friendship" } });
    }
  });

  it("guessing friendship ids reveals nothing about other pairs", () => {
    const { db } = pending(buildSeedDatabase());
    const created = createAccount(db, { role: "teen", displayName: "Kabir Mehta", username: "kabir" }, AT);
    if ("code" in created) throw new Error("setup failed");
    expect(acceptFriendRequestTransition(created.db, { actorId: created.account.id, at: LATER, friendshipId: "frd_authz_one" }).result).toMatchObject({
      ok: false,
      error: { message: "This friend request isn't available." },
    });
  });
});
