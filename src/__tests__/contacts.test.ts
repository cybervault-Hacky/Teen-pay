import { describe, expect, it } from "vitest";
import { CONTACT_LIMIT, primaryWalletId, type Contact } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import {
  addContactTransition,
  isFavourite,
  lookupContact,
  removeContactTransition,
  selectContactViews,
  type AddContactInput,
} from "@/sandbox/contacts";
import { createMoneyRequestTransition, sendMoneyTransition } from "@/sandbox/peer-transitions";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID, buildSeedDatabase } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT, balanceOf } from "./helpers/fixtures";

/**
 * Phase 9 — favourites: owner-scoped convenience data that is never
 * authority. Stored as a TeenPay ID only; resolved on every use.
 */

const MEERA_WALLET = primaryWalletId(SEED_PEER_ID);
const LATER = "2026-09-26T07:00:00Z";

function add(db: SandboxDatabase, overrides: Partial<AddContactInput> = {}) {
  return addContactTransition(db, {
    actorId: SEED_TEEN_ID,
    at: AT,
    teenPayId: "@meera",
    contactId: "ctc_key_0001",
    ...overrides,
  });
}

function ok(output: { db: SandboxDatabase; result: { ok: boolean } }): SandboxDatabase {
  if (!output.result.ok) throw new Error(JSON.stringify(output.result));
  return output.db;
}

function withAccountStatus(db: SandboxDatabase, id: string, status: "active" | "suspended" | "closed"): SandboxDatabase {
  return { ...db, accounts: db.accounts.map((a) => (a.id === id ? { ...a, status } : a)) };
}

function withWalletStatus(db: SandboxDatabase, walletId: string, status: "active" | "frozen" | "closed"): SandboxDatabase {
  return { ...db, wallets: db.wallets.map((w) => (w.id === walletId ? { ...w, status } : w)) };
}

