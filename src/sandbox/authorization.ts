import {
  GUARDIAN_PERMISSIONS,
  TEEN_SELF_PERMISSIONS,
  roleAllows,
  type ApprovalRequest,
  type Permission,
} from "@/domain";
import {
  activeMember,
  findUser,
  isLinkedGuardianOf,
  maybePrimaryTeen,
} from "./identity";
import type { SandboxError, SandboxState } from "./types";

/**
 * Central authorization. Every write path asks here, in the data
 * layer, before changing anything:
 *
 *   1. the acting account exists and is active,
 *   2. its role grants the permission,
 *   3. its family membership covers the target (its own wallet for
 *      teen permissions; an actively linked teen for guardian ones).
 *
 * A UI role switch never grants anything by itself — the acting
 * account comes from the session, and access comes from data.
 */

export interface AuthorizationTarget {
  /** The teen whose money or rules the action concerns. */
  teenId?: string;
}

const NEEDS_TEEN: SandboxError = {
  code: "not_permitted",
  message: "This needs the teen's own account.",
};

const NEEDS_GUARDIAN: SandboxError = {
  code: "not_permitted",
  message: "This needs a parent or guardian account.",
};

const NOT_LINKED: SandboxError = {
  code: "not_linked",
  message: "Connect with your teen first to manage family controls.",
};

export function authorize(
  state: SandboxState,
  actorId: string,
  permission: Permission,
  target: AuthorizationTarget = {},
): SandboxError | null {
  const actor = findUser(state, actorId);
  if (!actor) {
    return { code: "unknown_user", message: "This account isn't available." };
  }
  if (actor.status !== "active") {
    return {
      code: "account_unavailable",
      message: "This account can't make changes right now.",
    };
  }
  if (!roleAllows(actor.role, permission)) {
    return actor.role === "teen" ? NEEDS_GUARDIAN : NEEDS_TEEN;
  }

  if (TEEN_SELF_PERMISSIONS.includes(permission)) {
    const teenId = target.teenId ?? actorId;
    if (teenId !== actorId || !activeMember(state, actorId)) return NEEDS_TEEN;
    // The wallet in this view must be the actor's own.
    if (maybePrimaryTeen(state)?.id !== actorId) return NEEDS_TEEN;
    return null;
  }

  if (GUARDIAN_PERMISSIONS.includes(permission)) {
    const teenId = target.teenId ?? maybePrimaryTeen(state)?.id;
    if (!teenId || !activeMember(state, actorId)) return NOT_LINKED;
    if (!isLinkedGuardianOf(state, actorId, teenId)) return NOT_LINKED;
    return null;
  }

  if (permission === "family.disconnect") {
    const teenId = target.teenId;
    if (!teenId) return NEEDS_TEEN;
    if (actorId === teenId && activeMember(state, actorId)) return null;
    if (isLinkedGuardianOf(state, actorId, teenId)) return null;
    return {
      code: "not_permitted",
      message: "Only the teen or their connected guardian can disconnect.",
    };
  }

  // "family.join": the role check above is the whole rule — joining
  // itself is gated by holding a valid, unexpired invite.
  return null;
}

/** Boolean form for UI decisions (the engine still re-checks). */
export function can(
  state: SandboxState,
  actorId: string,
  permission: Permission,
  target?: AuthorizationTarget,
): boolean {
  return authorize(state, actorId, permission, target) === null;
}

export function canInitiatePayment(state: SandboxState, actorId: string): boolean {
  return can(state, actorId, "payments.initiate");
}

export function canViewTeenOverview(
  state: SandboxState,
  actorId: string,
  teenId: string,
): boolean {
  return can(state, actorId, "teen.view_overview", { teenId });
}

export function canManageSpendingRules(
  state: SandboxState,
  actorId: string,
  teenId: string,
): boolean {
  return can(state, actorId, "rules.manage", { teenId });
}

/** The approval must also be addressed to this guardian. */
export function authorizeApprovalDecision(
  state: SandboxState,
  actorId: string,
  approval: ApprovalRequest,
): SandboxError | null {
  const error = authorize(state, actorId, "approvals.decide", {
    teenId: approval.teenId,
  });
  if (error) return error;
  if (approval.guardianId !== actorId) {
    return {
      code: "not_permitted",
      message: "Only the parent or guardian this was sent to can decide.",
    };
  }
  return null;
}

export function canApprovePayment(
  state: SandboxState,
  actorId: string,
  approval: ApprovalRequest,
): boolean {
  return authorizeApprovalDecision(state, actorId, approval) === null;
}
