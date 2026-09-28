import type { PeerProfile } from "./peer";

/**
 * Domain: Friend Circles — trusted peer connections (Phase 12).
 *
 * A friendship is **a trusted peer relationship, never authority**:
 * it never moves money, never changes a rule, and never reveals
 * anything private. Friends stay an entry point into the existing
 * Send / Request flows, which re-check everything (guardian rules,
 * balance, approvals) exactly as they always do.
 *
 * Not a social network: no feeds, follower counts, streaks or
 * rankings exist anywhere in this model. A record stores only the
 * two accounts, the status and timestamps — no balance, history,
 * family or guardian data of either side.
 *
 * Pair ordering: requests can flow in either direction, but a pair
 * of accounts may have at most one *open* record (pending or
 * accepted) at a time — `friendPairKey` normalizes the order so
 * A→B and B→A are the same pair and can never become two accepted
 * friendships. Terminal records (declined, cancelled, removed) stay
 * as quiet history; a fresh request always creates a fresh record.
 */

export type FriendshipStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "cancelled"
  | "removed";

/**
 * Statuses that occupy the pair's single open slot. At most one
 * record per unordered pair may have one of these, ever.
 */
export const OPEN_FRIENDSHIP_STATUSES: readonly FriendshipStatus[] = [
  "pending",
  "accepted",
];

export function isOpenFriendshipStatus(status: FriendshipStatus): boolean {
  return status === "pending" || status === "accepted";
}

/**
 * The valid lifecycle moves. Everything else — declining something
 * already accepted, re-accepting a declined or removed friendship
 * without a new request — is refused by the engine.
 */
export const FRIENDSHIP_TRANSITIONS: Readonly<
  Record<FriendshipStatus, readonly FriendshipStatus[]>
> = {
  pending: ["accepted", "declined", "cancelled"],
  accepted: ["removed"],
  declined: [],
  cancelled: [],
  removed: [],
};

export function isValidFriendshipTransition(
  from: FriendshipStatus,
  to: FriendshipStatus,
): boolean {
  return FRIENDSHIP_TRANSITIONS[from].includes(to);
}

export interface Friendship {
  /** `frd_…` — the record's own id (also the send action's key). */
  friendshipId: string;
  /** The account that sent the request. */
  requesterAccountId: string;
  /** The account that decides (accept / decline). */
  recipientAccountId: string;
  status: FriendshipStatus;
  /** ISO 8601 — when the request was sent. */
  createdAt: string;
  /** ISO 8601 — the last transition (request, decision or removal). */
  updatedAt: string;
  /** Present exactly when the request was accepted (accepted, removed). */
  acceptedAt?: string;
  /** Present exactly when the record ended (declined, cancelled, removed). */
  endedAt?: string;
}

/**
 * The unordered pair key: both orderings of the same two accounts
 * produce the same string, so A→B and B→A share one open slot.
 */
export function friendPairKey(accountIdA: string, accountIdB: string): string {
  return [accountIdA, accountIdB].sort().join("~");
}

export function friendshipPairKey(friendship: Friendship): string {
  return friendPairKey(friendship.requesterAccountId, friendship.recipientAccountId);
}

/** The other account of the pair, as seen from `accountId`. */
export function otherFriend(friendship: Friendship, accountId: string): string | null {
  if (friendship.requesterAccountId === accountId) return friendship.recipientAccountId;
  if (friendship.recipientAccountId === accountId) return friendship.requesterAccountId;
  return null;
}

/** How many friends one teen can keep. */
export const FRIEND_LIMIT = 50;

// ── Friend-facing views ───────────────────────────────────────────
// Shapes only — the friend engine (`sandbox/friends.ts`) fills them.
// Every view carries at most what the TeenPay directory already makes
// public (`PeerProfile`: @handle, name, initials) plus the viewer's
// own relationship state. Never the other account's ids, wallet,
// balance, history, Spaces or guardian settings.

/** One accepted friend, as the viewer sees them. */
export interface FriendView extends PeerProfile {
  friendshipId: string;
  /** When the friendship started (the acceptance). */
  friendsSince: string;
  /** False when the person can't take part any more (closed, gone…). */
  available: boolean;
}

/** One pending request (incoming or sent). */
export interface FriendRequestView extends PeerProfile {
  friendshipId: string;
  /** When the request was sent. */
  requestedAt: string;
  available: boolean;
}

export interface FriendCircle {
  friends: FriendView[];
  /** Requests waiting for the viewer's decision. */
  incoming: FriendRequestView[];
  /** Requests the viewer sent, still pending. */
  outgoing: FriendRequestView[];
}

/** How the viewer stands with one other account. */
export type FriendRelation =
  | { kind: "none" }
  | { kind: "friends"; friendshipId: string; friendsSince: string }
  | { kind: "request_sent"; friendshipId: string; requestedAt: string }
  | { kind: "request_received"; friendshipId: string; requestedAt: string };

/** What a TeenPay ID lookup shows inside the Friend Circle. */
export type FriendPreview =
  | { kind: "self"; profile: PeerProfile }
  | { kind: "peer"; profile: PeerProfile; relation: FriendRelation };

/** The stored record's exact fields — persistence rejects anything else. */
export const FRIENDSHIP_KEYS = [
  "friendshipId",
  "requesterAccountId",
  "recipientAccountId",
  "status",
  "createdAt",
  "updatedAt",
  "acceptedAt",
  "endedAt",
] as const;
