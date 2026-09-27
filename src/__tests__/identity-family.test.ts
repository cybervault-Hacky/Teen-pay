import { describe, expect, it } from "vitest";
import { formatUsername, normalizeInviteCode, roleLabel } from "@/domain";
import {
  acceptInviteTransition,
  cancelInviteTransition,
  claimInviteTransition,
  createInviteTransition,
  disconnectTransition,
  releaseInviteTransition,
} from "@/sandbox/family-transitions";
import { sandboxSwitchTarget } from "@/sandbox/accounts";
import { databaseFromState } from "@/sandbox/persistence";
import { scopeFor } from "@/sandbox/scope";
import { currentUser, linkedGuardian, primaryTeen } from "@/sandbox/identity";
import { buildSeedDatabase, buildSeedState, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { selectSession } from "@/sandbox/selectors";
import { payTransition, sendAllowanceTransition } from "@/sandbox/transitions";
import type { SandboxState } from "@/sandbox/types";
import { AT, PARENT, TEEN, linkedState, must, teenBalance } from "./helpers/fixtures";

const statusOf = (s: SandboxState) =>
  s.family.links.find((l) => l.teenId === SEED_TEEN_ID)?.status;

describe("identity — sandbox identities", () => {
  it("seeds a teen identity with the full profile shape", () => {
    const s = buildSeedState();
    const teen = s.users.find((u) => u.role === "teen");
    expect(teen).toMatchObject({
      id: SEED_TEEN_ID,
      role: "teen",
      displayName: "Aarav",
      username: "aarav",
      status: "active",
      identitySource: "sandbox",
    });
    expect(formatUsername(teen!)).toBe("@aarav");
    expect(typeof teen!.createdAt).toBe("string");
  });

  it("seeds a parent identity", () => {
    const parent = buildSeedState().users.find((u) => u.role === "parent");
    expect(parent).toMatchObject({
      id: SEED_PARENT_ID,
      displayName: "Priya",
      username: "priya",
      identitySource: "sandbox",
    });
    expect(roleLabel("parent")).toBe("Parent");
  });

  it("starts the session as the teen", () => {
    const s = buildSeedState();
    expect(currentUser(s).id).toBe(SEED_TEEN_ID);
    expect(selectSession(s).role).toBe("teen");
    expect(selectSession(s).family?.id).toBe("fam_sharma");
  });
});

// Phase 4: switching role moves the auth session to another account
// (the sandbox demo control); each account gets its own scoped view
// of the same database. No family or ledger is ever created by it.
describe("identity — role switching", () => {
  it("switches to parent without creating a new family or ledger", () => {
    const db = buildSeedDatabase();
    const target = sandboxSwitchTarget(db, SEED_TEEN_ID, "parent");
    expect(target?.id).toBe(SEED_PARENT_ID);
    const scope = scopeFor(db, target!.id);
    expect(currentUser(scope!.state).id).toBe(SEED_PARENT_ID);
    expect(db.families).toHaveLength(1);
    // Phase 5: one primary wallet per account (teen + parent).
    expect(db.wallets).toHaveLength(2);
    expect(db.accounts).toHaveLength(2);
  });

  it("an unlinked parent has no current family; a linked one does", () => {
    const unlinked = scopeFor(buildSeedDatabase(), SEED_PARENT_ID)!;
    expect(unlinked.info.familyId).toBeNull();
    expect(selectSession(unlinked.state).family).toBeNull();
    const linked = scopeFor(databaseFromState(linkedState()), SEED_PARENT_ID)!;
    expect(linked.info.familyId).toBe("fam_sharma");
    expect(selectSession(linked.state).family?.id).toBe("fam_sharma");
  });

  it("switching back returns the same balances", () => {
    const db = databaseFromState(linkedState());
    const asTeen = scopeFor(db, SEED_TEEN_ID)!;
    const asParent = scopeFor(db, sandboxSwitchTarget(db, SEED_TEEN_ID, "parent")!.id)!;
    const backToTeen = scopeFor(db, sandboxSwitchTarget(db, SEED_PARENT_ID, "teen")!.id)!;
    expect(teenBalance(asParent.state)).toBe(teenBalance(asTeen.state));
    expect(teenBalance(backToTeen.state)).toBe(teenBalance(buildSeedState()));
    expect(currentUser(backToTeen.state).id).toBe(SEED_TEEN_ID);
  });
});

describe("family — linking lifecycle", () => {
  it("starts not linked", () => {
    expect(statusOf(buildSeedState())).toBe("not_linked");
    expect(linkedGuardian(buildSeedState(), SEED_TEEN_ID)).toBeNull();
  });

  it("the teen creates a sandbox invite code", () => {
    const out = createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" });
    expect(out.result.ok).toBe(true);
    expect(statusOf(out.state)).toBe("invitation_created");
    const invite = out.state.family.invites[0];
    expect(invite?.code).toBe("TEEN-4821");
    expect(invite?.status).toBe("open");
    expect(out.state.family.links[0]?.inviteId).toBe(invite?.id);
    expect(out.state.familyEvents[0]?.type).toBe("family_invite_created");
  });

  it("rejects a malformed invite code", () => {
    const out = createInviteTransition(buildSeedState(), { ...TEEN, code: "HELLO" });
    expect(out.result.ok).toBe(false);
  });

  it("only the teen can create an invite", () => {
    const out = createInviteTransition(buildSeedState(), { ...PARENT, code: "TEEN-1111" });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe("not_permitted");
  });

  it("a wrong code is rejected with a friendly message and no change", () => {
    const s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    const out = claimInviteTransition(s, { ...PARENT, code: "TEEN-0000" });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe("invalid_invite");
      expect(out.result.error.message).toMatch(/doesn't match an open invite/i);
    }
    expect(out.state).toBe(s);
  });

  it("entering the code moves the invite to pending review (codes are normalized)", () => {
    const s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    const out = claimInviteTransition(s, { ...PARENT, code: " teen 4821 " });
    expect(out.result.ok).toBe(true);
    expect(statusOf(out.state)).toBe("invitation_pending");
    expect(normalizeInviteCode("teen-4821")).toBe("TEEN-4821");
    // The teen hears their invite is being reviewed.
    expect(
      out.state.notifications.some(
        (n) => n.recipientId === SEED_TEEN_ID && n.title === "Invite being reviewed",
      ),
    ).toBe(true);
  });

  it("'Not now' releases the review back to invitation created", () => {
    let s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    s = must(claimInviteTransition(s, { ...PARENT, code: "TEEN-4821" }));
    s = must(releaseInviteTransition(s, { ...PARENT, teenId: SEED_TEEN_ID }));
    expect(statusOf(s)).toBe("invitation_created");
  });

  it("the teen can cancel an invite", () => {
    let s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    s = must(cancelInviteTransition(s, TEEN));
    expect(statusOf(s)).toBe("not_linked");
    expect(s.family.links[0]?.inviteId).toBeNull();
    expect(s.family.invites[0]?.status).toBe("cancelled");
  });

  it("accepting links the family: guardian member, default controls, notifications", () => {
    const s = linkedState();
    expect(statusOf(s)).toBe("linked");
    expect(linkedGuardian(s, SEED_TEEN_ID)?.id).toBe(SEED_PARENT_ID);
    expect(s.family.members.map((m) => m.role).sort()).toEqual(["guardian", "teen"]);
    expect(s.family.controls).toHaveLength(1);
    expect(s.family.controls[0]?.limits).toEqual({ dailyLimit: null, perTransactionLimit: null });

    const teenNote = s.notifications.find(
      (n) => n.recipientId === SEED_TEEN_ID && n.title === "Family connected",
    );
    const parentNote = s.notifications.find(
      (n) => n.recipientId === SEED_PARENT_ID && n.title === "Family connected",
    );
    expect(teenNote?.body).toBe("Priya is connected as your parent/guardian.");
    expect(parentNote).toBeDefined();
  });

  it("accepting is idempotent", () => {
    const s = linkedState();
    const again = acceptInviteTransition(s, { ...PARENT, teenId: SEED_TEEN_ID });
    expect(again.result.ok).toBe(true);
    expect(again.state).toBe(s);
  });

  it("cannot accept without entering the code first", () => {
    const s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    const out = acceptInviteTransition(s, { ...PARENT, teenId: SEED_TEEN_ID });
    expect(out.result.ok).toBe(false);
    expect(statusOf(out.state)).toBe("invitation_created");
  });

  it("linking and disconnecting never touch the ledger", () => {
    const seed = buildSeedState();
    const linked = linkedState();
    expect(linked.ledger).toEqual(seed.ledger);
    const disconnected = must(disconnectTransition(linked, { ...TEEN, teenId: SEED_TEEN_ID }));
    expect(disconnected.ledger).toEqual(seed.ledger);
  });

  it("disconnect: status, members, controls off, both sides notified", () => {
    const s = must(disconnectTransition(linkedState(), { ...PARENT, teenId: SEED_TEEN_ID }));
    expect(statusOf(s)).toBe("disconnected");
    expect(linkedGuardian(s, SEED_TEEN_ID)).toBeNull();
    // Phase 4: the guardian's membership is kept, marked "removed".
    expect(
      s.family.members.filter((m) => m.status !== "removed").every((m) => m.role === "teen"),
    ).toBe(true);
    expect(s.family.members.find((m) => m.accountId === SEED_PARENT_ID)?.status).toBe("removed");
    expect(s.family.controls).toHaveLength(0);
    const titles = s.notifications
      .filter((n) => n.title === "Family disconnected")
      .map((n) => n.recipientId)
      .sort();
    expect(titles).toEqual([SEED_PARENT_ID, SEED_TEEN_ID].sort());
  });

  it("a disconnected teen can invite again and relink", () => {
    let s = must(disconnectTransition(linkedState(), { ...TEEN, teenId: SEED_TEEN_ID }));
    s = must(createInviteTransition(s, { ...TEEN, code: "TEEN-7777" }));
    s = must(cancelInviteTransition(s, TEEN));
    expect(statusOf(s)).toBe("disconnected");
    s = must(createInviteTransition(s, { ...TEEN, code: "TEEN-7778" }));
    s = must(claimInviteTransition(s, { ...PARENT, code: "TEEN-7778" }));
    s = must(acceptInviteTransition(s, { ...PARENT, teenId: SEED_TEEN_ID }));
    expect(statusOf(s)).toBe("linked");
  });

  it("a stranger identity cannot disconnect", () => {
    const out = disconnectTransition(linkedState(), {
      actorId: "usr_nobody",
      at: AT,
      teenId: SEED_TEEN_ID,
    });
    expect(out.result.ok).toBe(false);
  });
});

describe("family — permissions", () => {
  it("the parent cannot make teen payments", () => {
    const out = payTransition(linkedState(), {
      ...PARENT,
      entryId: "pay_x",
      recipientId: "rec_riya",
      amount: 100,
    });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe("not_permitted");
  });

  it("allowance requires a linked guardian", () => {
    const unlinked = sendAllowanceTransition(buildSeedState(), {
      ...PARENT,
      operationId: "allow_x",
      amount: 500,
    });
    expect(unlinked.result.ok).toBe(false);
    if (!unlinked.result.ok) expect(unlinked.result.error.code).toBe("not_linked");

    const teenTry = sendAllowanceTransition(linkedState(), {
      ...TEEN,
      operationId: "allow_y",
      amount: 500,
    });
    expect(teenTry.result.ok).toBe(false);
  });

  it("primary teen is found by role, not by name", () => {
    const s = buildSeedState();
    const renamed: SandboxState = {
      ...s,
      users: s.users.map((u) => (u.role === "teen" ? { ...u, name: "Someone Else", displayName: "Someone" } : u)),
    };
    expect(primaryTeen(renamed).displayName).toBe("Someone");
  });
});
