import { describe, expect, it } from "vitest";
import { checkDisplayName, checkUsername, normalizeUsername } from "@/domain";
import {
  checkUsernameAvailability,
  createAccount,
  familyIdForInviteCode,
  requestAccountDeletion,
  sandboxSwitchTarget,
} from "@/sandbox/accounts";
import {
  authorize,
  canApprovePayment,
  canInitiatePayment,
  canManageSpendingRules,
  canViewTeenOverview,
} from "@/sandbox/authorization";
import {
  acceptInviteTransition,
  cancelInviteTransition,
  claimInviteTransition,
  createInviteTransition,
  disconnectTransition,
  setAllowanceScheduleTransition,
  updateSpendingRulesTransition,
} from "@/sandbox/family-transitions";
import { databaseFromState } from "@/sandbox/persistence";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, buildSeedState, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import {
  decideApprovalTransition,
  payTransition,
  sendAllowanceTransition,
} from "@/sandbox/transitions";
import type { SandboxDatabase, SandboxError, SandboxState } from "@/sandbox/types";
import { AT, PARENT, TEEN, linkedState, must, withRules } from "./helpers/fixtures";

const NOW = AT;

function created(db: SandboxDatabase, input: Parameters<typeof createAccount>[1]) {
  const result = createAccount(db, input, NOW);
  if ("code" in result) throw new Error(`createAccount failed: ${result.message}`);
  return result;
}

function errorCode(output: { result: { ok: boolean } }): string | undefined {
  const result = output.result as { ok: boolean; error?: SandboxError };
  return result.ok ? undefined : result.error?.code;
}

/** Runs a transition on an account's scope and merges it back. */
function act(
  db: SandboxDatabase,
  viewerId: string,
  run: (s: SandboxState) => { state: SandboxState; result: { ok: boolean } },
  familyId?: string,
): { db: SandboxDatabase; ok: boolean; code?: string } {
  const scope = scopeFor(db, viewerId, familyId ? { familyId } : {});
  if (!scope) return { db, ok: false, code: "account_unavailable" };
  const out = run(scope.state);
  if (!out.result.ok) return { db, ok: false, code: errorCode(out) };
  return { db: mergeScope(db, scope.info, scope.state, out.state), ok: true };
}

// ── Accounts ─────────────────────────────────────────────────────

describe("accounts — usernames", () => {
  it("normalizes casing, whitespace and a leading @", () => {
    expect(normalizeUsername("  @Kabir_M ")).toBe("kabir_m");
    expect(checkUsername("@Kabir").username).toBe("kabir");
    expect(checkUsername("@Kabir").problem).toBeNull();
  });

  it("enforces allowed characters, a letter first, and length", () => {
    expect(checkUsername("").problem).toBe("empty");
    expect(checkUsername("ab").problem).toBe("too_short");
    expect(checkUsername("a".repeat(21)).problem).toBe("too_long");
    expect(checkUsername("1abc").problem).toBe("invalid_start");
    expect(checkUsername("kabir-m").problem).toBe("invalid_characters");
    expect(checkUsername("kabir m").problem).toBe("invalid_characters");
    expect(checkUsername("kab..ir").problem).toBe("invalid_punctuation");
    expect(checkUsername("kabir_").problem).toBe("invalid_punctuation");
    expect(checkUsername("support").problem).toBe("reserved");
    expect(checkUsername("kabir.m_2").problem).toBeNull();
  });

  it("is unique across the sandbox, case-insensitively", () => {
    const db = buildSeedDatabase();
    expect(checkUsernameAvailability(db, "AARAV").problem).toBe("taken");
    expect(checkUsernameAvailability(db, "@priya").message).toMatch(/already taken/i);
    expect(checkUsernameAvailability(db, "kabir").problem).toBeNull();
  });

  it("validates display names without collecting anything else", () => {
    expect(checkDisplayName("  Kabir   Mehta ").displayName).toBe("Kabir Mehta");
    expect(checkDisplayName("").message).toMatch(/enter a name/i);
    expect(checkDisplayName("x".repeat(41)).message).toMatch(/40 characters/i);
    expect(checkDisplayName("<script>").message).not.toBeNull();
    expect(checkDisplayName("Kabir\u0007").message).not.toBeNull();
  });
});

