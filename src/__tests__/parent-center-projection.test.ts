import { describe, expect, it } from "vitest";
import type { FamilyMembership, GuardianLink, User } from "@/domain";
import { defaultGuardianControls, primaryWalletId } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import {
  acceptInviteTransition,
  claimInviteTransition,
  createInviteTransition,
} from "@/sandbox/family-transitions";
import {
  selectParentCenter,
  selectTeenCenter,
} from "@/sandbox/parent-center";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import {
  buildSeedState,
  SEED_FAMILY_ID,
  SEED_PARENT_ID,
  SEED_PEER_ID,
  SEED_TEEN_ID,
} from "@/sandbox/seed";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { AT, linkedDatabase, linkedState } from "./helpers/fixtures";

/** Aarav's family + Priya's link, built through the real transitions. */
const linked = linkedState();

function must(
  output: { state: SandboxState; result: { ok: boolean } },
): SandboxState {
  if (!output.result.ok) throw new Error(`transition failed: ${JSON.stringify(output.result)}`);
  return output.state;
}

describe("selectTeenCenter — the parent-safe projection", () => {
  it("returns the linked teen field by field, never a raw object", () => {
    const view = selectTeenCenter(linked, SEED_PARENT_ID, SEED_TEEN_ID);
    expect(view).not.toBeNull();
    if (!view) return;

    expect(view.teen).toEqual({
      accountId: SEED_TEEN_ID,
      displayName: "Aarav",
      fullName: "Aarav Sharma",
      handle: "@aarav",
      initials: "AS",
    });
    expect(view.family).toEqual({
      membership: "active",
      connected: true,
      walletVisible: true,
    });
    // Money is the aggregate a parent is permitted to see — derived,
    // never a wallet snapshot.
    expect(view.money).toEqual({ available: 1850, allocated: 2300, total: 4150 });
    expect(view.wallet).toEqual({ walletId: primaryWalletId(SEED_TEEN_ID), status: "active" });
    expect(view.mayManageRules).toBe(true);
    expect(view.approvals.pending).toEqual([]);
    expect(view.allowance).toBeNull();
    // Activity rows are derived summaries, each tagged for its icon.
    expect(view.activity.length).toBeGreaterThan(0);
    expect(view.activity.length).toBeLessThanOrEqual(4);
    for (const row of view.activity) {
      expect(row).toHaveProperty("id");
      expect(row).toHaveProperty("title");
      expect(row).toHaveProperty("subtitle");
      expect(row).toHaveProperty("entryType");
      expect(typeof row.amount).toBe("number");
    }
  });

  it("returns null for a teen the parent is not linked to", () => {
    expect(selectTeenCenter(linked, SEED_PARENT_ID, SEED_PEER_ID)).toBeNull();
  });

  it("returns null before any family connection exists", () => {
    expect(selectTeenCenter(buildSeedState(), SEED_PARENT_ID, SEED_TEEN_ID)).toBeNull();
  });

  it("returns null when a non-guardian asks, even with ids in hand", () => {
    expect(selectTeenCenter(linked, SEED_TEEN_ID, SEED_TEEN_ID)).toBeNull();
    expect(selectTeenCenter(linked, SEED_PEER_ID, SEED_TEEN_ID)).toBeNull();
  });

  it("never carries teen-private areas into the projection", () => {
    const view = selectTeenCenter(linked, SEED_PARENT_ID, SEED_TEEN_ID);
    const json = JSON.stringify(view);
    for (const word of ["coach", "mission", "friend", "shield", "search", "qr", "lesson"]) {
      expect(json.toLowerCase()).not.toContain(word);
    }
    // Only the ids a parent needs; no raw account or database fields.
    expect(json).not.toContain("identifier");
    expect(json).not.toContain("identitySource");
    expect(json).not.toContain("deletionRequestedAt");
  });

  it("shows money only while the wallet is actually in scope", () => {
    const view = selectTeenCenter(linked, SEED_PARENT_ID, SEED_TEEN_ID);
    expect(view?.money).not.toBeNull();
    // Take the teen's wallet out of the scope: the relationship stays,
    // the money view goes — the same rule scopeFor enforces everywhere.
    const withoutWallet: SandboxState = {
      ...linked,
      wallets: linked.wallets.filter((w) => w.ownerAccountId === SEED_PARENT_ID),
    };
    const hidden = selectTeenCenter(withoutWallet, SEED_PARENT_ID, SEED_TEEN_ID);
    expect(hidden).not.toBeNull();
    expect(hidden?.money).toBeNull();
    expect(hidden?.wallet).toBeNull();
    expect(hidden?.activity).toEqual([]);
  });
});

