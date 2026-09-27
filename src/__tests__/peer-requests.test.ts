import { describe, expect, it } from "vitest";
import { PEER_REQUEST_TTL_DAYS, peerRequestExpiresAt } from "@/domain";
import {
  acceptMoneyRequestTransition,
  cancelMoneyRequestTransition,
  createMoneyRequestTransition,
  declineMoneyRequestTransition,
  expireMoneyRequestsTransition,
  requestIdFor,
  requestPaymentId,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { spentOnDay } from "@/sandbox/rules";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import {
  getTransaction,
  selectIncomingRequests,
  selectOutgoingRequests,
  selectPeerRequest,
  selectRelatedPayment,
  selectRequestHistory,
  selectSpaces,
} from "@/sandbox/selectors";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID, buildSeedDatabase } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT, balanceOf } from "./helpers/fixtures";

const KEY = "prq_key_0001";
const REQUEST_ID = requestIdFor(KEY);
const LATER = "2026-09-26T08:00:00Z";
const AFTER_EXPIRY = new Date(Date.parse(AT) + PEER_REQUEST_TTL_DAYS * 86_400_000 + 1000).toISOString();

/** Aarav asks Meera for ₹300 ("Movie tickets"). */
function created(db: SandboxDatabase = buildSeedDatabase(), overrides: Record<string, unknown> = {}) {
  const out = createMoneyRequestTransition(db, {
    actorId: SEED_TEEN_ID,
    at: AT,
    payer: "@meera",
    amount: 300,
    note: "Movie tickets",
    idempotencyKey: KEY,
    ...overrides,
  });
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.db;
}

const asMeera = { actorId: SEED_PEER_ID, requestId: REQUEST_ID };
const asAarav = { actorId: SEED_TEEN_ID, requestId: REQUEST_ID };

function fresh(db: SandboxDatabase, prefix: string) {
  return db.notifications.filter((n) => n.id.startsWith(prefix));
}

describe("creating a request", () => {
  it("records a pending request visible to both sides and moves no money", () => {
    const seed = buildSeedDatabase();
    const db = created(seed);
    expect(db.ledger).toBe(seed.ledger);
    expect(db.operations).toBe(seed.operations);
    const request = db.peerRequests[0]!;
    expect(request).toMatchObject({
      requestId: REQUEST_ID,
      requesterAccountId: SEED_TEEN_ID,
      requesterWalletId: "wal_usr_aarav",
      payerAccountId: SEED_PEER_ID,
      payerWalletId: "wal_usr_meera",
      amount: 300,
      currency: "INR",
      note: "Movie tickets",
      status: "pending",
      idempotencyKey: KEY,
      createdAt: AT,
      updatedAt: AT,
      expiresAt: peerRequestExpiresAt(AT),
    });
    expect(request.respondedAt).toBeUndefined();
    expect(request.resultingPaymentReference).toBeUndefined();
    expect(request.expiresAt).toBe("2026-10-03T06:00:00.000Z"); // 7 days

    const aarav = scopeFor(db, SEED_TEEN_ID)!.state;
    const meera = scopeFor(db, SEED_PEER_ID)!.state;
    expect(selectOutgoingRequests(aarav, AT)).toMatchObject([
      { direction: "outgoing", amount: 300, party: { handle: "@meera" }, status: "pending" },
    ]);
    expect(selectIncomingRequests(meera, AT)).toMatchObject([
      { direction: "incoming", amount: 300, party: { handle: "@aarav", name: "Aarav Sharma" }, note: "Movie tickets" },
    ]);
    expect(JSON.stringify(selectIncomingRequests(meera, AT))).not.toMatch(/usr_|wal_|fam_/);
    // Balances and daily totals untouched.
    expect(balanceOf(db, SEED_TEEN_ID)).toBe(1850);
    expect(balanceOf(db, SEED_PEER_ID)).toBe(1200);
    expect(spentOnDay(db.ledger, AT, "wal_usr_meera")).toBe(0);
  });

  it("notifies: requester 'Money request sent.', payer '@aarav requested ₹300.'", () => {
    const db = created();
    expect(fresh(db, `ntf_evt_prq_${REQUEST_ID}`).map((n) => [n.recipientId, n.title]).sort()).toEqual(
      [
        [SEED_PEER_ID, "@aarav requested ₹300."],
        [SEED_TEEN_ID, "Money request sent."],
      ].sort(),
    );
  });

  it("is idempotent by key; a different payload under the same key is rejected", () => {
    const db = created();
    const again = createMoneyRequestTransition(db, {
      actorId: SEED_TEEN_ID, at: LATER, payer: "@meera", amount: 300, note: "Movie tickets", idempotencyKey: KEY,
    });
    expect(again.db).toBe(db);
    expect(again.result).toMatchObject({ ok: true, value: { requestId: REQUEST_ID, replayed: true } });
    const changed = createMoneyRequestTransition(db, {
      actorId: SEED_TEEN_ID, at: LATER, payer: "@meera", amount: 301, idempotencyKey: KEY,
    });
    expect(changed.result).toMatchObject({ ok: false, error: { code: "duplicate" } });
    expect(db.peerRequests).toHaveLength(1);
  });

  it("validates amount, note, self and recipient", () => {
    const db = buildSeedDatabase();
    const attempt = (over: Record<string, unknown>) =>
      createMoneyRequestTransition(db, {
        actorId: SEED_TEEN_ID, at: AT, payer: "@meera", amount: 300, idempotencyKey: "prq_bad_0001", ...over,
      } as never).result;
    expect(attempt({ amount: 0 }).ok).toBe(false);
    expect(attempt({ amount: 10.5 }).ok).toBe(false);
    expect(attempt({ note: "x".repeat(61) }).ok).toBe(false);
    expect(attempt({ payer: "@aarav" })).toMatchObject({ ok: false, error: { code: "self_transfer" } });
    expect(attempt({ payer: "@priya" }).ok).toBe(false);
    expect(attempt({ payer: "usr_meera" }).ok).toBe(false);
    expect(attempt({ actorId: SEED_PARENT_ID }).ok).toBe(false);
  });
});