describe("accounts — creation", () => {
  it("creates a teen with their own family and an empty wallet (no money)", () => {
    const { db, account } = created(buildSeedDatabase(), {
      role: "teen",
      displayName: "Kabir Mehta",
      username: "@Kabir",
    });
    expect(account).toMatchObject({
      role: "teen",
      name: "Kabir Mehta",
      displayName: "Kabir",
      username: "kabir",
      identifier: "sandbox:kabir",
      status: "active",
      identitySource: "sandbox",
      avatarInitials: "KM",
    });
    // No credentials or sensitive fields exist on the account.
    const keys = Object.keys(account).join(",");
    expect(keys).not.toMatch(/password|hash|token|secret|pin|aadhaar|pan|dob|phone|bank/i);

    const family = db.families.find((f) => f.members.some((m) => m.accountId === account.id));
    expect(family?.members).toEqual([
      expect.objectContaining({ accountId: account.id, role: "teen", status: "active" }),
    ]);
    expect(family?.links[0]?.status).toBe("not_linked");
    // Phase 5: an explicit wallet owned by the account, with no money.
    const wallet = db.wallets.find((w) => w.ownerAccountId === account.id);
    expect(wallet).toMatchObject({ id: `wal_${account.id}`, status: "active", currency: "INR" });
    expect(db.ledger.filter((e) => e.walletId === wallet?.id)).toEqual([]);
    expect(db.securityEvents[0]).toMatchObject({ type: "account_created", accountId: account.id });
  });

  it("creates a parent with no family until they enter an invite code", () => {
    const { db, account } = created(buildSeedDatabase(), {
      role: "parent",
      displayName: "Neha Mehta",
      username: "neha",
    });
    expect(db.families).toHaveLength(1); // only the seed family
    expect(scopeFor(db, account.id)?.info.familyId).toBeNull();
  });

  it("rejects taken or invalid usernames and invalid roles", () => {
    const db = buildSeedDatabase();
    const taken = createAccount(db, { role: "teen", displayName: "A", username: "Aarav" }, NOW);
    expect("code" in taken && taken.code).toBe("username_taken");
    const invalid = createAccount(db, { role: "teen", displayName: "A", username: "a b" }, NOW);
    expect("code" in invalid && invalid.code).toBe("invalid_account");
    const noName = createAccount(db, { role: "teen", displayName: " ", username: "kabir" }, NOW);
    expect("code" in noName && noName.code).toBe("invalid_account");
    const role = createAccount(
      db,
      { role: "admin" as never, displayName: "X", username: "xavier" },
      NOW,
    );
    expect("code" in role && role.code).toBe("invalid_account");
  });

  it("deletion is only a recorded request — nothing is deleted", () => {
    const db = buildSeedDatabase();
    const next = requestAccountDeletion(db, SEED_TEEN_ID, NOW);
    if ("code" in next) throw new Error("failed");
    expect(next.accounts.find((a) => a.id === SEED_TEEN_ID)?.deletionRequestedAt).toBe(NOW);
    expect(next.wallets).toEqual(db.wallets);
    expect(next.families).toEqual(db.families);
    expect(next.securityEvents[0]?.type).toBe("account_deletion_requested");
  });
});

// ── Isolation / multi-account ────────────────────────────────────

