import type { FamilyMembership } from "./family";
import type { Account, UserRole } from "./user";

/**
 * An account together with its current family membership (active
 * first, else pending). Memberships are family-owned, so this is
 * always derived — never stored on the account.
 */
export interface AccountProfile extends Account {
  familyMembership: FamilyMembership | null;
}

/**
 * Domain: account creation rules — TeenPay IDs (usernames) and
 * display names. Pure and shared by the UI (live hints) and the
 * data layer (the rule that actually decides).
 */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;
export const DISPLAY_NAME_MAX = 40;

/** Lowercase letter first, then lowercase letters, digits, "_" or ".". */
const USERNAME_PATTERN = /^[a-z][a-z0-9_.]*$/;

/** Handles that would confuse people or impersonate the product. */
const RESERVED_USERNAMES = new Set([
  "admin",
  "administrator",
  "help",
  "moderator",
  "official",
  "parent",
  "root",
  "sandbox",
  "security",
  "support",
  "system",
  "teen",
  "teenpay",
]);

/** Trims, drops a leading "@", lowercases. */
export function normalizeUsername(raw: string): string {
  return raw.trim().replace(/^@+/, "").toLowerCase();
}

export type UsernameProblem =
  | "empty"
  | "too_short"
  | "too_long"
  | "invalid_start"
  | "invalid_characters"
  | "invalid_punctuation"
  | "reserved"
  | "taken";

const usernameMessages: Record<UsernameProblem, string> = {
  empty: "Choose a TeenPay ID.",
  too_short: `Use at least ${USERNAME_MIN} characters.`,
  too_long: `Use ${USERNAME_MAX} characters or fewer.`,
  invalid_start: "Start with a letter.",
  invalid_characters: "Use letters, numbers, dots or underscores only.",
  invalid_punctuation: "Dots and underscores can't repeat or come last.",
  reserved: "That ID is reserved. Try another.",
  taken: "That ID is already taken in this sandbox.",
};

export interface UsernameCheck {
  /** The normalized form that would be saved. */
  username: string;
  problem: UsernameProblem | null;
  /** Human message, or null when valid. */
  message: string | null;
}

/**
 * Validates a TeenPay ID. `isTaken` receives the normalized value;
 * uniqueness is decided by whichever data provider owns accounts.
 */
export function checkUsername(
  raw: string,
  isTaken: (normalized: string) => boolean = () => false,
): UsernameCheck {
  const username = normalizeUsername(raw);
  const problem = ((): UsernameProblem | null => {
    if (username.length === 0) return "empty";
    if (!/^[a-z]/.test(username)) return "invalid_start";
    if (!USERNAME_PATTERN.test(username)) return "invalid_characters";
    if (username.length < USERNAME_MIN) return "too_short";
    if (username.length > USERNAME_MAX) return "too_long";
    if (/[_.]{2,}/.test(username) || /[_.]$/.test(username)) {
      return "invalid_punctuation";
    }
    if (RESERVED_USERNAMES.has(username)) return "reserved";
    if (isTaken(username)) return "taken";
    return null;
  })();
  return {
    username,
    problem,
    message: problem ? usernameMessages[problem] : null,
  };
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/** Collapses whitespace; null when invalid with a reason. */
export function checkDisplayName(raw: string): {
  displayName: string;
  message: string | null;
} {
  const displayName = raw.replace(/\s+/g, " ").trim();
  if (displayName.length === 0) {
    return { displayName, message: "Enter a name." };
  }
  if (displayName.length > DISPLAY_NAME_MAX) {
    return { displayName, message: `Use ${DISPLAY_NAME_MAX} characters or fewer.` };
  }
  // No control characters or markup-looking input.
  if (/[<>]/.test(displayName) || hasControlCharacters(displayName)) {
    return { displayName, message: "Use letters, spaces and simple punctuation." };
  }
  return { displayName, message: null };
}

/** "Aarav Sharma" → "AS"; "Kabir" → "KA". */
export function initialsFor(name: string): string {
  const parts = name.split(" ").filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  const initials = last ? `${first[0] ?? ""}${last[0] ?? ""}` : first.slice(0, 2);
  return initials.toUpperCase() || "?";
}

/** What account creation collects — nothing more. */
export interface NewAccountInput {
  role: UserRole;
  displayName: string;
  username: string;
}
