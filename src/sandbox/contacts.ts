import {
  CONTACT_LIMIT,
  formatUsername,
  initialsFor,
  type Contact,
  type PeerProfile,
} from "@/domain";
import { authorize } from "./authorization";
import { accountByTeenPayId, isEligiblePeer, parseTeenPayId, peerProfileOf, resolvePeer } from "./peer";
import type { PeerOutput } from "./peer-transitions";
import { scopeFor } from "./scope";
import type { SandboxDatabase, SandboxError } from "./types";

/**
 * Favourites — the contact engine (Phase 9).
 *
 * Contacts are convenience data, never authority:
 *   · stored: owner + TeenPay ID + timestamps. No wallet or account id
 *     of the other person, no name snapshot, nothing private.
 *   · shown: resolved through the directory on every read, so a
 *     favourite always shows the person's *current* public profile —
 *     or "not available" if they no longer can take part.
 *   · used: Pay / Request hand only the TeenPay ID to the existing
 *     Send / Request flows, whose engine resolves and re-checks
 *     everything at confirm. A stale favourite can't move money.
 *
 * Owner-scoped: every transition acts on the actor's own list only
 * (`contacts.manage`, active teen). Removing a favourite changes that
 * list and nothing else — no history, request or other account.
 * Transitions are pure and all-or-nothing (the input database comes
 * back untouched on failure).
 */

/** What the UI gets for one favourite: public profile only. */
export interface ContactView extends PeerProfile {
  /** False when the person can't currently take part (closed, gone…). */
  available: boolean;
  savedAt: string;
}

const CONTACT_ID_PATTERN = /^ctc_[A-Za-z0-9_-]{6,100}$/;

const ACCOUNT_UNAVAILABLE: SandboxError = {
  code: "account_unavailable",
  message: "This account isn't available. Please sign in again.",
};

const INVALID_ID: SandboxError = {
  code: "invalid_transition",
  message: "Something went wrong, so nothing was changed. Please try again.",
};

const NOT_IN_LIST: SandboxError = {
  code: "unknown_contact",
  message: "That person isn't in your favourites.",
};

function fail<T>(db: SandboxDatabase, error: SandboxError): PeerOutput<T> {
  return { db, result: { ok: false, error } };
}

function done<T>(db: SandboxDatabase, value: T): PeerOutput<T> {
  return { db, result: { ok: true, value } };
}

/** The actor may manage their own favourites (active teen). */
function authorizeOwner(db: SandboxDatabase, actorId: string): SandboxError | null {
  const scope = scopeFor(db, actorId);
  if (!scope) return ACCOUNT_UNAVAILABLE;
  return authorize(scope.state, actorId, "contacts.manage");
}

/**
 * A favourite as the owner sees it. Available → the person's current
 * public profile. Not available → the saved handle only (their name
 * and the reason stay private, like the directory's "No TeenPay user
 * found.").
 */
function viewOf(db: SandboxDatabase, contact: Contact): ContactView {
  const account = accountByTeenPayId(db, contact.teenPayId);
  if (account && isEligiblePeer(db, account)) {
    return { ...peerProfileOf(account), available: true, savedAt: contact.createdAt };
  }
  const handle = `@${contact.teenPayId}`;
  return {
    handle,
    name: handle,
    initials: initialsFor(contact.teenPayId),
    available: false,
    savedAt: contact.createdAt,
  };
}

const viewCache = new WeakMap<SandboxDatabase, Map<string, ContactView[]>>();

/**
 * The viewer's favourites, resolved against current state, A→Z by
 * handle. Memoized per database snapshot and viewer.
 */
export function selectContactViews(db: SandboxDatabase, viewerId: string): ContactView[] {
  let byViewer = viewCache.get(db);
  if (!byViewer) {
    byViewer = new Map();
    viewCache.set(db, byViewer);
  }
  const cached = byViewer.get(viewerId);
  if (cached) return cached;
  const views = db.contacts
    .filter((c) => c.ownerAccountId === viewerId)
    .map((c) => viewOf(db, c))
    .sort((a, b) => a.handle.localeCompare(b.handle));
  byViewer.set(viewerId, views);
  return views;
}

/** Is this TeenPay ID in the viewer's favourites? */
export function isFavourite(db: SandboxDatabase, viewerId: string, teenPayId: string): boolean {
  const username = parseTeenPayId(teenPayId);
  return !!username && db.contacts.some((c) => c.ownerAccountId === viewerId && c.teenPayId === username);
}

