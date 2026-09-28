import type { FamilyMembership } from "./family";
import {
  TEENPAY_ID_MAX,
  TEENPAY_ID_MIN,
  checkTeenPayId,
  normalizeTeenPayId,
  type TeenPayIdCheck,
  type TeenPayIdProblem,
} from "./identity";
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
 *
 * Phase 13: the TeenPay ID rules themselves (normalization, pattern,
 * reserved ids, internal-id refusal) live centrally in
 * `domain/identity.ts`. The names below are kept so existing call
 * sites stay untouched.
 */

export const USERNAME_MIN = TEENPAY_ID_MIN;
export const USERNAME_MAX = TEENPAY_ID_MAX;
export const DISPLAY_NAME_MAX = 40;

/** Trims, drops a leading "@", lowercases. */
export function normalizeUsername(raw: string): string {
  return normalizeTeenPayId(raw);
}

export type UsernameProblem = TeenPayIdProblem;

export type UsernameCheck = TeenPayIdCheck;

/**
 * Validates a TeenPay ID. `isTaken` receives the normalized value;
 * uniqueness is decided by whichever data provider owns accounts.
 */
export function checkUsername(
  raw: string,
  isTaken: (normalized: string) => boolean = () => false,
): UsernameCheck {
  return checkTeenPayId(raw, isTaken);
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
