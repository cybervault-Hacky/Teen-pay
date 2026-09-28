import type { PeerProfile } from "./peer";
import type { FriendRelation } from "./friend";

/**
 * Domain: TeenPay ID — the product's identity layer (Phase 13).
 *
 * Every person on TeenPay has exactly three names, with strictly
 * separate jobs:
 *
 *   internal account id   `usr_aarav`    accounting ownership — stable,
 *                                        private, never reused, never
 *                                        shown or typed anywhere
 *   display name          `Aarav Sharma` what friends and family see
 *   TeenPay ID            `@aarav`       the stable public identity —
 *                                        discovery, payments, requests,
 *                                        friends, favourites and QR all
 *                                        resolve through it
 *
 * The TeenPay ID is an *alias* over the internal account: money flows
 * always resolve it to the account id before anything is written, so
 * changing an ID can never move money, re-target a friendship or
 * hijack someone's history.
 *
 * Everything here is pure and deterministic — no clock, no network.
 */

export const TEENPAY_ID_MIN = 3;
export const TEENPAY_ID_MAX = 20;

/**
 * The TeenPay ID alphabet, deliberately conservative: a lowercase
 * letter first, then lowercase letters, digits, "." or "_". No spaces,
 * no emoji, no slashes or query strings, no uppercase (it's folded
 * away by normalization), no unexpected Unicode — anything outside this
 * pattern is invalid, including lookalike characters from other
 * scripts.
 */
export const TEENPAY_ID_PATTERN = /^[a-z][a-z0-9_.]*$/;

/**
 * Ids the product keeps for itself. Centralized here so future
 * changes touch one list — validation everywhere else just asks.
 */
export const RESERVED_TEENPAY_IDS: readonly string[] = [
  "admin",
  "administrator",
  "api",
  "family",
  "guardian",
  "help",
  "moderator",
  "official",
  "parent",
  "payments",
  "root",
  "sandbox",
  "security",
  "support",
  "system",
  "teen",
  "teenpay",
  "wallet",
];

/**
 * Prefixes of the sandbox's internal record ids (accounts, wallets,
 * families, members, recipients, requests, operations, contacts…).
 * A new TeenPay ID can't start with one (it reads as "reserved"), and
 * the directory and QR parser refuse such input, so an internal id can
 * never pass for — or be looked up as — a person.
 */
export const INTERNAL_ID_PREFIXES = [
  "usr", "wal", "fam", "mem", "rec", "acc", "inv", "ctc", "prq", "p2p", "snd",
  "trf", "apr", "ntf", "evt", "req", "pay", "pms", "spc", "space", "goal", "seed",
  "frd",
] as const;

const INTERNAL_ID_PATTERN = new RegExp(`^(${INTERNAL_ID_PREFIXES.join("|")})_`, "i");

/** True for strings shaped like an internal record id (`usr_…`, `wal_…`). */
export function looksLikeInternalId(value: string): boolean {
  return INTERNAL_ID_PATTERN.test(value.trim().replace(/^@+/, ""));
}

/**
 * The one normalization: trim, drop leading "@"s, lowercase. "@Aarav",
 * "AARAV" and " aarav " all become "aarav" — case can never fork two
 * identities.
 */
