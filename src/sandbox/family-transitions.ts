import {
  INVITE_CODE_PATTERN,
  INVITE_TTL_MS,
  defaultGuardianControls,
  isInviteExpired,
  normalizeInviteCode,
  type ApprovalRequest,
  type ApprovalRule,
  type DomainEvent,
  type Family,
  type FamilyInvite,
  type FamilyMembership,
  type GuardianControls,
  type GuardianLink,
  type SpendingLimits,
} from "@/domain";
import { authorize } from "./authorization";
import { commitEvents } from "./events";
import { linkFor } from "./identity";
import { stopSchedulesOnDisconnect } from "./allowance-transitions";
import { validateSpendingRules } from "./rules";
import {
  fail,
  isError,
  ok,
  requireWalletTeen,
  resolveContext,
  type ActionContext,
  type TransitionOutput,
} from "./transitions";
import type { SandboxError, SandboxState } from "./types";

/**
 * Pure transitions for family linking and guardian controls. None of
 * these touch the ledger: the family relationship and financial
 * history are separate concepts.
 *
 * Linking, as data:
 *   teen creates an invite (48h expiry)  → invite "open",    link "invitation_created"
 *   guardian enters the code             → invite "claimed", link "invitation_pending",
 *                                          guardian membership "pending"
 *   guardian connects                    → invite "accepted", link "linked",
 *                                          membership "active", controls created
 *   either side disconnects              → link "disconnected", membership "removed"
 */

// ── Helpers ──────────────────────────────────────────────────────

function withFamily(state: SandboxState, patch: Partial<Family>): SandboxState {
  return { ...state, family: { ...state.family, ...patch } };
}

function replaceLink(state: SandboxState, link: GuardianLink): SandboxState {
  return withFamily(state, {
    links: state.family.links.map((l) => (l.teenId === link.teenId ? link : l)),
  });
}

function replaceInvite(state: SandboxState, invite: FamilyInvite): SandboxState {
  return withFamily(state, {
    invites: state.family.invites.map((i) => (i.id === invite.id ? invite : i)),
  });
}

/** Where a link rests when no invite is open. */
function restingStatus(link: GuardianLink): GuardianLink["status"] {
  return link.disconnectedAt ? "disconnected" : "not_linked";
}

function inviteById(state: SandboxState, id: string | null): FamilyInvite | null {
  return id ? (state.family.invites.find((i) => i.id === id) ?? null) : null;
}

/** Sets an account's current membership status, creating one if needed. */
function setMembership(
  state: SandboxState,
  input: {
    accountId: string;
    role: FamilyMembership["role"];
    relationship?: FamilyMembership["relationship"];
    status: FamilyMembership["status"];
    at: string;
  },
): SandboxState {
  const members = state.family.members;
  const current = members.find(
    (m) => m.accountId === input.accountId && m.status !== "removed",
  );
  if (current) {
    if (current.status === input.status) return state;
    return withFamily(state, {
      members: members.map((m) =>
        m.id === current.id ? { ...m, status: input.status, updatedAt: input.at } : m,
      ),
    });
  }
  if (input.status === "removed") return state;
  const previous = members.filter((m) => m.accountId === input.accountId).length;
  const membership: FamilyMembership = {
    id: `mem_${state.family.id}_${input.accountId}${previous ? `_${previous + 1}` : ""}`,
    familyId: state.family.id,
    accountId: input.accountId,
    role: input.role,
    ...(input.relationship ? { relationship: input.relationship } : {}),
    status: input.status,
    createdAt: input.at,
    updatedAt: input.at,
  };
  return withFamily(state, { members: [...members, membership] });
}

const INVALID_INVITE: SandboxError = {
  code: "invalid_invite",
  message:
    "That code doesn't match an open invite. Check it with your teen and try again.",
};

const EXPIRED_INVITE: SandboxError = {
  code: "invite_expired",
  message: "That invite code has expired. Ask your teen to create a new one.",
};

/** Closes the link's current invite (and any pending claim) with a status. */
function closeCurrentInvite(
  state: SandboxState,
  link: GuardianLink,
  status: "cancelled" | "expired",
  at: string,
): SandboxState {
  const invite = inviteById(state, link.inviteId);
  if (!invite || (invite.status !== "open" && invite.status !== "claimed")) return state;
  let next = replaceInvite(state, { ...invite, status, closedAt: at });
  if (invite.claimedBy) {
    next = setMembership(next, {
      accountId: invite.claimedBy,
      role: "guardian",
      status: "removed",
      at,
    });
  }
  return next;
}