describe("selectParentCenter — the family overview", () => {
  it("lists exactly the linked teens of the signed-in parent", () => {
    const center = selectParentCenter(linked, SEED_PARENT_ID);
    expect(center).not.toBeNull();
    if (!center) return;
    expect(center.parent.displayName).toBe("Priya");
    expect(center.parent.handle).toBe("@priya");
    expect(center.teens.map((t) => t.teen.accountId)).toEqual([SEED_TEEN_ID]);
    expect(center.invitePendingReview).toBeNull();
    expect(center.walletTeenId).toBe(SEED_TEEN_ID);
  });

  it("returns an empty teen list before linking, not an error", () => {
    const center = selectParentCenter(buildSeedState(), SEED_PARENT_ID);
    expect(center).not.toBeNull();
    expect(center?.teens).toEqual([]);
    expect(center?.invitePendingReview).toBeNull();
  });

  it("returns null for a teen account", () => {
    expect(selectParentCenter(linked, SEED_TEEN_ID)).toBeNull();
  });

  it("reports a claimed invite waiting for the teen's review", () => {
    // Create + claim, without accept: the parent sees the request,
    // not a teen.
    let s = buildSeedState();
    s = must(createInviteTransition(s, { actorId: SEED_TEEN_ID, at: AT, code: "TEEN-9999" }));
    s = must(claimInviteTransition(s, { actorId: SEED_PARENT_ID, at: AT, code: "TEEN-9999" }));
    const center = selectParentCenter(s, SEED_PARENT_ID);
    expect(center?.teens).toEqual([]);
    expect(center?.invitePendingReview).toEqual({ teenName: "Aarav" });
  });
});

