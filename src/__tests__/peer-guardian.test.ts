import { describe, expect, it } from "vitest";
import {
  acceptMoneyRequestTransition,
  approveTransferTransition,
  createMoneyRequestTransition,
  declineMoneyRequestTransition,
  requestIdFor,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { spentOnDay } from "@/sandbox/rules";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { selectIncomingRequests, selectPendingApprovals } from "@/sandbox/selectors";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { decideApprovalTransition } from "@/sandbox/transitions";
import { disconnectTransition } from "@/sandbox/family-transitions";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT, balanceOf, linkedDatabase } from "./helpers/fixtures";

const LATER = "2026-09-26T07:00:00Z";

function rulesDb(rules: { daily?: number | null; perTx?: number | null; threshold?: number | null }): SandboxDatabase {
  return linkedDatabase(rules);
}

function send(db: SandboxDatabase, amount: number, key: string, actorId = SEED_TEEN_ID, recipient = "@meera") {
  return sendMoneyTransition(db, { actorId, at: AT, recipient, amount, idempotencyKey: key });
}

/** Priya decides through her own scope (the family path). */
function parentDecline(db: SandboxDatabase, approvalId: string) {
  const scope = scopeFor(db, SEED_PARENT_ID)!;
  const out = decideApprovalTransition(scope.state, { approvalId, decision: "decline" });
  return { result: out.result, db: out.result.ok ? mergeScope(db, scope.info, scope.state, out.state) : db };
}

describe("guardian limits apply to TeenPay transfers (the one central decision)", () => {
  it("per-payment limit: ₹250 over a ₹200 limit is refused outright — no approval, no money", () => {
    const db = rulesDb({ perTx: 200 });
    const out = send(db, 250, "snd_pertx_001");
    expect(out.result).toMatchObject({ ok: false, error: { code: "exceeds_transaction_limit" } });
    expect(out.db).toBe(db);
    expect(send(db, 200, "snd_pertx_002").result.ok).toBe(true);
  });

  it("daily limit counts transfers out; the second send over ₹300/day is refused", () => {
    let db = rulesDb({ daily: 300 });
    const first = send(db, 200, "snd_daily_001");
    expect(first.result.ok).toBe(true);
    db = first.db;
    expect(spentOnDay(db.ledger, AT, "wal_usr_aarav")).toBe(200);
    const second = send(db, 150, "snd_daily_002");
    expect(second.result).toMatchObject({ ok: false, error: { code: "exceeds_daily_limit" } });
    expect(send(db, 100, "snd_daily_003").result.ok).toBe(true);
  });

  it("incoming money is not spending: money received doesn't use up the daily limit", () => {
    let db = rulesDb({ daily: 300 });
    const gift = send(db, 500, "snd_gift_meera", SEED_PEER_ID, "@aarav");
    expect(gift.result.ok).toBe(true);
    db = gift.db;
    expect(spentOnDay(db.ledger, AT, "wal_usr_aarav")).toBe(0);
    expect(spentOnDay(db.ledger, AT, "wal_usr_meera")).toBe(500); // Meera has no guardian rules
    expect(send(db, 300, "snd_after_gift").result.ok).toBe(true);
  });
});