// ── Teen: invite ─────────────────────────────────────────────────

export function createInviteTransition(
  state: SandboxState,
  input: ActionContext & { code: string; inviteId?: string },
): TransitionOutput<{ code: string }> {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "family.invite_guardian");
  if (isError(teen)) return fail(state, teen);
  const link = linkFor(state, teen.id);
  if (!link) {
    return fail(state, { code: "invalid_transition", message: "Family not found." });
  }
  const current = inviteById(state, link.inviteId);
  const currentUsable =
    current !== null &&
    (current.status === "open" || current.status === "claimed") &&
    !isInviteExpired(current, at);
  if (currentUsable && current.code === input.code) {
    return ok(state, { code: input.code });
  }
  if (link.status === "linked") {
    return fail(state, {
      code: "invalid_transition",
      message: "A parent or guardian is already connected.",
    });
  }
  if (link.status === "invitation_pending" && currentUsable) {
    return fail(state, {
      code: "invalid_transition",
      message: "Your invite is being reviewed right now. Cancel it first to make a new one.",
    });
  }
  if (!INVITE_CODE_PATTERN.test(input.code)) {
    return fail(state, { code: "invalid_invite", message: "That invite code isn't valid." });
  }

  // An older invite that's still hanging around is closed first.
  let next = closeCurrentInvite(state, link, currentUsable ? "cancelled" : "expired", at);
  const invite: FamilyInvite = {
    id: input.inviteId ?? `inv_${teen.id}_${input.code}_${Date.parse(at)}`,
    familyId: state.family.id,
    teenId: teen.id,
    inviterId: actorId,
    intendedRelationship: "parent",
    code: input.code,
    status: "open",
    createdAt: at,
    expiresAt: new Date(Date.parse(at) + INVITE_TTL_MS).toISOString(),
  };
  next = withFamily(next, { invites: [invite, ...next.family.invites] });
  next = replaceLink(next, {
    ...link,
    status: "invitation_created",
    inviteId: invite.id,
    updatedAt: at,
  });
  return ok(
    commitEvents(next, [
      {
        id: `evt_inv_${teen.id}_${input.code}_${at}`,
        type: "family_invite_created",
        actorId,
        at,
        teenId: teen.id,
        code: input.code,
      },
    ]),
    { code: input.code },
  );
}

export function cancelInviteTransition(
  state: SandboxState,
  input: ActionContext = {},
): TransitionOutput {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "family.invite_guardian");
  if (isError(teen)) return fail(state, teen);
  const link = linkFor(state, teen.id);
  if (!link || !link.inviteId) return ok(state);
  if (link.status !== "invitation_created" && link.status !== "invitation_pending") {
    return ok(state);
  }
  let next = closeCurrentInvite(state, link, "cancelled", at);
  next = replaceLink(next, {
    ...link,
    status: restingStatus(link),
    inviteId: null,
    updatedAt: at,
  });
  return ok(
    commitEvents(next, [
      {
        id: `evt_invcan_${teen.id}_${at}`,
        type: "family_invite_cancelled",
        actorId,
        at,
        teenId: teen.id,
      },
    ]),
  );
}

// ── Guardian: enter code → review → connect ──────────────────────

/** A guardian enters a code; they become a pending member reviewing it. */
export function claimInviteTransition(
  state: SandboxState,
  input: ActionContext & { code: string },
): TransitionOutput<{ teenId: string }> {
  const { actorId, at } = resolveContext(state, input);
  const denied = authorize(state, actorId, "family.join");
  if (denied) return fail(state, denied);

  const code = normalizeInviteCode(input.code);
  const invite = state.family.invites.find(
    (i) => i.code === code && (i.status === "open" || i.status === "claimed"),
  );
  if (!invite) return fail(state, INVALID_INVITE);
  if (isInviteExpired(invite, at)) return fail(state, EXPIRED_INVITE);
  const link = linkFor(state, invite.teenId);
  if (!link || link.inviteId !== invite.id) return fail(state, INVALID_INVITE);

  if (invite.status === "claimed") {
    if (invite.claimedBy === actorId) return ok(state, { teenId: invite.teenId });
    return fail(state, INVALID_INVITE);
  }

  let next = replaceInvite(state, { ...invite, status: "claimed", claimedBy: actorId });
  next = replaceLink(next, { ...link, status: "invitation_pending", updatedAt: at });
  next = setMembership(next, {
    accountId: actorId,
    role: "guardian",
    relationship: invite.intendedRelationship,
    status: "pending",
    at,
  });
  return ok(
    commitEvents(next, [
      {
        id: `evt_claim_${invite.teenId}_${code}_${actorId}`,
        type: "family_invite_claimed",
        actorId,
        at,
        teenId: invite.teenId,
        guardianId: actorId,
      },
    ]),
    { teenId: invite.teenId },
  );
}

