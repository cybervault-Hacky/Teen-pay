import {
  checkUsername,
  formatUsername,
  initialsFor,
  normalizeUsername,
  type PeerProfile,
  type User,
  type Wallet,
} from "@/domain";
import { primaryWalletOf } from "./operations";
import type { SandboxDatabase, SandboxError } from "./types";

/**
 * The TeenPay directory — how one teen finds another.
 *
 *   "@meera" / "meera" / "sandbox:meera" ──▶ account ──▶ PeerProfile
 *
 * Lookups go by TeenPay ID (the username) or the sandbox sign-in
 * identifier, never by an internal id: an account, wallet or family id
 * typed into the box resolves to nothing. Results are `PeerProfile`s —
 * handle, name, initials — so no id, wallet, balance or family detail
 * ever reaches the UI.
 *
 * Eligible = an active teen account whose primary wallet exists and
 * isn't closed. Parents never appear (the teen-only rule: money between
 * a parent and a teen goes through pocket money). A frozen wallet still
 * appears — its owner is a real TeenPay user — but it can't receive
 * until it's unfrozen; the engine refuses that at send time without
 * saying why (another person's wallet state is private).
 */

export const PEER_SEARCH_MIN = 2;
export const PEER_SEARCH_LIMIT = 5;

export const NO_PEER_FOUND: SandboxError = {
  code: "unknown_recipient",
  message: "No TeenPay user found.",
  field: "recipient",
};

const MALFORMED: SandboxError = {
  code: "unknown_recipient",
  message: "Enter a TeenPay ID like @meera.",
  field: "recipient",
};

export function peerProfileOf(account: User): PeerProfile {
  return {
    handle: formatUsername(account),
    name: account.name,
    initials: account.avatarInitials || initialsFor(account.name),
  };
}

/** The account's primary wallet if it can take part in peer money. */
export function peerWallet(db: SandboxDatabase, account: User): Wallet | null {
  const wallet = primaryWalletOf(db.wallets, account.id);
  return wallet && wallet.status !== "closed" ? wallet : null;
}

export function isEligiblePeer(db: SandboxDatabase, account: User | null | undefined): account is User {
  return (
    !!account &&
    account.role === "teen" &&
    account.status === "active" &&
    peerWallet(db, account) !== null
  );
}

/**
 * Parses what someone typed into a TeenPay ID. Returns the normalized
 * username, or null when it can't be one.
 */
export function parseTeenPayId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 40) return null;
  const candidate = trimmed.toLowerCase().startsWith("sandbox:")
    ? trimmed.slice("sandbox:".length)
    : trimmed;
  const check = checkUsername(candidate);
  // "reserved" names are well-formed; they simply belong to nobody.
  return check.problem === null || check.problem === "reserved"
    ? normalizeUsername(candidate)
    : null;
}

/** Any account with this TeenPay ID, eligible or not (engine use only). */
export function accountByTeenPayId(db: SandboxDatabase, raw: unknown): User | null {
  const username = parseTeenPayId(raw);
  if (!username) return null;
  return db.accounts.find((a) => a.username === username) ?? null;
}

/**
 * Resolves a recipient for `viewerId`. Not found, not a teen, closed,
 * suspended, walletless — all read the same "No TeenPay user found.",
 * so the directory never confirms that an ineligible account exists.
 */
export function resolvePeer(
  db: SandboxDatabase,
  raw: unknown,
  viewerId: string,
  selfMessage = "You can't send money to yourself.",
): { ok: true; account: User; wallet: Wallet; profile: PeerProfile } | { ok: false; error: SandboxError } {
  const username = parseTeenPayId(raw);
  if (!username) return { ok: false, error: MALFORMED };
  const account = db.accounts.find((a) => a.username === username);
  if (account && account.id === viewerId) {
    return { ok: false, error: { code: "self_transfer", message: selfMessage, field: "recipient" } };
  }
  if (!isEligiblePeer(db, account)) return { ok: false, error: NO_PEER_FOUND };
  const wallet = peerWallet(db, account)!;
  return { ok: true, account, wallet, profile: peerProfileOf(account) };
}

/**
 * Eligible-user search for the recipient step. An exact TeenPay ID
 * wins outright (one unambiguous result). Otherwise, from 2
 * characters, handles and names that start with the query — at most
 * 5, never the viewer, never anyone ineligible. An empty result is the
 * UI's "No TeenPay user found."
 */
export function searchPeers(db: SandboxDatabase, viewerId: string, query: string): PeerProfile[] {
  const q = query.trim().replace(/^@+/, "").toLowerCase();
  if (q.length < PEER_SEARCH_MIN) return [];
  const eligible = db.accounts.filter((a) => a.id !== viewerId && isEligiblePeer(db, a));
  const exact = eligible.find((a) => a.username === q || a.identifier.toLowerCase() === q);
  if (exact) return [peerProfileOf(exact)];
  return eligible
    .filter(
      (a) =>
        a.username.startsWith(q) ||
        a.name
          .toLowerCase()
          .split(/\s+/)
          .some((word) => word.startsWith(q)),
    )
    .sort((a, b) => a.username.localeCompare(b.username))
    .slice(0, PEER_SEARCH_LIMIT)
    .map(peerProfileOf);
}

/** The profile behind an exact TeenPay ID, if eligible for `viewerId`. */
export function lookupPeer(db: SandboxDatabase, viewerId: string, raw: string): PeerProfile | null {
  const resolved = resolvePeer(db, raw, viewerId);
  return resolved.ok ? resolved.profile : null;
}
