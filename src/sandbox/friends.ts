import {
  FRIEND_LIMIT,
  formatUsername,
  friendPairKey,
  friendshipPairKey,
  initialsFor,
  isOpenFriendshipStatus,
  isValidFriendshipTransition,
  otherFriend,
  type AppNotification,
  type DomainEvent,
  type FriendCircle,
  type FriendPreview,
  type FriendRelation,
  type FriendRequestView,
  type Friendship,
  type FriendView,
  type PeerProfile,
  type User,
} from "@/domain";
import { authorize } from "./authorization";
import { notificationsForEvent } from "./events";
import { accountByTeenPayId, isEligiblePeer, parseTeenPayId, peerProfileOf } from "./peer";
import type { PeerOutput } from "./peer-transitions";
import { scopeFor } from "./scope";
import type { SandboxDatabase, SandboxError, SandboxResult } from "./types";

/**
 * Friend Circles — the friend engine (Phase 12).
 *
 *   TeenPay ID lookup → friend request → accepted friendship
 *     → trusted peer selection → the existing Send / Request flows
 *
 * What it writes: only `db.friendships` — who asked whom, the status,
 * timestamps. Never the ledger, operations, wallets, Spaces, money
 * requests, approvals, favourites, guardian rules or schedules; there
 * is no path from here to `postOperation`. A friendship never implies
 * payment authorization — every money action still goes through the
 * peer engine, which re-checks guardian rules, balance and approvals.
 * What it also writes: at most one notification per meaningful event
 * (a new request reaches the recipient; an acceptance reaches the
 * requester). Declines, cancellations and removals stay quiet.
 *
 * Teen-only (`friends.use`): a parent — even a linked guardian — gets
 * the standard teen-only refusal, so a teen's circle stays private.
 * Family membership is a separate relationship type and is never
 * converted into a friendship.
 *
 * Discovery is intentional: an exact TeenPay ID, resolved through the
 * existing directory (`peer.ts`) — never a broad search of people, and
 * never by an internal id. Views expose only what the directory
 * already makes public: @handle, name, initials.
 *
 * Pair safety: at most one open record (pending or accepted) per
 * unordered pair — normalized by `friendPairKey`, so A→B and B→A can
 * never become two accepted friendships. Transitions are pure and
 * all-or-nothing (the input database comes back unchanged on failure)
 * and idempotent: repeats of an action return its recorded result.
 *
 * Abuse note: duplicate requests, duplicate accepts and double actions
 * are refused deterministically here (and in persistence). Real
 * production rate limiting must be enforced server-side later.
 */

export const FRIENDSHIP_ID_PATTERN = /^frd_[A-Za-z0-9_-]{6,100}$/;

const ACCOUNT_UNAVAILABLE: SandboxError = {
  code: "account_unavailable",
  message: "This account isn't available. Please sign in again.",
};

/** Same refusal shape as the directory: never confirms an ineligible account exists. */
export const NO_FRIEND_FOUND: SandboxError = {
  code: "unknown_recipient",
  message: "No TeenPay user found.",
  field: "recipient",
};

const MALFORMED: SandboxError = {
  code: "unknown_recipient",
  message: "Enter a TeenPay ID like @meera.",
  field: "recipient",
};

const SELF_FRIEND: SandboxError = {
  code: "self_friend",
  message: "You can't add yourself as a friend.",
  field: "recipient",
};

const INVALID_ID: SandboxError = {
  code: "invalid_transition",
  message: "Something went wrong, so nothing was changed. Please try again.",
};

const REQUEST_NOT_AVAILABLE: SandboxError = {
  code: "unknown_friendship",
  message: "This friend request isn't available.",
};

const NOT_FRIENDS: SandboxError = {
  code: "not_friends",
  message: "That person isn't in your Friend Circle.",
};

const DUPLICATE: SandboxError = {
  code: "duplicate",
  message: "This action was already submitted with different details. Nothing was changed.",
};

function fail<T>(db: SandboxDatabase, error: SandboxError): PeerOutput<T> {
  return { db, result: { ok: false, error } };
}

function done<T>(db: SandboxDatabase, value: T): PeerOutput<T> {
  return { db, result: { ok: true, value } };
}

const isError = (value: unknown): value is SandboxError =>
  typeof value === "object" && value !== null && "code" in value && "message" in value;

/**
 * The actor's scoped state, if they may use Friend Circles: an active
 * teen acting on their own account. Parents (and anyone else) get the
 * engine's refusal — authorization lives here, never in the UI.
 */