describe("add a favourite", () => {
  it("stores only owner + TeenPay ID + timestamps, and shows the current public profile", () => {
    const out = add(buildSeedDatabase());
    expect(out.result).toEqual({
      ok: true,
      value: {
        contact: { handle: "@meera", name: "Meera Kapoor", initials: "MK", available: true, savedAt: AT },
        replayed: false,
      },
    });
    expect(out.db.contacts).toEqual([
      { contactId: "ctc_key_0001", ownerAccountId: SEED_TEEN_ID, teenPayId: "meera", createdAt: AT, updatedAt: AT },
    ]);
    expect(JSON.stringify(out.db.contacts)).not.toMatch(/wal_|usr_meera|fam_|Kapoor/);
  });

  it("accepts @meera, meera, MEERA and sandbox:meera as the same person", () => {
    for (const teenPayId of ["meera", "MEERA", "sandbox:meera"]) {
      expect(add(buildSeedDatabase(), { teenPayId }).db.contacts[0]!.teenPayId).toBe("meera");
    }
  });

  it("moves no money and touches no other record", () => {
    const db = buildSeedDatabase();
    const next = ok(add(db));
    const { contacts: _a, ...before } = db;
    const { contacts: _b, ...after } = next;
    void _a;
    void _b;
    expect(after).toEqual(before);
  });

  it("a double click (same action) adds once and answers from the record", () => {
    const first = ok(add(buildSeedDatabase()));
    const again = add(first);
    expect(again.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(again.db).toBe(first);
    expect(first.contacts).toHaveLength(1);
  });

  it("the same action key reused for someone else is refused", () => {
    const first = ok(add(buildSeedDatabase()));
    const made = createAccount(first, { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    const reused = add(made.db, { teenPayId: "@kabirrao" });
    expect(reused.result).toMatchObject({ ok: false, error: { code: "duplicate" } });
    expect(reused.db).toBe(made.db);
  });

  it("prevents duplicates: saving the same person again changes nothing", () => {
    const first = ok(add(buildSeedDatabase()));
    const dup = add(first, { contactId: "ctc_key_0002" });
    expect(dup.result).toMatchObject({
      ok: false,
      error: { code: "contact_exists", message: "@meera is already in your favourites." },
    });
    expect(dup.db).toBe(first);
  });

  it("refuses yourself, unknown, parent, closed and malformed identities", () => {
    const db = buildSeedDatabase();
    expect(add(db, { teenPayId: "@aarav" }).result).toMatchObject({ ok: false, error: { code: "self_contact" } });
    const notFound = { ok: false, error: { code: "unknown_recipient", message: "No TeenPay user found." } };
    expect(add(db, { teenPayId: "@nobody" }).result).toMatchObject(notFound);
    expect(add(db, { teenPayId: "@priya" }).result).toMatchObject(notFound);
    expect(add(withAccountStatus(db, SEED_PEER_ID, "closed")).result).toMatchObject(notFound);
    expect(add(withWalletStatus(db, MEERA_WALLET, "closed")).result).toMatchObject(notFound);
    for (const teenPayId of ["", "@", "me era", "<script>", "a".repeat(80)]) {
      expect(add(db, { teenPayId }).result.ok).toBe(false);
    }
  });

  it("refuses internal ids (account, wallet, family) as an identity", () => {
    const db = buildSeedDatabase();
    for (const teenPayId of [SEED_PEER_ID, MEERA_WALLET, "fam_kapoor", "usr_meera"]) {
      const out = add(db, { teenPayId });
      expect(out.result.ok).toBe(false);
      expect(out.db).toBe(db);
    }
  });

  it("a frozen person can be saved (a real user) — paying them is refused later", () => {
    const frozen = withWalletStatus(buildSeedDatabase(), MEERA_WALLET, "frozen");
    const saved = ok(add(frozen));
    expect(selectContactViews(saved, SEED_TEEN_ID)[0]).toMatchObject({ handle: "@meera", available: true });
    const sent = sendMoneyTransition(saved, { actorId: SEED_TEEN_ID, at: AT, recipient: "@meera", amount: 50, idempotencyKey: "snd_fav_frozen" });
    expect(sent.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    expect(sent.db).toBe(saved);
  });

  it("only active teens keep favourites; a malformed action key is refused", () => {
    const db = buildSeedDatabase();
    expect(add(db, { actorId: SEED_PARENT_ID }).result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(add(db, { actorId: "usr_ghost" }).result).toMatchObject({ ok: false, error: { code: "account_unavailable" } });
    expect(add(withAccountStatus(db, SEED_TEEN_ID, "closed")).result.ok).toBe(false);
    for (const contactId of ["", "ctc_", "abc_123456", "ctc_<script>", 42 as unknown as string]) {
      expect(add(db, { contactId }).result.ok).toBe(false);
    }
  });

  it(`keeps at most ${CONTACT_LIMIT}`, () => {
    const db = buildSeedDatabase();
    const filler: Contact[] = Array.from({ length: CONTACT_LIMIT }, (_, i) => ({
      contactId: `ctc_fill_${String(i).padStart(4, "0")}`,
      ownerAccountId: SEED_TEEN_ID,
      teenPayId: `filler${i}`,
      createdAt: AT,
      updatedAt: AT,
    }));
    const full = { ...db, contacts: filler };
    expect(add(full).result).toMatchObject({ ok: false, error: { code: "contact_limit_reached" } });
  });
});

describe("remove a favourite", () => {
  function setup() {
    let db = ok(add(buildSeedDatabase()));
    // Meera saves Aarav too; and there's history between them.
    db = ok(addContactTransition(db, { actorId: SEED_PEER_ID, at: AT, teenPayId: "@aarav", contactId: "ctc_meera_0001" }));
    db = ok(sendMoneyTransition(db, { actorId: SEED_TEEN_ID, at: AT, recipient: "@meera", amount: 100, idempotencyKey: "snd_hist_0001" }));
    db = ok(createMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, payer: "@meera", amount: 40, idempotencyKey: "prq_hist_0001" }));
    return db;
  }

  it("changes only the owner's list — history, requests and the other person's favourites stay", () => {
    const db = setup();
    const out = removeContactTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "@meera" });
    expect(out.result).toEqual({ ok: true, value: { removed: "@meera" } });
    expect(out.db.contacts).toEqual([db.contacts.find((c) => c.ownerAccountId === SEED_PEER_ID)]);
    expect(out.db.ledger).toBe(db.ledger);
    expect(out.db.operations).toBe(db.operations);
    expect(out.db.peerRequests).toBe(db.peerRequests);
    expect(out.db.notifications).toBe(db.notifications);
    expect(balanceOf(out.db, SEED_PEER_ID)).toBe(1300);
  });

  it("removing someone not in the list is refused and changes nothing", () => {
    const db = setup();
    for (const teenPayId of ["@kabir", "usr_meera", ""]) {
      const out = removeContactTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId });
      expect(out.result).toMatchObject({ ok: false, error: { code: "unknown_contact" } });
      expect(out.db).toBe(db);
    }
  });

  it("works even after that person became unavailable", () => {
    const db = withAccountStatus(setup(), SEED_PEER_ID, "closed");
    const out = removeContactTransition(db, { actorId: SEED_TEEN_ID, at: LATER, teenPayId: "meera" });
    expect(out.result.ok).toBe(true);
    expect(out.db.contacts.filter((c) => c.ownerAccountId === SEED_TEEN_ID)).toEqual([]);
  });

  it("nobody can remove someone else's favourite", () => {
    const db = setup();
    // Meera tries to remove "@meera" — that's Aarav's record, not hers.
    const out = removeContactTransition(db, { actorId: SEED_PEER_ID, at: LATER, teenPayId: "@meera" });
    expect(out.result.ok).toBe(false);
    expect(out.db).toBe(db);
    expect(removeContactTransition(db, { actorId: SEED_PARENT_ID, at: LATER, teenPayId: "@meera" }).result).toMatchObject({
      ok: false,
      error: { code: "not_permitted" },
    });
  });
});

