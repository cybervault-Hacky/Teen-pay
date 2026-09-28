import {
  availabilityFromCheck,
  checkTeenPayId,
  formatTeenPayId,
  type IdentityProfile,
  type TeenPayIdAvailability,
  type User,
} from "@/domain";
import { authorize } from "./authorization";
import { isFavourite } from "./contacts";
import { relationOf } from "./friends";
import { isEligiblePeer, parseTeenPayId, peerProfileOf } from "./peer";
import type { PeerOutput } from "./peer-transitions";
import { scopeFor } from "./scope";
import type { SandboxDatabase, SandboxError, SandboxResult } from "./types";

/**
 * TeenPay ID — the identity engine (Phase 13).
 *
 * One centralized place where a TeenPay ID is looked up, checked for
 * availability, projected into a safe public profile, and (for its
 * owner) changed. Every screen that asks "who is @meera?" goes
 * through here, so the rules — normalization, reserved ids, internal
 * id refusal, privacy — can never drift between features.
 *
 * Identity vs accounting: a TeenPay ID is a public alias. All money
 * flows resolve it to the stable internal account id first, so
 * changing an ID never moves money, re-targets a friendship or a
 * favourite's meaning, or hijacks history. Money requests keep their
 * account ids and their handle snapshots; favourites keep the handle
 * they were saved with; the ledger never sees a TeenPay ID at all.
 *
 * What this engine writes: only `db.accounts` — and only the one
 * account whose owner asked, and only its alias fields (username,
 * identifier, updatedAt). Never the ledger, wallets, operations,
 * requests, Spaces, friendships, favourites or notifications; there
 * is no path from here to `postOperation`. A freed ID becomes
 * claimable again, exactly like a username on any directory — old
 * references keep pointing at the account id they always pointed at.
 *
 * Teen-only (`identity.use`), like Friend Circles. Parents get the
 * standard teen-only refusal.
 */

const ACCOUNT_UNAVAILABLE: SandboxError = {
  code: "account_unavailable",
  message: "This account isn't available. Please sign in again.",
};

/** Same refusal shape as the directory: never confirms an ineligible account exists. */
export const NO_IDENTITY_FOUND: SandboxError = {
  code: "unknown_recipient",
  message: "No TeenPay user found.",
  field: "recipient",
};