function friendScope(db: SandboxDatabase, actorId: string): { ok: true } | SandboxError {
  const scope = scopeFor(db, actorId);
  if (!scope) return ACCOUNT_UNAVAILABLE;
  const denied = authorize(scope.state, actorId, "friends.use");
  if (denied) return denied;
  return { ok: true };
}

/** Never more than one write per transition — the one friendship list. */
function withFriendships(db: SandboxDatabase, friendships: Friendship[]): SandboxDatabase {
  return { ...db, friendships };
}

function replaceFriendship(db: SandboxDatabase, updated: Friendship): SandboxDatabase {
  return withFriendships(
    db,
    (db.friendships ?? []).map((f) => (f.friendshipId === updated.friendshipId ? updated : f)),
  );
}

/** The pair's single open (pending or accepted) record, if any. */
function openRecordFor(db: SandboxDatabase, accountIdA: string, accountIdB: string): Friendship | null {
  const key = friendPairKey(accountIdA, accountIdB);
  return (
    (db.friendships ?? []).find(
      (f) => friendshipPairKey(f) === key && isOpenFriendshipStatus(f.status),
    ) ?? null
  );
}

// ── Notifications (projected from events, deduplicated by id) ─────

function appendNotifications(db: SandboxDatabase, fresh: AppNotification[]): SandboxDatabase {
  const known = new Set(db.notifications.map((n) => n.id));
  const added = fresh.filter((n) => !known.has(n.id));
  if (added.length === 0) return db;
  return {
    ...db,
    notifications: [...added, ...db.notifications].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  };
}

/** Projects a friend event using the actor's scope (like the peer engine). */
function notify(db: SandboxDatabase, actorId: string, events: DomainEvent[]): SandboxDatabase {
  const view = scopeFor(db, actorId)?.state;
  if (!view) return db;
  return appendNotifications(db, events.flatMap((event) => notificationsForEvent(view, event)));
}

// ── Views (public profile only — never the other account's ids) ───
// The view shapes live in `domain/friend.ts`; the engine only fills
// them, always from the directory's public profiles.

/**
 * The other side of a record as a safe profile. Unavailable people
 * (closed account, gone) fall back to their saved handle — like a
 * stale favourite — so no private detail leaks and nothing crashes.
 */
function profileOf(db: SandboxDatabase, accountId: string): { profile: PeerProfile; available: boolean } {
  const account = db.accounts.find((a) => a.id === accountId);
  if (account && account.role === "teen" && account.status === "active") {
    return { profile: peerProfileOf(account), available: isEligiblePeer(db, account) };
  }
  const handle = account ? formatUsername(account) : "@someone";
  return {
    profile: { handle, name: handle, initials: initialsFor(handle.slice(1)) },
    available: false,
  };
}

function friendRecords(db: SandboxDatabase): Friendship[] {
  return db.friendships ?? [];
}

/**
 * The viewer's current relationship with one other account, as the
 * Friend Circle sees it. Shared with the identity engine so the whole
 * app derives one relationship from one place.
 */
export function relationOf(db: SandboxDatabase, viewerId: string, otherId: string): FriendRelation {
  const record = openRecordFor(db, viewerId, otherId);
  if (!record) return { kind: "none" };
  if (record.status === "accepted") {
    return { kind: "friends", friendshipId: record.friendshipId, friendsSince: record.acceptedAt ?? record.createdAt };
  }
  return record.requesterAccountId === viewerId
    ? { kind: "request_sent", friendshipId: record.friendshipId, requestedAt: record.createdAt }
    : { kind: "request_received", friendshipId: record.friendshipId, requestedAt: record.createdAt };
}

const circleCache = new WeakMap<SandboxDatabase, Map<string, SandboxResult<FriendCircle>>>();

/**
 * The viewer's Friend Circle: friends, incoming and sent requests.
 * Memoized per database snapshot and viewer. Teen-only: anyone else
 * gets the engine's refusal (parents never see a teen's circle).
 */