/**
 * The viewer's favourite behind a TeenPay ID, resolved as a safe
 * profile — only while it's in their list *and* the person is
 * currently eligible. This is what Pay / Request from a favourite
 * start from; the engine checks again at confirm.
 */
export function lookupContact(db: SandboxDatabase, viewerId: string, teenPayId: string): PeerProfile | null {
  if (!isFavourite(db, viewerId, teenPayId)) return null;
  const resolved = resolvePeer(db, teenPayId, viewerId);
  return resolved.ok ? resolved.profile : null;
}

// ── Transitions ───────────────────────────────────────────────────

export interface AddContactInput {
  actorId: string;
  at: string;
  /** "@meera", "meera" or "sandbox:meera" — never an id. */
  teenPayId: string;
  /** Generated once per action (`ctc_…`); a repeat adds nothing. */
  contactId: string;
}

export interface AddContactOutcome {
  contact: ContactView;
  /** True when this answered a repeat of the same add. */
  replayed: boolean;
}

/**
 * Saves an eligible TeenPay teen to the actor's favourites. Refuses
 * self, unknown / closed / parent accounts (all "No TeenPay user
 * found."), malformed or id-shaped input, a person already saved, and
 * more than CONTACT_LIMIT. A frozen person can be saved (they're a
 * real, findable user); paying them is refused at send time.
 */
export function addContactTransition(
  db: SandboxDatabase,
  input: AddContactInput,
): PeerOutput<AddContactOutcome> {
  if (typeof input.contactId !== "string" || !CONTACT_ID_PATTERN.test(input.contactId)) {
    return fail(db, INVALID_ID);
  }
  const denied = authorizeOwner(db, input.actorId);
  if (denied) return fail(db, denied);

  const target = resolvePeer(db, input.teenPayId, input.actorId, "You can't add yourself to favourites.");
  if (!target.ok) {
    return fail(
      db,
      target.error.code === "self_transfer" ? { ...target.error, code: "self_contact" } : target.error,
    );
  }
  const username = target.account.username;

  // Same action again (double click, retry): answer from the record.
  const prior = db.contacts.find((c) => c.contactId === input.contactId);
  if (prior) {
    return prior.ownerAccountId === input.actorId && prior.teenPayId === username
      ? done(db, { contact: viewOf(db, prior), replayed: true })
      : fail(db, {
          code: "duplicate",
          message: "This action was already submitted with different details. Nothing was changed.",
        });
  }

  const mine = db.contacts.filter((c) => c.ownerAccountId === input.actorId);
  if (mine.some((c) => c.teenPayId === username)) {
    return fail(db, {
      code: "contact_exists",
      message: `${formatUsername(target.account)} is already in your favourites.`,
      field: "recipient",
    });
  }
  if (mine.length >= CONTACT_LIMIT) {
    return fail(db, {
      code: "contact_limit_reached",
      message: `You can keep up to ${CONTACT_LIMIT} favourites. Remove one to add another.`,
    });
  }

  const contact: Contact = {
    contactId: input.contactId,
    ownerAccountId: input.actorId,
    teenPayId: username,
    createdAt: input.at,
    updatedAt: input.at,
  };
  const next: SandboxDatabase = { ...db, contacts: [...db.contacts, contact] };
  return done(next, { contact: viewOf(next, contact), replayed: false });
}

export interface RemoveContactInput {
  actorId: string;
  at: string;
  teenPayId: string;
}

/**
 * Removes a favourite from the actor's own list — even if that person
 * has since become unavailable. Touches nothing else. Removing one
 * that isn't there is refused (nothing changes).
 */
export function removeContactTransition(
  db: SandboxDatabase,
  input: RemoveContactInput,
): PeerOutput<{ removed: string }> {
  const denied = authorizeOwner(db, input.actorId);
  if (denied) return fail(db, denied);
  const username = parseTeenPayId(input.teenPayId);
  if (!username) return fail(db, NOT_IN_LIST);
  const contact = db.contacts.find((c) => c.ownerAccountId === input.actorId && c.teenPayId === username);
  if (!contact) return fail(db, NOT_IN_LIST);
  return done(
    { ...db, contacts: db.contacts.filter((c) => c.contactId !== contact.contactId) },
    { removed: `@${username}` },
  );
}
