import type { GuardianControls } from "./safety";

/**
 * Domain: family.
 *
 * A family is the teen's money circle: the teen(s) plus the
 * parent(s)/guardian(s) connected to them. It carries the
 * relationship state for each teen, the controls guardians have
 * set, and the sandbox invites used to connect.
 *
 * The model is multi-teen and multi-family by design: members,
 * links, controls and invites are keyed by account and teen, even
 * though the sandbox seeds one family.
 *
 * Family relationship and financial history are separate: linking
 * or disconnecting never touches the ledger.
 */

export type FamilyMemberRole = "teen" | "guardian";

/** How a guardian relates to the teen. Display only in Phase 4. */
export type GuardianRelationship = "parent" | "guardian";

/**
 * Membership lifecycle:
 * · pending — a guardian entered a teen's invite and is reviewing.
 * · active  — a full member (teens from creation; guardians once connected).
 * · removed — disconnected or backed out. Kept, never deleted, so the
 *             family's history stays explainable.
 */
export type MembershipStatus = "pending" | "active" | "removed";

/**
 * An account's membership in a family. Access to family data is
 * decided from memberships — never from a UI role.
 */
export interface FamilyMembership {
  id: string;
  familyId: string;
  accountId: string;
  role: FamilyMemberRole;
  /** Set for guardians. */
  relationship?: GuardianRelationship;
  status: MembershipStatus;
  /** ISO 8601 timestamps. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Relationship state between a teen and a guardian:
 *
 *   not_linked ──▶ invitation_created ──▶ invitation_pending ──▶ linked
 *        ▲               │   ▲                  │                 │
 *        └── cancel ─────┘   └──── not now ─────┘                 │
 *   disconnected ◀──────────────────── disconnect ────────────────┘
 *
 * · invitation_created — the teen generated a code; nobody has used it yet.
 * · invitation_pending — a guardian entered the code and is reviewing.
 * · linked            — the guardian confirmed; family controls are active.
 * · disconnected      — was linked, then disconnected. Can re-invite.
 */
export type FamilyLinkStatus =
  | "not_linked"
  | "invitation_created"
  | "invitation_pending"
  | "linked"
  | "disconnected";

export type InviteStatus = "open" | "claimed" | "accepted" | "cancelled" | "expired";

/** Invites are short-lived by design, even in the sandbox. */
export const INVITE_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * A family invitation. In the sandbox the code is read out in
 * person — nothing is sent anywhere. A real backend would store a
 * hashed token; the shape stays the same.
 */
export interface FamilyInvite {
  id: string;
  familyId: string;
  /** The teen the invite connects a guardian to. */
  teenId: string;
  /** Who created it (the teen, today). */
  inviterId: string;
  intendedRelationship: GuardianRelationship;
  /** e.g. "TEEN-4821". */
  code: string;
  status: InviteStatus;
  /** ISO 8601 timestamps. */
  createdAt: string;
  expiresAt: string;
  /** Guardian currently reviewing the invite (status "claimed"). */
  claimedBy?: string;
  /** When it stopped being usable (accepted, cancelled, expired). */
  closedAt?: string;
}

export interface GuardianLink {
  teenId: string;
  status: FamilyLinkStatus;
  /** The connected (or last connected) guardian. */
  guardianId: string | null;
  /** The invite currently in play, if any. */
  inviteId: string | null;
  linkedAt?: string;
  disconnectedAt?: string;
  /** ISO 8601 timestamp of the last state change. */
  updatedAt: string;
}

export interface Family {
  id: string;
  name: string;
  /** Every membership, including removed ones (history). */
  members: FamilyMembership[];
  /** One relationship record per teen. */
  links: GuardianLink[];
  /** Guardian controls per teen — present only while linked. */
  controls: GuardianControls[];
  /** Invitation history, newest first. */
  invites: FamilyInvite[];
  createdAt: string;
}

/** True once an invite can no longer be used because time ran out. */
export function isInviteExpired(invite: FamilyInvite, at: string): boolean {
  return invite.expiresAt <= at;
}

/** An invite a guardian could still use at `at`. */
export function isInviteUsable(invite: FamilyInvite, at: string): boolean {
  return (
    (invite.status === "open" || invite.status === "claimed") &&
    !isInviteExpired(invite, at)
  );
}

/** Sandbox invite code format: TEEN- followed by four digits. */
export const INVITE_CODE_PATTERN = /^TEEN-\d{4}$/;

/** Normalizes user-typed codes: trims, uppercases, restores the dash. */
export function normalizeInviteCode(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/[\s-]+/g, "");
  const match = /^TEEN(\d{4})$/.exec(compact);
  return match ? `TEEN-${match[1]}` : raw.trim().toUpperCase();
}

/** "Parent / Guardian" style label for a member. */
export function relationshipLabel(
  relationship: GuardianRelationship | undefined,
): string {
  return relationship === "guardian" ? "Guardian" : "Parent / Guardian";
}
