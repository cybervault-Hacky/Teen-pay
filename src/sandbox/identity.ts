import type {
  FamilyMembership,
  GuardianControls,
  GuardianLink,
  User,
  UserRole,
} from "@/domain";
import type { SandboxState } from "./types";

/**
 * Pure identity, session, and family lookups.
 *
 * Nothing here hardcodes a person: teens and guardians are found
 * by role and relationship, so the same code works for any family
 * shape the sandbox (or a future backend) provides.
 */

export function findUser(state: SandboxState, userId: string): User | null {
  return state.users.find((user) => user.id === userId) ?? null;
}

/** The identity the sandbox session is currently using. */
export function currentUser(state: SandboxState): User {
  const user = findUser(state, state.session.currentUserId);
  if (user) return user;
  // Unreachable with validated state; fall back to the first identity.
  const first = state.users[0];
  if (!first) throw new Error("Sandbox has no identities");
  return first;
}

export function currentRole(state: SandboxState): UserRole {
  return currentUser(state).role;
}

/** The first account with a role in this view. */
export function firstUserWithRole(
  state: SandboxState,
  role: UserRole,
): User | null {
  return state.users.find((user) => user.role === role) ?? null;
}

/** A current (pending or active) membership — removed ones don't count. */
export function familyMember(
  state: SandboxState,
  accountId: string,
): FamilyMembership | null {
  return (
    state.family.members.find(
      (m) => m.accountId === accountId && m.status !== "removed",
    ) ?? null
  );
}

/** An active membership. */
export function activeMember(
  state: SandboxState,
  accountId: string,
): FamilyMembership | null {
  const member = familyMember(state, accountId);
  return member?.status === "active" ? member : null;
}

/** Every active teen in the family (multi-teen ready). */
export function familyTeens(state: SandboxState): User[] {
  return state.family.members
    .filter((member) => member.role === "teen" && member.status === "active")
    .map((member) => findUser(state, member.accountId))
    .filter((user): user is User => user !== null);
}

/**
 * The teen whose wallet this view's ledger represents, or null when
 * the view has no family (e.g. a parent who hasn't connected yet).
 */
export function maybePrimaryTeen(state: SandboxState): User | null {
  return familyTeens(state)[0] ?? null;
}

/**
 * Like `maybePrimaryTeen`, for engine paths that require a family.
 * Throws when there is none; the store turns that into a safe error.
 */
export function primaryTeen(state: SandboxState): User {
  const teen = maybePrimaryTeen(state);
  if (!teen) throw new Error("This view has no teen account");
  return teen;
}

export function linkFor(
  state: SandboxState,
  teenId: string,
): GuardianLink | null {
  return state.family.links.find((link) => link.teenId === teenId) ?? null;
}

/** The connected guardian for a teen, only while linked. */
export function linkedGuardian(
  state: SandboxState,
  teenId: string,
): User | null {
  const link = linkFor(state, teenId);
  if (!link || link.status !== "linked" || !link.guardianId) return null;
  return findUser(state, link.guardianId);
}

export function isLinkedGuardianOf(
  state: SandboxState,
  guardianId: string,
  teenId: string,
): boolean {
  return linkedGuardian(state, teenId)?.id === guardianId;
}

/** Teens a guardian is connected to. */
export function teensOfGuardian(
  state: SandboxState,
  guardianId: string,
): User[] {
  return state.family.links
    .filter((link) => link.status === "linked" && link.guardianId === guardianId)
    .map((link) => findUser(state, link.teenId))
    .filter((user): user is User => user !== null);
}

/**
 * Controls that are actually in force for a teen. Controls only
 * apply while a guardian is linked — never silently otherwise.
 */
export function activeControls(
  state: SandboxState,
  teenId: string,
): GuardianControls | null {
  if (!linkedGuardian(state, teenId)) return null;
  return state.family.controls.find((c) => c.teenId === teenId) ?? null;
}