describe("multi-account isolation", () => {
  function twoFamilies() {
    let db = databaseFromState(linkedState()); // Aarav ↔ Priya
    const kabir = created(db, { role: "teen", displayName: "Kabir Mehta", username: "kabir" });
    db = kabir.db;
    const neha = created(db, { role: "parent", displayName: "Neha Mehta", username: "neha" });
    db = neha.db;
    return { db, kabir: kabir.account, neha: neha.account };
  }

  it("a new teen's scope contains only their own family, wallet and notifications", () => {
    const { db, kabir } = twoFamilies();
    const scope = scopeFor(db, kabir.id)!;
    expect(scope.state.family.members.map((m) => m.accountId)).toEqual([kabir.id]);
    expect(scope.state.ledger).toEqual([]);
    expect(scope.state.users.map((u) => u.id)).toEqual([kabir.id]);
    expect(scope.state.notifications.every((n) => n.recipientId === kabir.id)).toBe(true);
  });

  it("an unconnected parent sees no teen money at all", () => {
    const { db, neha } = twoFamilies();
    const scope = scopeFor(db, neha.id)!;
    expect(scope.info.walletTeenId).toBeNull();
    // Phase 5: only their own wallet (sandbox funds) — no teen's.
    expect(scope.state.wallets.map((w) => w.ownerAccountId)).toEqual([neha.id]);
    expect(scope.state.ledger.every((e) => e.accountId === neha.id)).toBe(true);
    expect(scope.state.approvals).toEqual([]);
  });

  it("another family's parent can't act on Aarav, even by id", () => {
    const { db, neha } = twoFamilies();
    const rules = act(db, neha.id, (s) =>
      updateSpendingRulesTransition(s, {
        actorId: neha.id,
        at: NOW,
        teenId: SEED_TEEN_ID,
        limits: { dailyLimit: 1, perTransactionLimit: null },
        approval: { threshold: null },
      }),
    );
    expect(rules.ok).toBe(false);
    expect(rules.code).toBe("not_linked");
    // Even with Aarav's family view forced, Neha isn't his guardian.
    const forced = act(
      db,
      neha.id,
      (s) => sendAllowanceTransition(s, { actorId: neha.id, at: NOW, operationId: "al_x", amount: 100 }),
      "fam_sharma",
    );
    expect(forced.ok).toBe(false);
  });

  it("a second family links independently (invite → claim → accept)", () => {
    const families = twoFamilies();
    const { kabir, neha } = families;
    let db = families.db;
    db = act(db, kabir.id, (s) =>
      createInviteTransition(s, { actorId: kabir.id, at: NOW, code: "TEEN-7777" }),
    ).db;
    const familyId = familyIdForInviteCode(db, "teen 7777");
    expect(familyId).not.toBeNull();
    expect(familyId).not.toBe("fam_sharma");
    db = act(
      db,
      neha.id,
      (s) => claimInviteTransition(s, { actorId: neha.id, at: NOW, code: "TEEN-7777" }),
      familyId!,
    ).db;
    // The claim makes Neha a *pending* member of Kabir's family only.
    const pending = db.families
      .find((f) => f.id === familyId)
      ?.members.find((m) => m.accountId === neha.id);
    expect(pending?.status).toBe("pending");
    expect(canViewTeenOverview(scopeFor(db, neha.id)!.state, neha.id, kabir.id)).toBe(false);

    db = act(db, neha.id, (s) =>
      acceptInviteTransition(s, { actorId: neha.id, at: NOW, teenId: kabir.id }),
    ).db;
    const nehaScope = scopeFor(db, neha.id)!;
    expect(nehaScope.info.familyId).toBe(familyId);
    expect(nehaScope.info.walletTeenId).toBe(kabir.id);
    expect(canManageSpendingRules(nehaScope.state, neha.id, kabir.id)).toBe(true);
    // Priya's family is untouched.
    const priya = scopeFor(db, SEED_PARENT_ID)!;
    expect(priya.info.walletTeenId).toBe(SEED_TEEN_ID);
    expect(priya.state.family.members.some((m) => m.accountId === neha.id)).toBe(false);
    // Security events for the link exist for both new accounts.
    expect(
      db.securityEvents.some((e) => e.type === "family_member_linked" && e.accountId === neha.id),
    ).toBe(true);
  });

  it("switch targets prefer the connected account", () => {
    const { db, kabir } = twoFamilies();
    expect(sandboxSwitchTarget(db, SEED_TEEN_ID, "parent")?.id).toBe(SEED_PARENT_ID);
    expect(sandboxSwitchTarget(db, SEED_PARENT_ID, "teen")?.id).toBe(SEED_TEEN_ID);
    expect(sandboxSwitchTarget(db, kabir.id, "teen")?.id).toBe(kabir.id);
  });
});