export function friendCircleFor(db: SandboxDatabase, accountId: string): SandboxResult<FriendCircle> {
  let byViewer = circleCache.get(db);
  if (!byViewer) {
    byViewer = new Map();
    circleCache.set(db, byViewer);
  }
  const cached = byViewer.get(accountId);
  if (cached) return cached;

  const result: SandboxResult<FriendCircle> = (() => {
    const gate = friendScope(db, accountId);
    if (isError(gate)) return { ok: false, error: gate };
    const mine = friendRecords(db).filter((f) => otherFriend(f, accountId) !== null);
    const friends: FriendView[] = [];
    const incoming: FriendRequestView[] = [];
    const outgoing: FriendRequestView[] = [];
    for (const record of mine) {
      const otherId = otherFriend(record, accountId)!;
      const { profile, available } = profileOf(db, otherId);
      if (record.status === "accepted") {
        friends.push({
          ...profile,
          friendshipId: record.friendshipId,
          friendsSince: record.acceptedAt ?? record.createdAt,
          available,
        });
      } else if (record.status === "pending") {
        const view: FriendRequestView = {
          ...profile,
          friendshipId: record.friendshipId,
          requestedAt: record.createdAt,
          available,
        };
        (record.recipientAccountId === accountId ? incoming : outgoing).push(view);
      }
    }
    friends.sort((a, b) => a.handle.localeCompare(b.handle));
    incoming.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    outgoing.sort((a, b) => b.requestedAt.localeCompare(a.requestedAt));
    return { ok: true, value: { friends, incoming, outgoing } };
  })();
  byViewer.set(accountId, result);
  return result;
}

const lookupCache = new WeakMap<SandboxDatabase, Map<string, SandboxResult<FriendPreview>>>();

/**
 * Safe discovery for the Friend Circle: one exact TeenPay ID in, a
 * minimal preview out. Malformed input and unknown, closed, parent
 * or walletless accounts all read the same "No TeenPay user found."
 * (the directory never confirms an ineligible account exists); the
 * viewer's own ID is a neutral "this is you", not an error. Everyone
 * else: public profile + the current relationship state.
 */
export function friendLookup(db: SandboxDatabase, viewerId: string, raw: unknown): SandboxResult<FriendPreview> {
  let byViewer = lookupCache.get(db);
  if (!byViewer) {
    byViewer = new Map();
    lookupCache.set(db, byViewer);
  }
  const cacheKey = `${viewerId}|${typeof raw === "string" ? raw : ""}`;
  const cached = byViewer.get(cacheKey);
  if (cached) return cached;

  const result: SandboxResult<FriendPreview> = (() => {
    const gate = friendScope(db, viewerId);
    if (isError(gate)) return { ok: false, error: gate };
    const username = parseTeenPayId(raw);
    if (!username) return { ok: false, error: MALFORMED };
    const account = accountByTeenPayId(db, username);
    if (account?.id === viewerId) {
      return { ok: true, value: { kind: "self", profile: peerProfileOf(account) } };
    }
    if (!isEligiblePeer(db, account)) return { ok: false, error: NO_FRIEND_FOUND };
    return {
      ok: true,
      value: {
        kind: "peer",
        profile: peerProfileOf(account),
        relation: relationOf(db, viewerId, account.id),
      },
    };
  })();
  byViewer.set(cacheKey, result);
  return result;
}

/** A friend's current profile, only while they're in the viewer's circle. */
export function lookupFriend(db: SandboxDatabase, viewerId: string, teenPayId: string): PeerProfile | null {
  const username = parseTeenPayId(teenPayId);
  if (!username) return null;
  const account = accountByTeenPayId(db, username);
  if (!account) return null;
  const record = openRecordFor(db, viewerId, account.id);
  if (!record || record.status !== "accepted") return null;
  return isEligiblePeer(db, account) ? peerProfileOf(account) : null;
}

// ── Transitions ───────────────────────────────────────────────────

export interface SendFriendRequestInput {
  actorId: string;
  at: string;
  /** "@meera", "meera" or "sandbox:meera" — never an internal id. */
  teenPayId: string;
  /** Generated once per action (`frd_…`); a repeat adds nothing. */
  requestId: string;
}

export interface SendFriendRequestOutcome {
  friendshipId: string;
  recipient: PeerProfile;
  /** True when this answered a repeat of an earlier submit. */
  replayed: boolean;
}

/**
 * Sends a friend request to an eligible teen found by TeenPay ID.
 * Refuses self, malformed input, unknown / parent / closed accounts
 * (all "No TeenPay user found."), a pair that's already friends, a
 * request pending in the other direction (respond to theirs instead),
 * and more than FRIEND_LIMIT friends. A repeat — same key, or a pair
 * with the same pending request — answers from the record and adds
 * nothing. The recipient gets one notification; nobody else.
 */
