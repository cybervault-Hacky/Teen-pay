/**
 * Domain: favourites — a teen's saved TeenPay contacts (Phase 9).
 *
 * A contact is **convenience data, never authority**. It stores who
 * the owner saved (a TeenPay ID) and when — nothing about the other
 * person: no account or wallet id, no name snapshot, no family, no
 * balance. Every time it's shown or used it is resolved again through
 * the directory against current state, so a contact for someone who
 * has since closed their account (or been frozen) can never move
 * money: the peer engine re-checks everything at confirm.
 *
 * TeenPay IDs never change and are never reused (accounts are not
 * deleted, only closed), so the ID is a stable reference.
 *
 * Contacts are owner-scoped: only the owner sees, adds or removes
 * theirs. Removing one touches nothing else — not history, not
 * requests, not the other person's data.
 */
export interface Contact {
  /** `ctc_…` — the owner's own record id. */
  contactId: string;
  /** The teen who saved it. */
  ownerAccountId: string;
  /** Normalized TeenPay ID of the saved person, without "@" ("meera"). */
  teenPayId: string;
  /** ISO 8601. */
  createdAt: string;
  updatedAt: string;
}

/** How many favourites one teen can keep. */
export const CONTACT_LIMIT = 50;