/** The guardian backs out of the review ("Not now"). */
export function releaseInviteTransition(
  state: SandboxState,
  input: ActionContext & { teenId: string },
): TransitionOutput {
  const { actorId, at } = resolveContext(state, input);
  const link = linkFor(state, input.teenId);
  const invite = link ? inviteById(state, link.inviteId) : null;
  if (
    !link ||
    !invite ||
    link.status !== "invitation_pending" ||
    invite.status !== "claimed" ||
    invite.claimedBy !== actorId
  ) {
    return ok(state);
  }
  const reopened: FamilyInvite = { ...invite, status: "open" };
  delete reopened.claimedBy;
  let next = replaceInvite(state, reopened);
  next = replaceLink(next, { ...link, status: "invitation_created", updatedAt: at });
  next = setMembership(next, { accountId: actorId, role: "guardian", status: "removed", at });
  return ok(next);
}

/** The guardian confirms. The family becomes linked. */
export function acceptInviteTransition(
  state: SandboxState,
  input: ActionContext & { teenId: string },
): TransitionOutput {
  const { actorId, at } = resolveContext(state, input);
  const denied = authorize(state, actorId, "family.join");
  if (denied) return fail(state, denied);

  const link = linkFor(state, input.teenId);
  if (!link) return fail(state, INVALID_INVITE);
  if (link.status === "linked" && link.guardianId === actorId) return ok(state);
  const invite = inviteById(state, link.inviteId);
  if (
    link.status !== "invitation_pending" ||
    !invite ||
    invite.status !== "claimed" ||
    invite.claimedBy !== actorId
  ) {
    return fail(state, {
      code: "invalid_transition",
      message: "Enter your teen's invite code first.",
    });
  }
  if (isInviteExpired(invite, at)) return fail(state, EXPIRED_INVITE);

  let next = replaceInvite(state, { ...invite, status: "accepted", closedAt: at });
  next = replaceLink(next, {
    ...link,
    status: "linked",
    guardianId: actorId,
    inviteId: null,
    linkedAt: at,
    updatedAt: at,
  });
  next = setMembership(next, {
    accountId: actorId,
    role: "guardian",
    relationship: invite.intendedRelationship,
    status: "active",
    at,
  });
  if (!next.family.controls.some((c) => c.teenId === input.teenId)) {
    next = withFamily(next, {
      controls: [...next.family.controls, defaultGuardianControls(input.teenId, actorId, at)],
    });
  }

  return ok(
    commitEvents(next, [
      {
        id: `evt_link_${input.teenId}_${actorId}_${at}`,
        type: "family_linked",
        actorId,
        at,
        teenId: input.teenId,
        guardianId: actorId,
      },
    ]),
  );
}

// ── Disconnect ───────────────────────────────────────────────────

/**
 * Either side can disconnect. Controls switch off, pending
 * approvals are cancelled (nothing moves), the guardian's membership
 * is marked removed, and the ledger is left exactly as it was.
 */