export function normalizeTeenPayId(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

/** The display form: "aarav" → "@aarav". */
export function formatTeenPayId(username: string): string {
  return `@${username}`;
}

/** Reserved product ids can never be claimed. */
export function isReservedTeenPayId(normalized: string): boolean {
  return RESERVED_TEENPAY_IDS.includes(normalized);
}

/** Well-formed (ignoring uniqueness) — used for persisted data and route params. */
export function isValidTeenPayIdFormat(value: string): boolean {
  return (
    value.length >= TEENPAY_ID_MIN &&
    value.length <= TEENPAY_ID_MAX &&
    TEENPAY_ID_PATTERN.test(value) &&
    !/[_.]{2,}/.test(value) &&
    !/[_.]$/.test(value)
  );
}

export type TeenPayIdProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_start"
  | "invalid_characters"
  | "invalid_punctuation"
  | "reserved"
  | "taken";

const problemMessages: Record<TeenPayIdProblem, string> = {
  empty: "Choose a TeenPay ID.",
  too_short: `Use at least ${TEENPAY_ID_MIN} characters.`,
  too_long: `Use ${TEENPAY_ID_MAX} characters or fewer.`,
  invalid_start: "Start with a letter.",
  invalid_characters: "Use letters, numbers, dots or underscores only.",
  invalid_punctuation: "Dots and underscores can't repeat or come last.",
  reserved: "That ID is reserved. Try another.",
  taken: "That ID is already taken in this sandbox.",
};

export interface TeenPayIdCheck {
  /** The normalized form that would be saved. */
  username: string;
  problem: TeenPayIdProblem | null;
  /** Human message, or null when valid. */
  message: string | null;
}

/**
 * Validates a TeenPay ID. `isTaken` receives the normalized value;
 * uniqueness is decided by whichever data provider owns accounts, so
 * the check works identically at creation, at change time and in a
 * future server-backed store.
 */
export function checkTeenPayId(
  raw: string,
  isTaken: (normalized: string) => boolean = () => false,
): TeenPayIdCheck {
  const username = normalizeTeenPayId(raw);
  const problem = ((): TeenPayIdProblem | null => {
    if (username.length === 0) return "empty";
    if (!/^[a-z]/.test(username)) return "invalid_start";
    if (!TEENPAY_ID_PATTERN.test(username)) return "invalid_characters";
    if (username.length < TEENPAY_ID_MIN) return "too_short";
    if (username.length > TEENPAY_ID_MAX) return "too_long";
    if (/[_.]{2,}/.test(username) || /[_.]$/.test(username)) {
      return "invalid_punctuation";
    }
    if (isReservedTeenPayId(username) || looksLikeInternalId(username)) return "reserved";
    if (isTaken(username)) return "taken";
    return null;
  })();
  return {
    username,
    problem,
    message: problem ? problemMessages[problem] : null,
  };
}

// ── Availability ──────────────────────────────────────────────────

export type TeenPayIdAvailabilityStatus =
  | "available"
  | "taken"
  | "reserved"
  | "invalid";

/** Structured availability — the UI never needs more than this. */
export interface TeenPayIdAvailability {
  status: TeenPayIdAvailabilityStatus;
  /** The normalized id that was checked. */
  normalized: string;
  /** Human message; null only when available. */
  message: string | null;
}

/** Maps a validation result onto the availability vocabulary. */
export function availabilityFromCheck(check: TeenPayIdCheck): TeenPayIdAvailability {
  if (check.problem === null) {
    return { status: "available", normalized: check.username, message: null };
  }
  if (check.problem === "taken") {
    return { status: "taken", normalized: check.username, message: check.message };
  }
  if (check.problem === "reserved") {
    return { status: "reserved", normalized: check.username, message: check.message };
  }
  return { status: "invalid", normalized: check.username, message: check.message };
}

// ── The safe public identity projection ───────────────────────────

/**
 * What identity lookup is allowed to say about a person — the same
 * surface the directory already makes public (handle, name, initials)
 * plus the viewer's own relationship and action state. Built
 * centrally by the identity engine; never by spreading account
 * objects. Never contains: account/wallet/family ids, balances,
 * history, Spaces, coach or mission data, guardian settings,
 * notifications or security events.
 */
export interface IdentityProfile {
  profile: PeerProfile;
  /** The viewer themselves (identity pages handle "you" gracefully). */
  self: boolean;
  /** Friend Circles relationship, when the viewer is a teen. */
  relation: FriendRelation | null;
  /** Whether this teen can currently take part in peer money. */
  available: boolean;
  /** Whether the viewer keeps them as a favourite. */
  favourite: boolean;
}