describe("contacts are owner-scoped and never authority", () => {
  it("a scope holds only the viewer's favourites; nobody else's leak", () => {
    let db = ok(add(buildSeedDatabase()));
    db = ok(addContactTransition(db, { actorId: SEED_PEER_ID, at: AT, teenPayId: "@aarav", contactId: "ctc_meera_0001" }));
    expect(scopeFor(db, SEED_TEEN_ID)!.state.contacts.map((c) => c.teenPayId)).toEqual(["meera"]);
    expect(scopeFor(db, SEED_PEER_ID)!.state.contacts.map((c) => c.teenPayId)).toEqual(["aarav"]);
    expect(scopeFor(db, SEED_PARENT_ID)!.state.contacts).toEqual([]);
    expect(selectContactViews(db, SEED_PARENT_ID)).toEqual([]);
  });

  it("a scoped view can't write favourites (only the contact engine can)", () => {
    const db = buildSeedDatabase();
    const scope = scopeFor(db, SEED_TEEN_ID)!;
    const forged = {
      ...scope.state,
      contacts: [{ contactId: "ctc_forged_01", ownerAccountId: SEED_PEER_ID, teenPayId: "aarav", createdAt: AT, updatedAt: AT }],
    };
    expect(() => mergeScope(db, scope.info, scope.state, forged)).toThrow(/Favourites/);
  });

  it("a stale favourite shows as unavailable (no name, no reason) and can't move money", () => {
    const saved = ok(add(buildSeedDatabase()));
    const closed = withAccountStatus(saved, SEED_PEER_ID, "closed");
    const [view] = selectContactViews(closed, SEED_TEEN_ID);
    expect(view).toEqual({ handle: "@meera", name: "@meera", initials: "ME", available: false, savedAt: AT });
    expect(lookupContact(closed, SEED_TEEN_ID, "@meera")).toBeNull();
    const sent = sendMoneyTransition(closed, { actorId: SEED_TEEN_ID, at: LATER, recipient: "@meera", amount: 100, idempotencyKey: "snd_stale_001" });
    expect(sent.result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    expect(sent.db).toBe(closed);
    const asked = createMoneyRequestTransition(closed, { actorId: SEED_TEEN_ID, at: LATER, payer: "@meera", amount: 100, idempotencyKey: "prq_stale_001" });
    expect(asked.result.ok).toBe(false);
    expect(asked.db).toBe(closed);
  });

  it("lookup needs both: in the list, and eligible now", () => {
    const db = buildSeedDatabase();
    expect(lookupContact(db, SEED_TEEN_ID, "@meera")).toBeNull(); // eligible, not saved
    const saved = ok(add(db));
    expect(lookupContact(saved, SEED_TEEN_ID, "@meera")).toEqual({ handle: "@meera", name: "Meera Kapoor", initials: "MK" });
    expect(isFavourite(saved, SEED_TEEN_ID, "MEERA")).toBe(true);
    expect(isFavourite(saved, SEED_PEER_ID, "@meera")).toBe(false);
  });

  it("views are memoized per database snapshot and sorted by handle", () => {
    let db = ok(add(buildSeedDatabase()));
    const made = createAccount(db, { role: "teen", displayName: "Arjun Mehta", username: "arjun" }, AT);
    if ("code" in made) throw new Error(made.message);
    db = ok(add(made.db, { teenPayId: "@arjun", contactId: "ctc_key_0002" }));
    const views = selectContactViews(db, SEED_TEEN_ID);
    expect(views.map((v) => v.handle)).toEqual(["@arjun", "@meera"]);
    expect(selectContactViews(db, SEED_TEEN_ID)).toBe(views);
  });
});