const MALFORMED: SandboxError = {
  code: "unknown_recipient",
  message: "Enter a TeenPay ID like @meera.",
  field: "recipient",
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
 * The actor's scoped state, if they may use TeenPay ID features: an
 * active teen acting on their own account. Authorization lives here,
 * never in the UI.
 */
function identityScope(db: SandboxDatabase, actorId: string): { ok: true } | SandboxError {
  const scope = scopeFor(db, actorId);
  if (!scope) return ACCOUNT_UNAVAILABLE;
  const denied = authorize(scope.state, actorId, "identity.use");
  if (denied) return denied;
  return { ok: true };
}

/** Stored timestamps never go backwards, even if the device clock does. */
function laterAt(at: string, previous: string): string {
  return at > previous ? at : previous;
}

// ── Availability ──────────────────────────────────────────────────

const availabilityCache = new WeakMap<SandboxDatabase, Map<string, SandboxResult<TeenPayIdAvailability>>>();

/**
 * Structured availability for one TeenPay ID: `available`, `taken`,
 * `reserved` or `invalid`, with the normalized form and a human
 * message. The result says nothing about *who* holds a taken id — no
 * account id, name or status leaks through it. The viewer's own
 * current ID reads as available (keeping it is a no-op).
 */
export function checkTeenPayIdAvailability(
  db: SandboxDatabase,
  viewerId: string,
  raw: string,
): SandboxResult<TeenPayIdAvailability> {
  let byViewer = availabilityCache.get(db);
  if (!byViewer) {
    byViewer = new Map();
    availabilityCache.set(db, byViewer);
  }
  const cacheKey = `${viewerId}|${raw}`;
  const cached = byViewer.get(cacheKey);
  if (cached) return cached;

  const result: SandboxResult<TeenPayIdAvailability> = (() => {
    const gate = identityScope(db, viewerId);
    if (isError(gate)) return { ok: false, error: gate };
    const viewer = db.accounts.find((a) => a.id === viewerId);
    const check = checkTeenPayId(raw, (normalized) =>
      db.accounts.some((a) => a.username === normalized && a.id !== viewerId),
    );
    // Keeping your own ID is always fine — the change is a no-op replay.
    if (check.problem === "taken" && viewer?.username === check.username) {
      return { ok: true, value: { status: "available", normalized: check.username, message: null } };
    }
    return { ok: true, value: availabilityFromCheck(check) };
  })();
  byViewer.set(cacheKey, result);
  return result;
}

// ── The safe public projection ────────────────────────────────────

const profileCache = new WeakMap<SandboxDatabase, Map<string, SandboxResult<IdentityProfile>>>();

/**
 * The canonical identity lookup: one exact TeenPay ID (with or
 * without "@", any case) in, a safe `IdentityProfile` out — public
 * profile, friendship relation, availability and favourite state, and
 * nothing else. Malformed input and unknown, closed, parent or
 * walletless accounts all read the same "No TeenPay user found.", so
 * the lookup never confirms that an ineligible account exists. The
 * viewer's own ID resolves as `self: true`.
 */
export function identityProfileFor(
  db: SandboxDatabase,
  viewerId: string,
  raw: unknown,
): SandboxResult<IdentityProfile> {
  let byViewer = profileCache.get(db);
  if (!byViewer) {
    byViewer = new Map();
    profileCache.set(db, byViewer);
  }
  const cacheKey = `${viewerId}|${typeof raw === "string" ? raw : ""}`;
  const cached = byViewer.get(cacheKey);
  if (cached) return cached;

  const result: SandboxResult<IdentityProfile> = (() => {
    const gate = identityScope(db, viewerId);
    if (isError(gate)) return { ok: false, error: gate };
    const username = parseTeenPayId(raw);
    if (!username) return { ok: false, error: MALFORMED };
    const account = db.accounts.find((a) => a.username === username);
    if (account?.id === viewerId) {
      return {
        ok: true,
        value: {
          profile: peerProfileOf(account),
          self: true,
          relation: null,
          available: isEligiblePeer(db, account),
          favourite: false,
        },
      };
    }
    if (!isEligiblePeer(db, account)) return { ok: false, error: NO_IDENTITY_FOUND };
    return {
      ok: true,
      value: {
        profile: peerProfileOf(account),
        self: false,
        relation: relationOf(db, viewerId, account.id),
        available: true,
        favourite: isFavourite(db, viewerId, username),
      },
    };
  })();
  byViewer.set(cacheKey, result);
  return result;
}

/**
 * Canonical identity search. Exact-match only — deliberately no fuzzy
 * or directory-wide browsing. Same privacy contract as
 * `identityProfileFor`.
 */
export function searchTeenPayId(
  db: SandboxDatabase,
  viewerId: string,
  raw: string,
): SandboxResult<IdentityProfile> {
  return identityProfileFor(db, viewerId, raw);
}

// ── Changing your own TeenPay ID ──────────────────────────────────

export interface ChangeTeenPayIdInput {
  actorId: string;
  at: string;
  /** "@rohan", "rohan" or "ROHAN" — normalized before anything else. */
  teenPayId: string;
}

export interface ChangeTeenPayIdOutcome {
  username: string;
  handle: string;
  /** True when the id was already the account's own — nothing changed. */
  replayed: boolean;
}

/**
 * Changes the actor's own TeenPay ID — the alias only.
 *
 * Deterministic order: gate → normalize → validate (format, reserved,
 * internal-id shape) → uniqueness → one atomic replace of the
 * account's alias fields. Asking for the id you already have is an
 * idempotent no-op replay.
 *
 * What is deliberately untouched: the account id (stable forever),
 * wallets, ledger, friendships (keyed by account id), money requests
 * (account ids + handle snapshots), favourites (saved handles),
 * notifications (historical text) and the QR payload format (it
 * simply carries the new handle next time). Nothing here can move
 * money or grant authority.
 */
export function changeTeenPayIdTransition(
  db: SandboxDatabase,
  input: ChangeTeenPayIdInput,
): PeerOutput<ChangeTeenPayIdOutcome> {
  const gate = identityScope(db, input.actorId);
  if (isError(gate)) return fail(db, gate);
  const account = db.accounts.find((a) => a.id === input.actorId);
  if (!account || account.role !== "teen" || account.status !== "active") {
    return fail(db, ACCOUNT_UNAVAILABLE);
  }

  const check = checkTeenPayId(input.teenPayId, (normalized) =>
    db.accounts.some((a) => a.username === normalized && a.id !== account.id),
  );
  if (check.problem) {
    return fail(db, {
      code: check.problem === "taken" ? "username_taken" : "invalid_account",
      message: check.message ?? "That ID isn't valid.",
    });
  }
  if (check.username === account.username) {
    // Asking for your own ID: nothing to change, deterministically.
    return done(db, {
      username: account.username,
      handle: formatTeenPayId(account.username),
      replayed: true,
    });
  }

  const updatedAt = laterAt(input.at, account.updatedAt);
  const updated: User = {
    ...account,
    username: check.username,
    identifier: `sandbox:${check.username}`,
    updatedAt,
  };
  const next: SandboxDatabase = {
    ...db,
    accounts: db.accounts.map((a) => (a.id === account.id ? updated : a)),
  };
  return done(next, {
    username: check.username,
    handle: formatTeenPayId(check.username),
    replayed: false,
  });
}
