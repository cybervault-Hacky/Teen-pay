/**
 * Domain: accounts, roles & identities.
 *
 * TeenPay is not generic adult banking. The core relationship is
 * teen ↔ parent/guardian within a family. Roles stay explicit so
 * later phases never treat every user as a regular bank customer.
 *
 * Phase 4: a `User` is an **account** — the product profile that a
 * sign-in session points at. Credentials never live here: an auth
 * provider owns those. In the sandbox there are no credentials at
 * all, and nothing here is (or claims to be) verified.
 */

export type UserRole = "teen" | "parent";

/**
 * Lifecycle of an account. Sandbox accounts are "active"; the other
 * states exist so real account management can land without a
 * redesign.
 */
export type UserStatus = "active" | "suspended" | "closed";

/**
 * How the account's identity was established. Only "sandbox" exists
 * today — a fictional profile with no verification of any kind.
 */
export type IdentitySource = "sandbox";

export interface User {
  /** Stable id — never reused, never derived from a name. */
  id: string;
  role: UserRole;
  /**
   * Provider-scoped sign-in identifier. Sandbox accounts use
   * `sandbox:<username>`; no email or phone is collected in Phase 4.
   */
  identifier: string;
  /** Full display name, e.g. "Aarav Sharma". */
  name: string;
  /** Short, friendly name used in copy, e.g. "Aarav". */
  displayName: string;
  /** TeenPay ID without the "@", e.g. "aarav". Unique, lowercase. */
  username: string;
  /** Initials used by the Avatar component when no photo exists. */
  avatarInitials: string;
  status: UserStatus;
  identitySource: IdentitySource;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
  /**
   * Set when the account holder asked for deletion. Phase 4 only
   * records the request — nothing is deleted, and financial
   * history is never removed by it.
   */
  deletionRequestedAt?: string;
}

/** The account a session belongs to. Same shape as `User`. */
export type Account = User;

/** "@aarav" — the one way a username is rendered. */
export function formatUsername(user: Pick<User, "username">): string {
  return `@${user.username}`;
}

/** Human label for a role, e.g. in badges. */
export function roleLabel(role: UserRole): string {
  return role === "teen" ? "Teen" : "Parent";
}
