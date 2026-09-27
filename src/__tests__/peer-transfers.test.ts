import { describe, expect, it } from "vitest";
import { primaryWalletId } from "@/domain";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { lookupPeer, resolvePeer, searchPeers } from "@/sandbox/peer";
import { sendMoneyTransition, type SendMoneyInput } from "@/sandbox/peer-transitions";
import { REDACTED_PEER_ID, mergeScope, scopeFor } from "@/sandbox/scope";
import {
  getTransaction,
  selectPeerTransfers,
  selectSendableBalance,
  selectTotal,
  selectTransactions,
} from "@/sandbox/selectors";
import {
  SEED_PARENT_ID,
  SEED_PEER_ID,
  SEED_SAVE_SPACE_ID,
  SEED_TEEN_ID,
  buildSeedDatabase,
} from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT, balanceOf } from "./helpers/fixtures";

const AARAV_WALLET = primaryWalletId(SEED_TEEN_ID);
const MEERA_WALLET = primaryWalletId(SEED_PEER_ID);

function send(db: SandboxDatabase, overrides: Partial<SendMoneyInput> = {}) {
  return sendMoneyTransition(db, {
    actorId: SEED_TEEN_ID,
    at: AT,
    recipient: "@meera",
    amount: 250,
    idempotencyKey: "snd_key_0001",
    ...overrides,
  });
}

function totalMoney(db: SandboxDatabase): number {
  // Every wallet's derived balance, plus money in Spaces (it's still in the wallet's owner's hands).
  let sum = 0;
  for (const e of db.ledger) sum += e.direction === "credit" ? e.amount : -e.amount;
  return sum;
}

function withWalletStatus(db: SandboxDatabase, walletId: string, status: "active" | "frozen" | "closed"): SandboxDatabase {
  return { ...db, wallets: db.wallets.map((w) => (w.id === walletId ? { ...w, status } : w)) };
}

function withAccountStatus(db: SandboxDatabase, id: string, status: "active" | "suspended" | "closed"): SandboxDatabase {
  return { ...db, accounts: db.accounts.map((a) => (a.id === id ? { ...a, status } : a)) };
}

describe("TeenPay directory (privacy-safe recipient lookup)", () => {
  const db = buildSeedDatabase();

  it("finds eligible teens by TeenPay ID, @ID, sandbox identifier and name — display-safe fields only", () => {
    for (const q of ["@meera", "meera", "MEERA", "sandbox:meera", "Kap"]) {
      const results = searchPeers(db, SEED_TEEN_ID, q);
      expect(results).toEqual([{ handle: "@meera", name: "Meera Kapoor", initials: "MK" }]);
    }
    const profile = lookupPeer(db, SEED_TEEN_ID, "@meera")!;
    expect(Object.keys(profile).sort()).toEqual(["handle", "initials", "name"]);
    expect(JSON.stringify(profile)).not.toMatch(/usr_|wal_|fam_/);
  });

  it("never returns the viewer, parents, or anyone ineligible; short queries return nothing", () => {
    expect(searchPeers(db, SEED_TEEN_ID, "aarav")).toEqual([]);
    expect(searchPeers(db, SEED_TEEN_ID, "priya")).toEqual([]); // a parent isn't a peer
    expect(searchPeers(db, SEED_TEEN_ID, "m")).toEqual([]);
    expect(searchPeers(db, SEED_TEEN_ID, "nobody-here")).toEqual([]);
    expect(searchPeers(withAccountStatus(db, SEED_PEER_ID, "closed"), SEED_TEEN_ID, "meera")).toEqual([]);
    expect(searchPeers(withWalletStatus(db, MEERA_WALLET, "closed"), SEED_TEEN_ID, "meera")).toEqual([]);
    // Frozen is still findable (sending is refused with a clear reason).
    expect(searchPeers(withWalletStatus(db, MEERA_WALLET, "frozen"), SEED_TEEN_ID, "meera")).toHaveLength(1);
  });

  it("rejects internal ids, malformed identities, self and unknown users", () => {
    for (const raw of [SEED_PEER_ID, MEERA_WALLET, "fam_kapoor", "", "   ", "@", "@@meera!", "a b", 42, null]) {
      const result = resolvePeer(db, raw, SEED_TEEN_ID);
      expect(result.ok).toBe(false);
    }
    const self = resolvePeer(db, "@aarav", SEED_TEEN_ID);
    expect(!self.ok && self.error.code).toBe("self_transfer");
    const unknown = resolvePeer(db, "@ghost", SEED_TEEN_ID);
    expect(!unknown.ok && unknown.error.message).toBe("No TeenPay user found.");
  });
});