describe("accepting", () => {
  it("transfers exactly once, marks accepted with the reference, and shows 'Money request paid +₹300'", () => {
    const db = created();
    const out = acceptMoneyRequestTransition(db, { ...asMeera, at: LATER });
    expect(out.result).toMatchObject({ ok: true, value: { status: "completed", amount: 300, replayed: false } });
    const reference = out.result.ok && out.result.value.status === "completed" ? out.result.value.reference : "";
    const request = out.db.peerRequests[0]!;
    expect(request).toMatchObject({
      status: "accepted",
      respondedAt: LATER,
      updatedAt: LATER,
      resultingPaymentReference: reference,
    });
    const op = out.db.operations.find((o) => o.id === requestPaymentId(REQUEST_ID))!;
    expect(op).toMatchObject({ type: "transfer", requestId: REQUEST_ID, amount: 300, reference });
    expect(balanceOf(out.db, SEED_PEER_ID)).toBe(900);
    expect(balanceOf(out.db, SEED_TEEN_ID)).toBe(2150);

    const aarav = scopeFor(out.db, SEED_TEEN_ID)!.state;
    const paid = selectRelatedPayment(aarav, REQUEST_ID)!;
    expect(paid.transaction).toMatchObject({ title: "Money request paid", amount: 300, subtitle: "From @meera · Request" });
    const detail = getTransaction(aarav, paid.entryId)!;
    expect(detail.request).toMatchObject({ direction: "outgoing", note: "Movie tickets", statusLabel: "Accepted" });
    expect(selectRequestHistory(aarav, LATER)).toMatchObject([{ status: "accepted", reference }]);

    const meera = scopeFor(out.db, SEED_PEER_ID)!.state;
    expect(selectRelatedPayment(meera, REQUEST_ID)!.transaction).toMatchObject({ title: "Money sent", amount: -300 });

    // Notices: requester "₹300 request was paid.", payer "₹300 sent to @aarav."
    const notices = fresh(out.db, "ntf_evt_p2p_").map((n) => [n.recipientId, n.title]).sort();
    expect(notices).toEqual(
      [
        [SEED_PEER_ID, "₹300 sent to @aarav."],
        [SEED_TEEN_ID, "₹300 request was paid."],
      ].sort(),
    );
  });

  it("double accept (double click, stale screen, retry) → one transfer, same reference", () => {
    const first = acceptMoneyRequestTransition(created(), { ...asMeera, at: LATER });
    const second = acceptMoneyRequestTransition(first.db, { ...asMeera, at: "2026-09-26T09:00:00Z" });
    expect(second.db).toBe(first.db);
    expect(second.result).toMatchObject({ ok: true, value: { status: "completed", replayed: true } });
    expect(first.db.operations.filter((o) => o.requestId === REQUEST_ID)).toHaveLength(1);
    expect(first.db.ledger.filter((e) => e.requestId === REQUEST_ID)).toHaveLength(2);
  });

  it("insufficient funds: nothing moves, request stays pending — Spaces are protected (available ₹500 + Save ₹1,000 → ₹700 fails)", () => {
    // Aarav: put ₹200 more in Save (→ ₹1,000), then send ₹1,150 away (→ ₹500 available).
    let db = buildSeedDatabase();
    const scope = scopeFor(db, SEED_TEEN_ID)!;
    const moved = moveSpaceMoneyTransition(scope.state, {
      actorId: SEED_TEEN_ID, at: AT, spaceId: SEED_SAVE_SPACE_ID, amount: 200, direction: "add", operationId: "mv_save_200",
    });
    if (!moved.result.ok) throw new Error("move failed");
    db = mergeScope(db, scope.info, scope.state, moved.state);
    const burn = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID, at: AT, recipient: "@meera", amount: 1150, idempotencyKey: "snd_burn_0001",
    });
    if (!burn.result.ok) throw new Error("burn failed");
    db = burn.db;
    // Meera asks Aarav for ₹700.
    const req = createMoneyRequestTransition(db, {
      actorId: SEED_PEER_ID, at: AT, payer: "@aarav", amount: 700, idempotencyKey: "prq_meera_700",
    });
    if (!req.result.ok) throw new Error("request failed");
    db = req.db;
    const aaravBefore = scopeFor(db, SEED_TEEN_ID)!.state;
    expect(balanceOf(db, SEED_TEEN_ID)).toBe(500);
    expect(selectSpaces(aaravBefore, AT).find((s) => s.id === SEED_SAVE_SPACE_ID)!.balance).toBe(1000);

    const out = acceptMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, requestId: requestIdFor("prq_meera_700"), at: LATER });
    expect(out.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(!out.result.ok && out.result.error.message).toMatch(/^Not enough available money\./);
    expect(out.db).toBe(db);
    expect(db.peerRequests.find((r) => r.requestId === requestIdFor("prq_meera_700"))!.status).toBe("pending");
    expect(selectSpaces(scopeFor(out.db, SEED_TEEN_ID)!.state, AT).find((s) => s.id === SEED_SAVE_SPACE_ID)!.balance).toBe(1000);
  });

  it("re-validates wallets on accept: frozen payer or closed requester → nothing moves", () => {
    const db = created();
    const frozen = { ...db, wallets: db.wallets.map((w) => (w.id === "wal_usr_meera" ? { ...w, status: "frozen" as const } : w)) };
    expect(acceptMoneyRequestTransition(frozen, { ...asMeera, at: LATER }).result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    const closed = { ...db, wallets: db.wallets.map((w) => (w.id === "wal_usr_aarav" ? { ...w, status: "closed" as const } : w)) };
    const out = acceptMoneyRequestTransition(closed, { ...asMeera, at: LATER });
    expect(out.result.ok).toBe(false);
    expect(out.db.peerRequests[0]!.status).toBe("pending");
  });
});