export function sendFriendRequestTransition(
  db: SandboxDatabase,
  input: SendFriendRequestInput,
): PeerOutput<SendFriendRequestOutcome> {
  if (typeof input.requestId !== "string" || !FRIENDSHIP_ID_PATTERN.test(input.requestId)) {
    return fail(db, INVALID_ID);
  }
  const gate = friendScope(db, input.actorId);
  if (isError(gate)) return fail(db, gate);

  const username = parseTeenPayId(input.teenPayId);
  if (!username) return fail(db, MALFORMED);
  const targetAccount = accountByTeenPayId(db, username);
  if (targetAccount?.id === input.actorId) return fail(db, SELF_FRIEND);
  if (!isEligiblePeer(db, targetAccount)) return fail(db, NO_FRIEND_FOUND);
  const target: User = targetAccount;

  // Same action again (double click, retry): answer from the record.
  const prior = friendRecords(db).find((f) => f.friendshipId === input.requestId);
  if (prior) {
    return prior.requesterAccountId === input.actorId &&
      prior.recipientAccountId === target.id &&
      prior.status === "pending"
      ? done(db, { friendshipId: prior.friendshipId, recipient: peerProfileOf(target), replayed: true })
      : fail(db, DUPLICATE);
  }

  const open = openRecordFor(db, input.actorId, target.id);
  if (open) {
    if (open.status === "accepted") {
      return fail(db, {
        code: "friend_exists",
        message: `${formatUsername(target)} is already in your Friend Circle.`,
      });
    }
    if (open.requesterAccountId === input.actorId) {
      // The same request is already pending — idempotent, nothing new.
      return done(db, { friendshipId: open.friendshipId, recipient: peerProfileOf(target), replayed: true });
    }
    return fail(db, {
      code: "friend_request_pending",
      message: `${formatUsername(target)} has already sent you a friend request. You can accept it in your Friend Circle.`,
    });
  }

  const acceptedCount = friendRecords(db).filter(
    (f) => f.status === "accepted" && otherFriend(f, input.actorId) !== null,
  ).length;
  if (acceptedCount >= FRIEND_LIMIT) {
    return fail(db, {
      code: "friend_limit_reached",
      message: `You can have up to ${FRIEND_LIMIT} friends. Remove one to add another.`,
    });
  }

  const record: Friendship = {
    friendshipId: input.requestId,
    requesterAccountId: input.actorId,
    recipientAccountId: target.id,
    status: "pending",
    createdAt: input.at,
    updatedAt: input.at,
  };
  const next = notify(withFriendships(db, [...friendRecords(db), record]), input.actorId, [
    {
      id: `evt_frd_req_${record.friendshipId}`,
      type: "friend_request_received",
      actorId: input.actorId,
      at: input.at,
      friendshipId: record.friendshipId,
      requesterId: input.actorId,
      recipientId: target.id,
      requesterHandle: handleOf(db, input.actorId),
      recipientHandle: formatUsername(target),
    },
  ]);
  return done(next, { friendshipId: record.friendshipId, recipient: peerProfileOf(target), replayed: false });
}

/** Display-safe "@handle" for event snapshots (the actor is known to exist). */
function handleOf(db: SandboxDatabase, accountId: string): string {
  const account = db.accounts.find((a) => a.id === accountId);
  return account ? formatUsername(account) : "@someone";
}

function partyRecord(
  db: SandboxDatabase,
  friendshipId: unknown,
  actorId: string,
  side: "requester" | "recipient",
): Friendship | null {
  if (typeof friendshipId !== "string") return null;
  const record = friendRecords(db).find((f) => f.friendshipId === friendshipId);
  if (!record) return null;
  const party = side === "requester" ? record.requesterAccountId : record.recipientAccountId;
  return party === actorId ? record : null;
}

function alreadyDone(status: Friendship["status"]): SandboxError {
  return { code: "invalid_transition", message: `This friend request was already ${status}.` };
}

/** A timestamp that never goes backwards against the record's history. */
function laterAt(at: string, record: Friendship): string {
  return Date.parse(at) >= Date.parse(record.updatedAt) ? at : record.updatedAt;
}

export interface AcceptFriendRequestOutcome {
  status: "accepted";
  friendshipId: string;
  friend: PeerProfile;
  replayed: boolean;
}

/**
 * The recipient accepts a pending request. Re-checks that the
 * requester can still take part; a repeat returns the recorded
 * friendship. The requester hears about it once; declines and
 * cancellations stay quiet. Both sides then see each other in their
 * circles — nothing else changes anywhere.
 */