describe("sendMoney — one atomic transfer through postOperation", () => {
  it("moves ₹250 from Aarav's available balance to Meera's wallet in one operation, conserving money", () => {
    const db = buildSeedDatabase();
    const before = totalMoney(db);
    const out = send(db);
    expect(out.result).toMatchObject({ ok: true, value: { status: "completed", amount: 250, replayed: false } });
    const reference = out.result.ok && out.result.value.status === "completed" ? out.result.value.reference : "";
    expect(reference).toMatch(/^TRF-/);

    expect(balanceOf(out.db, SEED_TEEN_ID)).toBe(1850 - 250);
    expect(balanceOf(out.db, SEED_PEER_ID)).toBe(1200 + 250);
    expect(totalMoney(out.db)).toBe(before);

    const op = out.db.operations.find((o) => o.id === "snd_key_0001")!;
    expect(op).toMatchObject({ type: "transfer", amount: 250, currency: "INR", status: "completed", reference });
    const entries = out.db.ledger.filter((e) => e.operationId === op.id);
    expect(entries.map((e) => [e.walletId, e.type, e.direction, e.amount]).sort()).toEqual(
      [
        [AARAV_WALLET, "transfer_out", "debit", 250],
        [MEERA_WALLET, "transfer_in", "credit", 250],
      ].sort(),
    );
    // Same reference on both sides; created and completed at the same instant.
    expect(new Set(entries.map((e) => e.reference))).toEqual(new Set([reference]));
    expect(op.createdAt).toBe(AT);
  });

  it("records the send model: sender/recipient accounts and wallets, amount, currency, reference, status, key, initiator", () => {
    const out = send(buildSeedDatabase());
    const op = out.db.operations.find((o) => o.id === "snd_key_0001")!;
    const debit = out.db.ledger.find((e) => e.operationId === op.id && e.direction === "debit")!;
    const credit = out.db.ledger.find((e) => e.operationId === op.id && e.direction === "credit")!;
    expect(debit).toMatchObject({ accountId: SEED_TEEN_ID, walletId: AARAV_WALLET });
    expect(credit).toMatchObject({ accountId: SEED_PEER_ID, walletId: MEERA_WALLET });
    expect(op).toMatchObject({ actorId: SEED_TEEN_ID, currency: "INR", status: "completed", createdAt: AT });
  });

  it("is idempotent: the same key and details never post twice (double click, retry, refresh, stale screen)", () => {
    const first = send(buildSeedDatabase());
    const again = send(first.db);
    expect(again.db).toBe(first.db); // nothing written at all
    expect(again.result).toMatchObject({ ok: true, value: { status: "completed", replayed: true } });
    const firstRef = first.result.ok && first.result.value.status === "completed" && first.result.value.reference;
    const againRef = again.result.ok && again.result.value.status === "completed" && again.result.value.reference;
    expect(againRef).toBe(firstRef);
    expect(first.db.operations.filter((o) => o.type === "transfer" && o.id === "snd_key_0001")).toHaveLength(1);
    expect(balanceOf(again.db, SEED_TEEN_ID)).toBe(1600);

    // A retry via another spelling of the same recipient is the same send.
    expect(send(first.db, { recipient: "sandbox:meera" }).result.ok).toBe(true);
  });

  it("rejects the same key with different details (amount or recipient) — no second transfer", () => {
    const first = send(buildSeedDatabase());
    for (const change of [{ amount: 300 }, { recipient: "@priya" }]) {
      const out = send(first.db, change);
      expect(out.result).toMatchObject({ ok: false, error: { code: "duplicate" } });
      expect(out.db).toBe(first.db);
    }
  });

  it("rejects malformed idempotency keys", () => {
    for (const key of ["", "short", "has space here", "x".repeat(101), 7 as unknown as string]) {
      expect(send(buildSeedDatabase(), { idempotencyKey: key }).result.ok).toBe(false);
    }
  });

  it("validates amounts centrally: zero, negative, decimal, malformed, above the cap", () => {
    const db = buildSeedDatabase();
    for (const amount of [0, -5, 12.5, Number.NaN, Infinity, "100" as unknown as number, 1_000_000]) {
      const out = send(db, { amount });
      expect(out.result.ok).toBe(false);
      expect(out.db).toBe(db);
    }
  });

  it("spends only available money: ₹1,850 available with ₹800 in Save + ₹1,500 in a goal → sending ₹1,900 fails", () => {
    const db = buildSeedDatabase();
    const out = send(db, { amount: 1900 });
    expect(out.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(!out.result.ok && out.result.error.message).toMatch(/^Not enough available money\./);
    expect(out.db).toBe(db);
  });

  it("brief example: total ₹1,850 with ₹800 put in a Space → sending ₹1,200 fails, Space untouched", () => {
    // Make Aarav's wallet ₹1,850 in total: move the goal and Save back, then put ₹800 in Save.
    let db = buildSeedDatabase();
    const move = (amount: number, direction: "withdraw" | "add", spaceId: string, id: string) => {
      const scope = scopeFor(db, SEED_TEEN_ID)!;
      const out = moveSpaceMoneyTransition(scope.state, {
        actorId: SEED_TEEN_ID,
        at: AT,
        spaceId,
        amount,
        direction,
        operationId: id,
      });
      if (!out.result.ok) throw new Error(JSON.stringify(out.result));
      db = mergeScope(db, scope.info, scope.state, out.state);
    };
    move(800, "withdraw", SEED_SAVE_SPACE_ID, "mv_back_save");
    move(1500, "withdraw", "goal_bike", "mv_back_goal");
    // Spend down to a ₹1,850 total.
    const burn = send(db, { amount: 2300, idempotencyKey: "burn_down_01" });
    if (!burn.result.ok) throw new Error(JSON.stringify(burn.result));
    db = burn.db;
    move(800, "add", SEED_SAVE_SPACE_ID, "mv_in_save");

    const aarav = scopeFor(db, SEED_TEEN_ID)!.state;
    expect(selectTotal(aarav)).toBe(1850);
    expect(selectSendableBalance(aarav)).toBe(1050);
    const out = send(db, { amount: 1200, idempotencyKey: "snd_over_available" });
    expect(out.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(!out.result.ok && out.result.error.message).toBe("Not enough available money. You have ₹1,050 available.");
    expect(out.db).toBe(db);
    expect(send(db, { amount: 1050, idempotencyKey: "snd_exact_available" }).result.ok).toBe(true);
  });

  it("rejects sending to yourself in the domain (whatever the UI does)", () => {
    const db = buildSeedDatabase();
    for (const recipient of ["@aarav", "aarav", "sandbox:aarav"]) {
      const out = send(db, { recipient });
      expect(out.result).toMatchObject({ ok: false, error: { code: "self_transfer" } });
    }
  });

  it("is teen-only: parents can't send and can't be sent to", () => {
    const db = buildSeedDatabase();
    expect(send(db, { actorId: SEED_PARENT_ID }).result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(send(db, { recipient: "@priya" }).result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
  });

  it("wallet states: frozen/closed sender can't send; closed recipient rejected; frozen recipient refused (policy)", () => {
    const db = buildSeedDatabase();
    const frozenSender = send(withWalletStatus(db, AARAV_WALLET, "frozen"));
    expect(frozenSender.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    const closedSender = send(withWalletStatus(db, AARAV_WALLET, "closed"));
    expect(closedSender.result).toMatchObject({ ok: false, error: { code: "wallet_closed" } });
    const closedRecipient = send(withWalletStatus(db, MEERA_WALLET, "closed"));
    expect(closedRecipient.result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    const closedAccount = send(withAccountStatus(db, SEED_PEER_ID, "closed"));
    expect(closedAccount.result).toMatchObject({ ok: false, error: { message: "No TeenPay user found." } });
    const frozenRecipient = send(withWalletStatus(db, MEERA_WALLET, "frozen"));
    expect(frozenRecipient.result).toMatchObject({
      ok: false,
      error: { code: "wallet_frozen", message: "@meera can't receive money right now. Nothing was sent." },
    });
    for (const out of [frozenSender, closedSender, closedRecipient, closedAccount, frozenRecipient]) {
      expect(out.db.ledger).toHaveLength(db.ledger.length); // no partial transaction
    }
  });

  it("refuses closed or missing actor accounts (a stale session)", () => {
    const db = buildSeedDatabase();
    expect(send(withAccountStatus(db, SEED_TEEN_ID, "closed")).result.ok).toBe(false);
    expect(send(db, { actorId: "usr_ghost" }).result.ok).toBe(false);
  });

  it("notifies both sides once: 'You received ₹250.' and '₹250 sent to @meera.'", () => {
    const first = send(buildSeedDatabase());
    const fresh = first.db.notifications.filter((n) => n.id.startsWith("ntf_evt_p2p_"));
    expect(fresh.map((n) => [n.recipientId, n.title]).sort()).toEqual(
      [
        [SEED_PEER_ID, "You received ₹250."],
        [SEED_TEEN_ID, "₹250 sent to @meera."],
      ].sort(),
    );
    const again = send(first.db);
    expect(again.db.notifications.filter((n) => n.id.startsWith("ntf_evt_p2p_"))).toHaveLength(2);
  });
});

describe("Privacy and Activity for transfers", () => {
  const out = send(buildSeedDatabase());

  it("each side sees only its own leg, with the other side's @handle — never their account or wallet id", () => {
    const aarav = scopeFor(out.db, SEED_TEEN_ID)!.state;
    const meera = scopeFor(out.db, SEED_PEER_ID)!.state;
    expect(aarav.wallets.map((w) => w.id)).toEqual([AARAV_WALLET]);
    expect(meera.wallets.map((w) => w.id)).toEqual([MEERA_WALLET]);
    const aaravLeg = aarav.ledger.filter((e) => e.operationId === "snd_key_0001");
    const meeraLeg = meera.ledger.filter((e) => e.operationId === "snd_key_0001");
    expect(aaravLeg).toHaveLength(1);
    expect(meeraLeg).toHaveLength(1);
    expect(aaravLeg[0]!.counterparty).toMatchObject({ id: REDACTED_PEER_ID, handle: "@meera" });
    expect(meeraLeg[0]!.counterparty).toMatchObject({ id: REDACTED_PEER_ID, handle: "@aarav" });
    expect(JSON.stringify(aarav.operations.find((o) => o.id === "snd_key_0001"))).not.toContain(MEERA_WALLET);
    expect(JSON.stringify(meera.operations.find((o) => o.id === "snd_key_0001"))).not.toContain(AARAV_WALLET);
  });

  it("Activity reads 'Money sent −₹250' for the sender and 'Money received +₹250' for the recipient", () => {
    const aarav = scopeFor(out.db, SEED_TEEN_ID)!.state;
    const meera = scopeFor(out.db, SEED_PEER_ID)!.state;
    const sent = selectPeerTransfers(aarav)[0]!;
    const received = selectPeerTransfers(meera)[0]!;
    expect(sent.transaction).toMatchObject({ title: "Money sent", subtitle: "To @meera", amount: -250 });
    expect(received.transaction).toMatchObject({ title: "Money received", subtitle: "From @aarav", amount: 250 });
    const detail = getTransaction(aarav, sent.entryId)!;
    expect(detail).toMatchObject({ typeLabel: "Money sent", peer: { handle: "@meera", name: "Meera Kapoor" } });
    expect(detail.counterparty).toEqual({ label: "To", name: "@meera" });
    expect(JSON.stringify(detail)).not.toMatch(/usr_meera|wal_usr_meera|fam_kapoor/);
    expect(selectTransactions(aarav).some((t) => t.title === "Money sent")).toBe(true);
  });

  it("Meera's family and unrelated accounts see nothing of Aarav's family", () => {
    const meera = scopeFor(out.db, SEED_PEER_ID)!.state;
    expect(meera.users.map((u) => u.id)).not.toContain(SEED_PARENT_ID);
    expect(meera.spaces.every((s) => s.ownerAccountId === SEED_PEER_ID)).toBe(true);
    const priya = scopeFor(out.db, SEED_PARENT_ID)!.state; // unlinked: no teen data
    expect(priya.ledger.some((e) => e.operationId === "snd_key_0001")).toBe(false);
  });
});