describe("declining and cancelling (no money ever moves)", () => {
  it("the payer declines → declined, requester told 'Money request declined.'", () => {
    const db = created();
    const out = declineMoneyRequestTransition(db, { ...asMeera, at: LATER });
    expect(out.result).toMatchObject({ ok: true, value: { status: "declined" } });
    expect(out.db.ledger).toBe(db.ledger);
    expect(out.db.peerRequests[0]).toMatchObject({ status: "declined", respondedAt: LATER });
    expect(fresh(out.db, "ntf_evt_prq_dec_").map((n) => [n.recipientId, n.title])).toEqual([
      [SEED_TEEN_ID, "Money request declined."],
    ]);
    // Can't be paid afterwards.
    expect(acceptMoneyRequestTransition(out.db, { ...asMeera, at: LATER }).result.ok).toBe(false);
    // Declining twice (double click) is a no-op replay: nothing more changes.
    const twice = declineMoneyRequestTransition(out.db, { ...asMeera, at: "2026-09-26T09:00:00Z" });
    expect(twice.result.ok).toBe(true);
    expect(twice.db).toBe(out.db);
  });

  it("the requester cancels → cancelled, payer told 'Money request cancelled.'", () => {
    const db = created();
    const out = cancelMoneyRequestTransition(db, { ...asAarav, at: LATER });
    expect(out.result).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(out.db.ledger).toBe(db.ledger);
    expect(fresh(out.db, "ntf_evt_prq_can_").map((n) => [n.recipientId, n.title])).toEqual([
      [SEED_PEER_ID, "Money request cancelled."],
    ]);
    expect(acceptMoneyRequestTransition(out.db, { ...asMeera, at: LATER }).result.ok).toBe(false);
  });

  it("only pending requests can be cancelled", () => {
    const paid = acceptMoneyRequestTransition(created(), { ...asMeera, at: LATER }).db;
    expect(cancelMoneyRequestTransition(paid, { ...asAarav, at: LATER }).result.ok).toBe(false);
    expect(paid.peerRequests[0]!.status).toBe("accepted");
  });
});