export function disconnectTransition(
  state: SandboxState,
  input: ActionContext & { teenId: string },
): TransitionOutput {
  const { actorId, at } = resolveContext(state, input);
  const link = linkFor(state, input.teenId);
  if (!link || link.status !== "linked" || !link.guardianId) {
    if (link?.status === "disconnected") return ok(state);
    return fail(state, {
      code: "invalid_transition",
      message: "There's no connected parent or guardian to disconnect.",
    });
  }
  const guardianId = link.guardianId;
  const denied = authorize(state, actorId, "family.disconnect", { teenId: input.teenId });
  if (denied) return fail(state, denied);

  const events: DomainEvent[] = [];
  const approvals = state.approvals.map((approval): ApprovalRequest => {
    if (approval.teenId !== input.teenId || approval.status !== "pending") {
      return approval;
    }
    const cancelled: ApprovalRequest = {
      ...approval,
      status: "cancelled",
      decidedAt: at,
      decidedBy: actorId,
      cancelReason: "Family disconnected",
    };
    events.push({
      id: `evt_apr_can_${approval.id}`,
      type: "approval_cancelled",
      actorId,
      at,
      approval: cancelled,
    });
    return cancelled;
  });

  const stillGuardianElsewhere = state.family.links.some(
    (l) =>
      l.teenId !== input.teenId &&
      l.status === "linked" &&
      l.guardianId === guardianId,
  );

  let next: SandboxState = replaceLink({ ...state, approvals }, {
    ...link,
    status: "disconnected",
    inviteId: null,
    disconnectedAt: at,
    updatedAt: at,
  });
  if (!stillGuardianElsewhere) {
    next = setMembership(next, { accountId: guardianId, role: "guardian", status: "removed", at });
  }
  next = withFamily(next, {
    controls: next.family.controls.filter((c) => c.teenId !== input.teenId),
  });
  // Pocket money belongs to the relationship: every open schedule
  // between these two stops for good (history kept, nothing moves).
  const stopped = stopSchedulesOnDisconnect(next, input.teenId, guardianId, actorId, at);
  next = stopped.state;
  events.push(...stopped.events);
  events.push({
    id: `evt_unlink_${input.teenId}_${guardianId}_${at}`,
    type: "family_unlinked",
    actorId,
    at,
    teenId: input.teenId,
    guardianId,
    cancelledApprovals: events.filter((e) => e.type === "approval_cancelled").length,
  });
  return ok(commitEvents(next, events));
}

// ── Guardian controls ────────────────────────────────────────────

function updateControls(
  state: SandboxState,
  teenId: string,
  patch: (current: GuardianControls) => GuardianControls,
): SandboxState {
  return {
    ...state,
    family: {
      ...state.family,
      controls: state.family.controls.map((c) =>
        c.teenId === teenId ? patch(c) : c,
      ),
    },
  };
}

function controlsFor(state: SandboxState, teenId: string) {
  return state.family.controls.find((c) => c.teenId === teenId) ?? null;
}

export function updateSpendingRulesTransition(
  state: SandboxState,
  input: ActionContext & {
    teenId: string;
    limits: SpendingLimits;
    approval: ApprovalRule;
  },
): TransitionOutput {
  const { actorId, at } = resolveContext(state, input);
  const denied = authorize(state, actorId, "rules.manage", { teenId: input.teenId });
  if (denied) return fail(state, denied);
  const invalid = validateSpendingRules(input.limits, input.approval);
  if (invalid) return fail(state, invalid);
  const current = controlsFor(state, input.teenId);
  if (!current) return fail(state, { code: "not_linked", message: "Family controls aren't active." });

  const unchanged =
    current.limits.dailyLimit === input.limits.dailyLimit &&
    current.limits.perTransactionLimit === input.limits.perTransactionLimit &&
    current.approval.threshold === input.approval.threshold;
  if (unchanged) return ok(state);

  const next = updateControls(state, input.teenId, (c) => ({
    ...c,
    limits: { ...input.limits },
    approval: { ...input.approval },
    updatedAt: at,
    updatedBy: actorId,
  }));
  return ok(
    commitEvents(next, [
      {
        id: `evt_rules_${input.teenId}_${at}`,
        type: "spending_limit_updated",
        actorId,
        at,
        teenId: input.teenId,
        limits: { ...input.limits },
        approval: { ...input.approval },
      },
    ]),
  );
}

export function updateGuardianNotificationsTransition(
  state: SandboxState,
  input: ActionContext & {
    teenId: string;
    payments: boolean;
    savings: boolean;
  },
): TransitionOutput {
  const { actorId, at } = resolveContext(state, input);
  const denied = authorize(state, actorId, "rules.manage", { teenId: input.teenId });
  if (denied) return fail(state, denied);
  const current = controlsFor(state, input.teenId);
  if (!current) return fail(state, { code: "not_linked", message: "Family controls aren't active." });
  if (
    current.notifications.payments === input.payments &&
    current.notifications.savings === input.savings
  ) {
    return ok(state);
  }
  const notifications = {
    payments: input.payments,
    savings: input.savings,
    approvals: true as const,
  };
  const next = updateControls(state, input.teenId, (c) => ({
    ...c,
    notifications,
    updatedAt: at,
    updatedBy: actorId,
  }));
  return ok(
    commitEvents(next, [
      {
        id: `evt_gnotif_${input.teenId}_${at}`,
        type: "guardian_notifications_updated",
        actorId,
        at,
        teenId: input.teenId,
        notifications,
      },
    ]),
  );
}