// ── Authorization ────────────────────────────────────────────────

describe("authorization — permissions", () => {
  it("a teen is denied every guardian action", () => {
    const s = withRules({ threshold: 500 });
    for (const permission of [
      "rules.manage",
      "allowance.send",
      "allowance.schedule",
      "approvals.decide",
      "teen.view_overview",
      "family.join",
    ] as const) {
      expect(authorize(s, SEED_TEEN_ID, permission, { teenId: SEED_TEEN_ID })?.code).toBe(
        "not_permitted",
      );
    }
    expect(canManageSpendingRules(s, SEED_TEEN_ID, SEED_TEEN_ID)).toBe(false);
    expect(
      errorCode(
        setAllowanceScheduleTransition(s, { ...TEEN, teenId: SEED_TEEN_ID, schedule: null }),
      ),
    ).toBe("not_permitted");
  });

  it("a parent is denied teen-only actions (paying from the teen's wallet)", () => {
    const s = linkedState();
    expect(canInitiatePayment(s, SEED_PARENT_ID)).toBe(false);
    const out = payTransition(s, {
      ...PARENT,
      entryId: "pay_parent",
      recipientId: "rec_riya",
      amount: 100,
    });
    expect(errorCode(out)).toBe("not_permitted");
    expect(out.state).toBe(s);
  });

  it("a linked parent has exactly the guardian permissions", () => {
    const s = linkedState();
    expect(canViewTeenOverview(s, SEED_PARENT_ID, SEED_TEEN_ID)).toBe(true);
    expect(canManageSpendingRules(s, SEED_PARENT_ID, SEED_TEEN_ID)).toBe(true);
    expect(canInitiatePayment(s, SEED_TEEN_ID)).toBe(true);
  });

  it("an unlinked or pending parent is rejected with not_linked", () => {
    expect(authorize(buildSeedState(), SEED_PARENT_ID, "rules.manage", { teenId: SEED_TEEN_ID })?.code).toBe(
      "not_linked",
    );
    let s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    s = must(claimInviteTransition(s, { ...PARENT, code: "TEEN-4821" }));
    // Pending membership grants nothing yet.
    expect(s.family.members.find((m) => m.accountId === SEED_PARENT_ID)?.status).toBe("pending");
    expect(canViewTeenOverview(s, SEED_PARENT_ID, SEED_TEEN_ID)).toBe(false);
  });

  it("a removed guardian loses access immediately", () => {
    const s = must(disconnectTransition(linkedState(), { ...TEEN, teenId: SEED_TEEN_ID }));
    expect(canManageSpendingRules(s, SEED_PARENT_ID, SEED_TEEN_ID)).toBe(false);
    expect(authorize(s, SEED_PARENT_ID, "allowance.send", { teenId: SEED_TEEN_ID })?.code).toBe(
      "not_linked",
    );
  });

  it("only the addressed guardian may decide an approval", () => {
    const s = must(
      payTransition(withRules({ threshold: 500 }), {
        ...TEEN,
        entryId: "pay_750",
        recipientId: "rec_riya",
        amount: 750,
      }),
    );
    const approval = s.approvals[0]!;
    expect(canApprovePayment(s, SEED_PARENT_ID, approval)).toBe(true);
    expect(canApprovePayment(s, SEED_TEEN_ID, approval)).toBe(false);
    const forged = { ...approval, guardianId: "usr_someone_else" };
    expect(canApprovePayment(s, SEED_PARENT_ID, forged)).toBe(false);
    // A teen trying to approve their own request is rejected.
    const out = decideApprovalTransition(s, { ...TEEN, approvalId: approval.id, decision: "approve" });
    expect(errorCode(out)).toBe("not_permitted");
  });

  it("unknown or closed accounts are rejected before anything else", () => {
    const s = linkedState();
    expect(authorize(s, "usr_ghost", "payments.initiate")?.code).toBe("unknown_user");
    const closed: SandboxState = {
      ...s,
      users: s.users.map((u) => (u.id === SEED_TEEN_ID ? { ...u, status: "closed" } : u)),
    };
    expect(authorize(closed, SEED_TEEN_ID, "payments.initiate")?.code).toBe("account_unavailable");
    // And a closed account gets no scope at all.
    const db = databaseFromState(closed);
    expect(scopeFor(db, SEED_TEEN_ID)).toBeNull();
  });
});