describe("cross-teen isolation", () => {
  /** A second family: Rohan (teen) linked to Sunita (parent). */
  function secondFamilyDatabase(): { db: SandboxDatabase; rohanId: string; sunitaId: string } {
    let db = linkedDatabase();
    const rohan = createAccount(
      db,
      { role: "teen", displayName: "Rohan Verma", username: "rohan" },
      AT,
    );
    if ("code" in rohan) throw new Error("rohan create failed");
    db = rohan.db;
    const rohanId = rohan.account.id;
    const sunita = createAccount(
      db,
      { role: "parent", displayName: "Sunita Verma", username: "sunita" },
      AT,
    );
    if ("code" in sunita) throw new Error("sunita create failed");
    db = sunita.db;
    const sunitaId = sunita.account.id;

    // Rohan invites, Sunita claims and accepts — through the real
    // scoped transitions, exactly like the seed family.
    const run = (
      actorId: string,
      fn: (s: SandboxState) => { state: SandboxState; result: { ok: boolean } },
      familyId?: string,
    ) => {
      const scope = scopeFor(db, actorId, familyId ? { familyId } : {});
      if (!scope) throw new Error(`no scope for ${actorId}`);
      const out = fn(scope.state);
      if (!out.result.ok) throw new Error(`transition failed: ${JSON.stringify(out.result)}`);
      db = mergeScope(db, scope.info, scope.state, out.state);
    };
    const rohanFamilyId = db.families.find((f) =>
      f.members.some((m) => m.accountId === rohanId && m.role === "teen"),
    )!.id;
    run(rohanId, (s) => createInviteTransition(s, { actorId: rohanId, at: AT, code: "TEEN-7777" }));
    run(sunitaId, (s) => claimInviteTransition(s, { actorId: sunitaId, at: AT, code: "TEEN-7777" }), rohanFamilyId);
    run(sunitaId, (s) => acceptInviteTransition(s, { actorId: sunitaId, at: AT, teenId: rohanId }), rohanFamilyId);
    return { db, rohanId, sunitaId };
  }

  it("Priya's projection can never reach a teen linked to another parent", () => {
    const { db, rohanId } = secondFamilyDatabase();
    const priyaScope = scopeFor(db, SEED_PARENT_ID)!;
    expect(selectTeenCenter(priyaScope.state, SEED_PARENT_ID, rohanId)).toBeNull();
    const center = selectParentCenter(priyaScope.state, SEED_PARENT_ID);
    expect(center?.teens.map((t) => t.teen.accountId)).toEqual([SEED_TEEN_ID]);
  });

  it("Sunita sees only Rohan, with his own details", () => {
    const { db, rohanId, sunitaId } = secondFamilyDatabase();
    const sunitaScope = scopeFor(db, sunitaId)!;
    const center = selectParentCenter(sunitaScope.state, sunitaId);
    expect(center?.teens.map((t) => t.teen.accountId)).toEqual([rohanId]);
    expect(center?.teens[0]?.teen.handle).toBe("@rohan");
    // And Priya's teen is out of reach from her scope.
    expect(selectTeenCenter(sunitaScope.state, sunitaId, SEED_TEEN_ID)).toBeNull();
  });

  it("family membership is the only door — no lookup by arbitrary id", () => {
    const { db, rohanId } = secondFamilyDatabase();
    // Knowing ids changes nothing without a family link.
    const strangerScope = scopeFor(db, SEED_PEER_ID)!;
    expect(selectTeenCenter(strangerScope.state, SEED_PEER_ID, rohanId)).toBeNull();
    expect(selectTeenCenter(strangerScope.state, SEED_PEER_ID, SEED_TEEN_ID)).toBeNull();
  });
});

describe("multi-teen projection", () => {
  it("lists both linked teens and scopes money per wallet, honestly", () => {
    // The scope today projects one wallet-teen per family, so a second
    // linked teen appears with an honest "money not in view" state —
    // never faked zeros.
    const second: User = {
      id: "usr_rohan",
      role: "teen",
      identifier: "sandbox:rohan",
      name: "Rohan Verma",
      displayName: "Rohan",
      username: "rohan",
      avatarInitials: "RV",
      status: "active",
      identitySource: "sandbox",
      createdAt: AT,
      updatedAt: AT,
    };
    const membership: FamilyMembership = {
      id: "mem_rohan",
      familyId: SEED_FAMILY_ID,
      accountId: second.id,
      role: "teen",
      status: "active",
      createdAt: AT,
      updatedAt: AT,
    };
    const link: GuardianLink = {
      teenId: second.id,
      status: "linked",
      guardianId: SEED_PARENT_ID,
      inviteId: null,
      linkedAt: AT,
      updatedAt: AT,
    };
    const state: SandboxState = {
      ...linked,
      users: [...linked.users, second],
      family: {
        ...linked.family,
        members: [...linked.family.members, membership],
        links: [...linked.family.links, link],
        controls: [
          ...linked.family.controls,
          defaultGuardianControls(second.id, SEED_PARENT_ID, AT),
        ],
      },
      // No Rohan wallet in the scope: money must stay null for him.
    };

    const center = selectParentCenter(state, SEED_PARENT_ID);
    expect(center?.teens.map((t) => t.teen.accountId)).toEqual([SEED_TEEN_ID, second.id]);
    const rohanView = center?.teens.find((t) => t.teen.accountId === second.id);
    expect(rohanView?.money).toBeNull();
    expect(rohanView?.wallet).toBeNull();
    expect(rohanView?.family.connected).toBe(true);
    const aaravView = center?.teens.find((t) => t.teen.accountId === SEED_TEEN_ID);
    expect(aaravView?.money?.available).toBe(1850);
  });
});