export function acceptFriendRequestTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string; friendshipId: string },
): PeerOutput<AcceptFriendRequestOutcome> {
  const record = partyRecord(db, input.friendshipId, input.actorId, "recipient");
  if (!record) return fail(db, REQUEST_NOT_AVAILABLE);
  const gate = friendScope(db, input.actorId);
  if (isError(gate)) return fail(db, gate);
  const requester = db.accounts.find((a) => a.id === record.requesterAccountId);

  if (record.status === "accepted") {
    return done(db, {
      status: "accepted",
      friendshipId: record.friendshipId,
      friend: profileOf(db, record.requesterAccountId).profile,
      replayed: true,
    });
  }
  if (record.status !== "pending") return fail(db, alreadyDone(record.status));
  if (!requester || !isEligiblePeer(db, requester)) {
    return fail(db, {
      code: "unknown_recipient",
      message: "This friend request can't be accepted any more.",
    });
  }
  if (openRecordFor(db, input.actorId, requester.id) !== record) {
    return fail(db, { code: "friend_exists", message: "You're already friends." });
  }

  const at = laterAt(input.at, record);
  const accepted: Friendship = { ...record, status: "accepted", acceptedAt: at, updatedAt: at };
  const next = notify(replaceFriendship(db, accepted), input.actorId, [
    {
      id: `evt_frd_ok_${record.friendshipId}`,
      type: "friend_request_accepted",
      actorId: input.actorId,
      at,
      friendshipId: record.friendshipId,
      requesterId: record.requesterAccountId,
      recipientId: record.recipientAccountId,
      requesterHandle: formatUsername(requester),
      recipientHandle: handleOf(db, input.actorId),
    },
  ]);
  return done(next, {
    status: "accepted",
    friendshipId: record.friendshipId,
    friend: peerProfileOf(requester),
    replayed: false,
  });
}

/** The recipient declines a pending request. Quiet — no notification. */
export function declineFriendRequestTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string; friendshipId: string },
): PeerOutput<{ status: "declined" }> {
  const record = partyRecord(db, input.friendshipId, input.actorId, "recipient");
  if (!record) return fail(db, REQUEST_NOT_AVAILABLE);
  const gate = friendScope(db, input.actorId);
  if (isError(gate)) return fail(db, gate);
  if (record.status === "declined") return done(db, { status: "declined" });
  if (record.status !== "pending") return fail(db, alreadyDone(record.status));
  if (!isValidFriendshipTransition(record.status, "declined")) {
    return fail(db, alreadyDone(record.status));
  }
  const at = laterAt(input.at, record);
  const declined: Friendship = { ...record, status: "declined", endedAt: at, updatedAt: at };
  return done(replaceFriendship(db, declined), { status: "declined" });
}

/** The requester withdraws their own pending request. Quiet. */
export function cancelFriendRequestTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string; friendshipId: string },
): PeerOutput<{ status: "cancelled" }> {
  const record = partyRecord(db, input.friendshipId, input.actorId, "requester");
  if (!record) return fail(db, REQUEST_NOT_AVAILABLE);
  const gate = friendScope(db, input.actorId);
  if (isError(gate)) return fail(db, gate);
  if (record.status === "cancelled") return done(db, { status: "cancelled" });
  if (record.status !== "pending") return fail(db, alreadyDone(record.status));
  const at = laterAt(input.at, record);
  const cancelled: Friendship = { ...record, status: "cancelled", endedAt: at, updatedAt: at };
  return done(replaceFriendship(db, cancelled), { status: "cancelled" });
}

export interface RemoveFriendInput {
  actorId: string;
  at: string;
  /** The friend, by TeenPay ID. */
  teenPayId: string;
}

/**
 * Either friend ends an accepted friendship. Changes the friendship
 * record and nothing else — no history deleted, no payment reversed,
 * no request cancelled, no rule touched. Removing someone who was
 * already removed is a quiet no-op; removing someone who isn't a
 * friend is refused. No notification is sent.
 */
export function removeFriendTransition(
  db: SandboxDatabase,
  input: RemoveFriendInput,
): PeerOutput<{ removed: string }> {
  const gate = friendScope(db, input.actorId);
  if (isError(gate)) return fail(db, gate);
  const username = parseTeenPayId(input.teenPayId);
  if (!username) return fail(db, NOT_FRIENDS);
  const account = accountByTeenPayId(db, username);
  if (!account || account.id === input.actorId) return fail(db, NOT_FRIENDS);

  const key = friendPairKey(input.actorId, account.id);
  const mine = friendRecords(db).filter((f) => friendshipPairKey(f) === key);
  const accepted = mine.find((f) => f.status === "accepted");
  if (!accepted) {
    return mine.some((f) => f.status === "removed")
      ? done(db, { removed: formatUsername(account) })
      : fail(db, NOT_FRIENDS);
  }
  const at = laterAt(input.at, accepted);
  const removed: Friendship = { ...accepted, status: "removed", endedAt: at, updatedAt: at };
  return done(replaceFriendship(db, removed), { removed: formatUsername(account) });
}