// ── Invites: expiry and ownership ────────────────────────────────

describe("family invites — expiry and records", () => {
  const LATER = "2026-09-28T06:00:01Z"; // 48h + 1s after AT

  it("invites are records with a 48-hour expiry", () => {
    const s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    const invite = s.family.invites[0]!;
    expect(invite).toMatchObject({
      familyId: "fam_sharma",
      teenId: SEED_TEEN_ID,
      inviterId: SEED_TEEN_ID,
      intendedRelationship: "parent",
      status: "open",
      createdAt: AT,
      expiresAt: "2026-09-28T06:00:00.000Z",
    });
  });

  it("an expired code can't be claimed, with a friendly message", () => {
    const s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    const out = claimInviteTransition(s, { actorId: SEED_PARENT_ID, at: LATER, code: "TEEN-4821" });
    expect(errorCode(out)).toBe("invite_expired");
    if (!out.result.ok) expect(out.result.error.message).toMatch(/expired/i);
    expect(out.state).toBe(s);
  });

  it("the teen can replace an expired code; the old one is closed as expired", () => {
    let s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    s = must(createInviteTransition(s, { actorId: SEED_TEEN_ID, at: LATER, code: "TEEN-5555" }));
    expect(s.family.invites.map((i) => [i.code, i.status])).toEqual([
      ["TEEN-5555", "open"],
      ["TEEN-4821", "expired"],
    ]);
    // The old code no longer works; the new one does.
    expect(errorCode(claimInviteTransition(s, { actorId: SEED_PARENT_ID, at: LATER, code: "TEEN-4821" }))).toBe(
      "invalid_invite",
    );
    expect(claimInviteTransition(s, { actorId: SEED_PARENT_ID, at: LATER, code: "TEEN-5555" }).result.ok).toBe(true);
  });

  it("cancelling a claimed invite removes the pending guardian membership", () => {
    let s = must(createInviteTransition(buildSeedState(), { ...TEEN, code: "TEEN-4821" }));
    s = must(claimInviteTransition(s, { ...PARENT, code: "TEEN-4821" }));
    const cancel = createInviteTransition(s, { ...TEEN, code: "TEEN-9999" });
    expect(cancel.result.ok).toBe(false); // must cancel first while under review
    s = must(cancelInviteTransition(s, TEEN));
    expect(s.family.members.find((m) => m.accountId === SEED_PARENT_ID)?.status).toBe("removed");
    expect(s.family.invites[0]?.status).toBe("cancelled");
  });

  it("accepting records the guardian as an active member and closes the invite", () => {
    const s = linkedState();
    expect(s.family.invites[0]?.status).toBe("accepted");
    expect(s.family.members.find((m) => m.accountId === SEED_PARENT_ID)).toMatchObject({
      role: "guardian",
      relationship: "parent",
      status: "active",
    });
  });
});

describe("account profile (derived membership)", () => {
  it("derives the current family membership instead of storing it", async () => {
    const { accountProfile } = await import("@/sandbox/scope");
    const { buildSeedDatabase, SEED_PARENT_ID, SEED_TEEN_ID } = await import("@/sandbox/seed");
    const db = buildSeedDatabase();
    const teen = accountProfile(db, SEED_TEEN_ID);
    expect(teen?.familyMembership).toMatchObject({ role: "teen", status: "active" });
    // The seed parent isn't linked yet: no access membership.
    expect(accountProfile(db, SEED_PARENT_ID)?.familyMembership).toBeNull();
    expect(accountProfile(db, "usr_missing")).toBeNull();
    expect("familyMembership" in db.accounts[0]!).toBe(false);
  });
});