describe("authorization", () => {
  it("roles are fixed: the requester can't pay or decline, the payer can't cancel", () => {
    const db = created();
    expect(acceptMoneyRequestTransition(db, { ...asAarav, at: LATER }).result).toMatchObject({ ok: false, error: { code: "unknown_request" } });
    expect(declineMoneyRequestTransition(db, { ...asAarav, at: LATER }).result.ok).toBe(false);
    expect(cancelMoneyRequestTransition(db, { ...asMeera, at: LATER }).result.ok).toBe(false);
  });

  it("outsiders (a parent, a ghost, forged ids) can't see or act on a request", () => {
    const db = created();
    for (const actorId of [SEED_PARENT_ID, "usr_ghost"]) {
      for (const run of [acceptMoneyRequestTransition, declineMoneyRequestTransition, cancelMoneyRequestTransition]) {
        const out = run(db, { actorId, requestId: REQUEST_ID, at: LATER });
        expect(out.result.ok).toBe(false);
        expect(out.db).toBe(db);
      }
    }
    for (const requestId of ["prq_nope", "", 42 as unknown as string]) {
      expect(acceptMoneyRequestTransition(db, { actorId: SEED_PEER_ID, requestId, at: LATER }).result.ok).toBe(false);
    }
    const priya = scopeFor(db, SEED_PARENT_ID)!.state;
    expect(priya.peerRequests).toEqual([]);
    expect(selectPeerRequest(priya, REQUEST_ID, AT)).toBeNull();
  });
});

describe("expiry (7 days, computed from timestamps — no timer)", () => {
  it("a request past 7 days reads as expired and can't be paid; money never moves", () => {
    const db = created();
    const meera = scopeFor(db, SEED_PEER_ID)!.state;
    expect(selectIncomingRequests(meera, AFTER_EXPIRY)).toEqual([]);
    expect(selectRequestHistory(meera, AFTER_EXPIRY)).toMatchObject([{ status: "expired", statusLabel: "Expired" }]);
    const out = acceptMoneyRequestTransition(db, { ...asMeera, at: AFTER_EXPIRY });
    expect(out.result).toMatchObject({ ok: false, error: { code: "request_expired" } });
    expect(out.db).toBe(db);
    // Decline/cancel of an expired request is refused too.
    expect(declineMoneyRequestTransition(db, { ...asMeera, at: AFTER_EXPIRY }).result.ok).toBe(false);
    expect(cancelMoneyRequestTransition(db, { ...asAarav, at: AFTER_EXPIRY }).result.ok).toBe(false);
  });

  it("expireMoneyRequests writes it down (idempotently), only for the actor's own requests", () => {
    const db = created();
    expect(expireMoneyRequestsTransition(db, { actorId: SEED_TEEN_ID, at: LATER }).result).toMatchObject({ ok: true, value: { expired: 0 } });
    expect(expireMoneyRequestsTransition(db, { actorId: SEED_PARENT_ID, at: AFTER_EXPIRY }).db.peerRequests[0]!.status).toBe("pending");
    const out = expireMoneyRequestsTransition(db, { actorId: SEED_PEER_ID, at: AFTER_EXPIRY });
    expect(out.result).toMatchObject({ ok: true, value: { expired: 1 } });
    // Recorded at the moment it actually expired, not when it was noticed.
    expect(out.db.peerRequests[0]).toMatchObject({ status: "expired", respondedAt: peerRequestExpiresAt(AT) });
    expect(out.db.ledger).toBe(db.ledger);
    const again = expireMoneyRequestsTransition(out.db, { actorId: SEED_TEEN_ID, at: AFTER_EXPIRY });
    expect(again.result).toMatchObject({ ok: true, value: { expired: 0 } });
    expect(acceptMoneyRequestTransition(out.db, { ...asMeera, at: AFTER_EXPIRY }).result.ok).toBe(false);
  });

  it("just before expiry it can still be paid", () => {
    const justBefore = new Date(Date.parse(peerRequestExpiresAt(AT)) - 1000).toISOString();
    expect(acceptMoneyRequestTransition(created(), { ...asMeera, at: justBefore }).result.ok).toBe(true);
  });
});