describe("approval threshold → the existing approval flow", () => {
  it("over the threshold: nothing moves until approved; approval posts exactly once via the same atomic path", () => {
    let db = rulesDb({ threshold: 200 });
    const out = send(db, 250, "snd_approve_01");
    expect(out.result).toMatchObject({ ok: true, value: { status: "approval_requested", amount: 250, guardianName: "Priya" } });
    expect(out.db.ledger).toHaveLength(db.ledger.length);
    expect(balanceOf(out.db, SEED_TEEN_ID)).toBe(1850);
    db = out.db;
    const approvalId = out.result.ok && out.result.value.status === "approval_requested" ? out.result.value.approvalId : "";
    const pending = selectPendingApprovals(scopeFor(db, SEED_PARENT_ID)!.state, { teenId: SEED_TEEN_ID });
    expect(pending).toMatchObject([{ id: approvalId, kind: "transfer", recipientName: "@meera", amount: 250 }]);

    // A repeat of the same send doesn't ask twice.
    const repeat = send(db, 250, "snd_approve_01");
    expect(repeat.db).toBe(db);
    expect(repeat.result).toMatchObject({ ok: true, value: { status: "approval_requested", approvalId } });

    // The family (scoped) path refuses to execute a cross-family transfer approval.
    const scope = scopeFor(db, SEED_PARENT_ID)!;
    expect(decideApprovalTransition(scope.state, { approvalId, decision: "approve" }).result.ok).toBe(false);

    const approved = approveTransferTransition(db, { actorId: SEED_PARENT_ID, at: LATER, approvalId });
    expect(approved.result).toMatchObject({ ok: true, value: { status: "approved" } });
    expect(balanceOf(approved.db, SEED_TEEN_ID)).toBe(1600);
    expect(balanceOf(approved.db, SEED_PEER_ID)).toBe(1450);
    const op = approved.db.operations.find((o) => o.id === "snd_approve_01")!;
    expect(op).toMatchObject({ type: "transfer", approvalId, actorId: SEED_PARENT_ID });
    expect(approved.db.notifications.find((n) => n.recipientId === SEED_TEEN_ID && n.id.includes(approvalId))?.title).toBe(
      "₹250 sent to @meera.",
    );
    expect(approved.db.notifications.some((n) => n.recipientId === SEED_PEER_ID && n.title === "You received ₹250.")).toBe(true);

    // Approving again never posts twice.
    const twice = approveTransferTransition(approved.db, { actorId: SEED_PARENT_ID, at: LATER, approvalId });
    expect(twice.result.ok).toBe(true);
    expect(twice.db).toBe(approved.db);
    expect(approved.db.operations.filter((o) => o.id === "snd_approve_01")).toHaveLength(1);
    // And the teen's replay now reports the completed transfer.
    expect(send(approved.db, 250, "snd_approve_01").result).toMatchObject({ ok: true, value: { status: "completed", replayed: true } });
  });

  it("declined: no money ever moves, and it can't be approved afterwards", () => {
    const out = send(rulesDb({ threshold: 200 }), 250, "snd_decline_01");
    const approvalId = out.result.ok && out.result.value.status === "approval_requested" ? out.result.value.approvalId : "";
    const declined = parentDecline(out.db, approvalId);
    expect(declined.result.ok).toBe(true);
    expect(declined.db.ledger).toHaveLength(out.db.ledger.length);
    const late = approveTransferTransition(declined.db, { actorId: SEED_PARENT_ID, at: LATER, approvalId });
    expect(late.result.ok).toBe(false);
    expect(balanceOf(late.db, SEED_TEEN_ID)).toBe(1850);
  });

  it("only the teen's linked guardian can approve; the teen and outsiders can't", () => {
    const out = send(rulesDb({ threshold: 200 }), 250, "snd_authz_01");
    const approvalId = out.result.ok && out.result.value.status === "approval_requested" ? out.result.value.approvalId : "";
    for (const actorId of [SEED_TEEN_ID, SEED_PEER_ID, "usr_ghost"]) {
      const attempt = approveTransferTransition(out.db, { actorId, at: LATER, approvalId });
      expect(attempt.result.ok).toBe(false);
      expect(attempt.db).toBe(out.db);
    }
  });

  it("approval re-checks everything: a frozen recipient or spent-down balance → nothing moves", () => {
    const out = send(rulesDb({ threshold: 200 }), 250, "snd_recheck_01");
    const approvalId = out.result.ok && out.result.value.status === "approval_requested" ? out.result.value.approvalId : "";
    const frozen = { ...out.db, wallets: out.db.wallets.map((w) => (w.id === "wal_usr_meera" ? { ...w, status: "frozen" as const } : w)) };
    expect(approveTransferTransition(frozen, { actorId: SEED_PARENT_ID, at: LATER, approvalId }).result.ok).toBe(false);

    // Spend down below ₹250 available (small sends stay under the threshold).
    let db = out.db;
    for (let i = 0; i < 9; i++) {
      const s = send(db, 200, `snd_spend_${i}xx`);
      if (!s.result.ok) throw new Error(JSON.stringify(s.result));
      db = s.db;
    }
    expect(balanceOf(db, SEED_TEEN_ID)).toBe(50);
    const broke = approveTransferTransition(db, { actorId: SEED_PARENT_ID, at: LATER, approvalId });
    expect(broke.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(broke.db).toBe(db);
  });
});

describe("disconnection", () => {
  it("a parent who disconnected can't approve a pending transfer; the teen keeps their money", () => {
    const out = send(rulesDb({ threshold: 200 }), 250, "snd_disc_0001");
    const approvalId = out.result.ok && out.result.value.status === "approval_requested" ? out.result.value.approvalId : "";
    const scope = scopeFor(out.db, SEED_PARENT_ID)!;
    const cut = disconnectTransition(scope.state, { actorId: SEED_PARENT_ID, at: LATER, teenId: SEED_TEEN_ID });
    if (!cut.result.ok) throw new Error(JSON.stringify(cut.result));
    const db = mergeScope(out.db, scope.info, scope.state, cut.state);
    const late = approveTransferTransition(db, { actorId: SEED_PARENT_ID, at: LATER, approvalId });
    expect(late.result.ok).toBe(false);
    expect(late.db).toBe(db);
    expect(balanceOf(db, SEED_TEEN_ID)).toBe(1850);
    // Without a guardian there's no threshold: Aarav's own send goes through.
    expect(send(db, 250, "snd_disc_0002").result).toMatchObject({ ok: true, value: { status: "completed" } });
  });
});

describe("paying a money request above the threshold", () => {
  function requested(db: SandboxDatabase) {
    const out = createMoneyRequestTransition(db, {
      actorId: SEED_PEER_ID, at: AT, payer: "@aarav", amount: 250, idempotencyKey: "prq_guard_0001",
    });
    if (!out.result.ok) throw new Error(JSON.stringify(out.result));
    return out.db;
  }
  const requestId = requestIdFor("prq_guard_0001");

  it("accept asks the guardian; the request stays pending; approval pays it exactly once", () => {
    const db = requested(rulesDb({ threshold: 200 }));
    const asked = acceptMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, requestId });
    expect(asked.result).toMatchObject({ ok: true, value: { status: "approval_requested" } });
    expect(asked.db.peerRequests[0]!.status).toBe("pending");
    expect(asked.db.ledger).toHaveLength(db.ledger.length);
    const view = selectIncomingRequests(scopeFor(asked.db, SEED_TEEN_ID)!.state, AT);
    expect(view).toMatchObject([{ awaitingApproval: true }]);
    const approvalId = asked.result.ok && asked.result.value.status === "approval_requested" ? asked.result.value.approvalId : "";

    // Tapping Pay again while waiting doesn't create a second approval.
    const again = acceptMoneyRequestTransition(asked.db, { actorId: SEED_TEEN_ID, at: AT, requestId });
    expect(again.db).toBe(asked.db);

    const approved = approveTransferTransition(asked.db, { actorId: SEED_PARENT_ID, at: LATER, approvalId });
    expect(approved.result.ok).toBe(true);
    expect(approved.db.peerRequests[0]).toMatchObject({ status: "accepted" });
    expect(approved.db.operations.filter((o) => o.requestId === requestId)).toHaveLength(1);
    expect(balanceOf(approved.db, SEED_TEEN_ID)).toBe(1600);
    expect(balanceOf(approved.db, SEED_PEER_ID)).toBe(1450);
    expect(approved.db.notifications.some((n) => n.recipientId === SEED_PEER_ID && n.title === "₹250 request was paid.")).toBe(true);
  });

  it("a declined approval leaves the request pending but unpayable by the teen; declining the request closes it", () => {
    const db = requested(rulesDb({ threshold: 200 }));
    const asked = acceptMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, requestId });
    const approvalId = asked.result.ok && asked.result.value.status === "approval_requested" ? asked.result.value.approvalId : "";
    const declined = parentDecline(asked.db, approvalId);
    expect(declined.db.peerRequests[0]!.status).toBe("pending");
    const retry = acceptMoneyRequestTransition(declined.db, { actorId: SEED_TEEN_ID, at: LATER, requestId });
    expect(retry.result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(retry.db).toBe(declined.db);
    const closed = declineMoneyRequestTransition(declined.db, { actorId: SEED_TEEN_ID, at: LATER, requestId });
    expect(closed.result.ok).toBe(true);
    expect(closed.db.ledger).toHaveLength(db.ledger.length);
  });

  it("declining or cancelling a request closes its pending approval, so it can never execute", () => {
    const db = requested(rulesDb({ threshold: 200 }));
    const asked = acceptMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: AT, requestId });
    const approvalId = asked.result.ok && asked.result.value.status === "approval_requested" ? asked.result.value.approvalId : "";
    const declined = declineMoneyRequestTransition(asked.db, { actorId: SEED_TEEN_ID, at: LATER, requestId });
    const approval = scopeFor(declined.db, SEED_PARENT_ID)!.state.approvals.find((a) => a.id === approvalId)!;
    expect(approval.status).toBe("cancelled");
    const late = approveTransferTransition(declined.db, { actorId: SEED_PARENT_ID, at: LATER, approvalId });
    expect(late.result.ok).toBe(false);
    expect(late.db.ledger).toHaveLength(db.ledger.length);
  });
});
