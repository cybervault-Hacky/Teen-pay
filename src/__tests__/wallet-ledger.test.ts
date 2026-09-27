import { describe, expect, it } from "vitest";
import {
  checkMoney,
  isValidMoney,
  primaryWalletId,
  REFERENCE_PREFIX,
  type LedgerEntry,
} from "@/domain";
import * as engine from "@/sandbox/engine";
import { appendEntry, deriveBalance, validateEntry } from "@/sandbox/engine";
import * as operations from "@/sandbox/operations";
import {
  postOperation,
  referenceFor,
  refundableAmount,
  reversalDraft,
  transferDraft,
  type Journal,
} from "@/sandbox/operations";
import { requestAccountDeletion } from "@/sandbox/accounts";
import { disconnectTransition } from "@/sandbox/family-transitions";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import {
  cancelApprovalTransition,
  decideApprovalTransition,
  fullRefundId,
  payTransition,
  refundTransition,
  sendAllowanceTransition,
  setWalletStatusTransition,
} from "@/sandbox/transitions";
import {
  getBalance,
  getTransaction,
  getWallet,
  listTransactions,
  listWalletEntries,
  selectDailySpending,
  selectIncoming,
  selectOutgoing,
} from "@/sandbox/selectors";
import {
  buildSeedDatabase,
  buildSeedState,
  SEED_PARENT_ID,
  SEED_SAVE_SPACE_ID,
  SEED_TEEN_ID,
} from "@/sandbox/seed";
import type { SandboxState } from "@/sandbox/types";
import {
  AT,
  balanceOf,
  linkedState,
  must,
  PARENT,
  PARENT_WALLET,
  TEEN,
  TEEN_WALLET,
  teenBalance,
  teenLedger,
  withRules,
} from "./helpers/fixtures";

/** Seed teen available balance. */
const START = 1850;
/** Seed parent (Priya) wallet balance. */
const PARENT_START = 5500;

const pay = (state: SandboxState, entryId: string, amount: number, recipientId = "rec_riya") =>
  payTransition(state, { ...TEEN, entryId, recipientId, amount });

const journalOf = (s: SandboxState): Journal => ({
  wallets: s.wallets,
  ledger: s.ledger,
  operations: s.operations,
  spaces: s.spaces,
});

const freeze = (s: SandboxState, actor = TEEN) =>
  setWalletStatusTransition(s, { ...actor, walletId: TEEN_WALLET, status: "frozen" });

const unfreeze = (s: SandboxState, actor = TEEN) =>
  setWalletStatusTransition(s, { ...actor, walletId: TEEN_WALLET, status: "active" });

// ── Money validation ──────────────────────────────────────────────

describe("money validation (one central check)", () => {
  it.each([
    [NaN, "not_a_number"],
    [Infinity, "not_finite"],
    [-Infinity, "not_finite"],
    [10.5, "not_integer"],
    [99.99, "not_integer"],
    [0, "not_positive"],
    [-5, "not_positive"],
    [Number.MAX_SAFE_INTEGER + 2, "unsafe_integer"],
    [10_001, "above_maximum"],
  ])("rejects %s (%s)", (amount, problem) => {
    expect(checkMoney(amount)).toBe(problem);
    expect(isValidMoney(amount)).toBe(false);
  });

  it("rejects non-numbers and unsupported currencies", () => {
    expect(checkMoney("100")).toBe("not_a_number");
    expect(checkMoney(100, { currency: "USD" })).toBe("unsupported_currency");
  });

  it("accepts whole rupees from ₹1 to the sandbox cap", () => {
    expect(isValidMoney(1)).toBe(true);
    expect(isValidMoney(10_000)).toBe(true);
  });
});

// ── Wallets ───────────────────────────────────────────────────────

describe("wallets", () => {
  it("every seed account owns exactly one active INR primary wallet — no global wallet", () => {
    const db = buildSeedDatabase();
    expect(db.wallets).toHaveLength(db.accounts.length);
    for (const account of db.accounts) {
      const owned = db.wallets.filter((w) => w.ownerAccountId === account.id);
      expect(owned).toHaveLength(1);
      expect(owned[0]).toMatchObject({
        id: primaryWalletId(account.id),
        kind: "primary",
        currency: "INR",
        status: "active",
      });
    }
    // Wallets hold no balance field — balances only come from the ledger.
    for (const wallet of db.wallets) expect(wallet).not.toHaveProperty("balance");
  });

  it("getWallet/getBalance read one wallet; balances derive from its entries only", () => {
    const s = linkedState();
    expect(getWallet(s, TEEN_WALLET)?.ownerAccountId).toBe(SEED_TEEN_ID);
    expect(getWallet(s, PARENT_WALLET)?.ownerAccountId).toBe(SEED_PARENT_ID);
    expect(getWallet(s, "wal_nobody")).toBeNull();
    expect(getBalance(s, TEEN_WALLET)).toBe(START);
    expect(getBalance(s, PARENT_WALLET)).toBe(PARENT_START);
    expect(getBalance(s, TEEN_WALLET)).toBe(deriveBalance(listWalletEntries(s, TEEN_WALLET)));
  });

  it("freeze and unfreeze are domain operations with typed events", () => {
    const frozen = must(freeze(linkedState()));
    expect(getWallet(frozen, TEEN_WALLET)).toMatchObject({
      status: "frozen",
      statusChangedBy: SEED_TEEN_ID,
      statusChangedAt: AT,
    });
    // The guardian is told (the teen saw it on screen).
    expect(
      frozen.notifications.find((n) => n.recipientId === SEED_PARENT_ID && n.title === "Wallet frozen"),
    ).toBeTruthy();
    // Freezing again is idempotent — no second event.
    const again = must(freeze(frozen));
    expect(again).toBe(frozen);

    const active = must(unfreeze(frozen));
    expect(getWallet(active, TEEN_WALLET)?.status).toBe("active");
  });

  it("a frozen wallet stays viewable but rejects pay, pocket money and savings moves", () => {
    const frozen = must(freeze(linkedState()));
    const before = frozen.ledger;

    const payment = pay(frozen, "p_frozen", 100);
    expect(payment.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    const allowance = sendAllowanceTransition(frozen, { ...PARENT, operationId: "al_frozen", amount: 100 });
    expect(allowance.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });

    const save = moveSpaceMoneyTransition(frozen, {
      ...TEEN,
      operationId: "s_frozen",
      spaceId: SEED_SAVE_SPACE_ID,
      amount: 100,
      direction: "add",
    });
    expect(save.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });

    expect(payment.state.ledger).toBe(before);
    expect(allowance.state.ledger).toBe(before);
    expect(save.state.ledger).toBe(before);
    // Viewing still works.
    expect(getBalance(frozen, TEEN_WALLET)).toBe(START);
    expect(listTransactions(frozen, TEEN_WALLET).length).toBeGreaterThan(0);
  });

  it("a guardian's freeze can only be lifted by a guardian", () => {
    const frozen = must(freeze(linkedState(), PARENT));
    const teenTry = unfreeze(frozen, TEEN);
    expect(teenTry.result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(getWallet(teenTry.state, TEEN_WALLET)?.status).toBe("frozen");
    expect(getWallet(must(unfreeze(frozen, PARENT)), TEEN_WALLET)?.status).toBe("active");
  });

  it("parent wallets can't be frozen in the sandbox, and only owners/guardians may freeze", () => {
    const s = linkedState();
    expect(
      setWalletStatusTransition(s, { ...PARENT, walletId: PARENT_WALLET, status: "frozen" }).result,
    ).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    // An unlinked parent can't touch the teen's wallet.
    expect(freeze(buildSeedState(), PARENT).result.ok).toBe(false);
  });
});

// ── Ledger ────────────────────────────────────────────────────────

describe("ledger", () => {
  it("entries carry wallet, account, type, amount, currency, direction, status, reference, creator", () => {
    const s = must(pay(linkedState(), "p_fields", 200));
    const entry = s.ledger.find((e) => e.id === "p_fields");
    expect(entry).toMatchObject({
      walletId: TEEN_WALLET,
      accountId: SEED_TEEN_ID,
      type: "payment_sent",
      amount: 200,
      currency: "INR",
      direction: "debit",
      status: "completed",
      createdBy: SEED_TEEN_ID,
      operationId: "p_fields",
    });
    expect(entry?.reference).toMatch(/^PAY-[0-9A-Z]{8}$/);
    expect(entry?.createdAt).toBe(AT);
  });

  it("append-only: entries are frozen, and there's no update or delete API", () => {
    const s = must(pay(linkedState(), "p_frozen_obj", 200));
    const entry = s.ledger.find((e) => e.id === "p_frozen_obj")!;
    expect(Object.isFrozen(entry)).toBe(true);
    expect(() => {
      (entry as { amount: number }).amount = 1;
    }).toThrow();
    const names = [...Object.keys(engine), ...Object.keys(operations)];
    expect(names.filter((n) => /update|delete|remove|edit|mutate/i.test(n))).toEqual([]);
  });

  it("appending an existing entry id is a no-op", () => {
    const s = linkedState();
    const first = s.ledger[0]!;
    expect(appendEntry(s.ledger, { ...first, amount: 9999 })).toBe(s.ledger);
  });

  it("never lets a wallet go below zero", () => {
    const s = linkedState();
    const out = pay(s, "p_too_big", START + 1);
    expect(out.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(out.state.ledger).toBe(s.ledger);
    // The engine refuses such an entry directly too.
    const debit = {
      ...s.ledger.find((e) => e.id === "seed_pay_1")!,
      id: "x",
      amount: START + 1,
    } as LedgerEntry;
    expect(validateEntry(debit, s.ledger)?.code).toBe("insufficient_balance");
  });

  it("rejects invalid amounts and unsupported currencies without writing", () => {
    const s = linkedState();
    for (const amount of [0, -1, 10.5, NaN, Infinity, 10_001]) {
      const out = pay(s, `p_bad_${String(amount)}`, amount);
      expect(out.result.ok).toBe(false);
      expect(out.state.ledger).toBe(s.ledger);
    }
    const draft = transferDraft({
      id: "t_usd",
      actorId: SEED_TEEN_ID,
      at: AT,
      from: { walletId: TEEN_WALLET, accountId: SEED_TEEN_ID, name: "Aarav" },
      to: { walletId: PARENT_WALLET, accountId: SEED_PARENT_ID, name: "Priya" },
      amount: 10,
    });
    const usd = postOperation(journalOf(s), { ...draft, currency: "USD" });
    expect(usd).toMatchObject({ ok: false, error: { code: "unsupported_currency" } });
  });

  it("corrections are compensating entries: a reversal leaves the original untouched", () => {
    const s = must(pay(linkedState(), "p_rev", 300));
    const original = s.ledger.find((e) => e.id === "p_rev")!;
    const posted = postOperation(
      journalOf(s),
      reversalDraft({ id: "rev_1", actorId: SEED_TEEN_ID, at: AT, original, reason: "Sandbox correction" }),
    );
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;
    const ledger = posted.journal.ledger;
    expect(ledger.find((e) => e.id === "p_rev")).toEqual(original);
    expect(ledger.find((e) => e.relatedEntryId === "p_rev")).toMatchObject({
      type: "reversal",
      direction: "credit",
      amount: 300,
    });
    expect(deriveBalance(ledger.filter((e) => e.walletId === TEEN_WALLET))).toBe(START);
    expect(posted.operation.reference).toMatch(/^REV-/);
  });

  it("references are stable per operation and unique across operations", () => {
    expect(referenceFor("payment", "p_same", new Set())).toBe(
      referenceFor("payment", "p_same", new Set()),
    );
    expect(REFERENCE_PREFIX).toMatchObject({ payment: "PAY", transfer: "TRF", allowance: "ALW", refund: "REF" });
    const db = buildSeedDatabase();
    const refs = db.operations.map((op) => op.reference);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

// ── Payments ──────────────────────────────────────────────────────

describe("payments", () => {
  it("success: one entry, one operation, balance down, typed event → notification", () => {
    const s = linkedState();
    const out = payTransition(s, { ...TEEN, entryId: "p_ok", recipientId: "rec_riya", amount: 200 });
    expect(out.result).toEqual({ ok: true, value: { status: "completed", entryId: "p_ok" } });
    expect(teenLedger(out.state).length).toBe(teenLedger(s).length + 1);
    expect(out.state.operations.filter((op) => op.id === "p_ok")).toHaveLength(1);
    expect(teenBalance(out.state)).toBe(START - 200);
    expect(out.state.notifications[0]).toMatchObject({ recipientId: SEED_TEEN_ID, title: "Payment sent" });
  });

  it("insufficient and invalid payments change nothing and notify nobody", () => {
    const s = linkedState();
    for (const out of [pay(s, "p_big", 5000), pay(s, "p_frac", 99.5), pay(s, "p_who", 10, "rec_ghost")]) {
      expect(out.result.ok).toBe(false);
      expect(out.state).toBe(s);
    }
  });

  it("duplicate submission (same key, same details) moves money once", () => {
    const once = must(pay(linkedState(), "p_dup", 200));
    const twice = pay(once, "p_dup", 200);
    expect(twice.result.ok).toBe(true);
    expect(twice.state).toBe(once);
    expect(teenBalance(twice.state)).toBe(START - 200);
  });

  it("the same key with different details is rejected", () => {
    const once = must(pay(linkedState(), "p_dup2", 200));
    const other = pay(once, "p_dup2", 300);
    expect(other.result).toMatchObject({ ok: false, error: { code: "duplicate" } });
    expect(other.state).toBe(once);
  });

  it("repeat payments with fresh keys are separate payments", () => {
    let s = linkedState();
    s = must(pay(s, "p_r1", 100));
    s = must(pay(s, "p_r2", 100));
    expect(teenBalance(s)).toBe(START - 200);
    expect(teenLedger(s).filter((e) => e.type === "payment_sent" && e.id.startsWith("p_r"))).toHaveLength(2);
  });

  it("the daily limit counts completed ledger payments of this wallet only", () => {
    let s = withRules({ daily: 500 });
    s = must(pay(s, "p_d1", 400));
    expect(selectDailySpending(s, TEEN_WALLET, AT)).toBe(400);
    // Pocket money out of the parent's wallet doesn't count as teen spend.
    s = must(sendAllowanceTransition(s, { ...PARENT, operationId: "al_d", amount: 300 }));
    expect(selectDailySpending(s, TEEN_WALLET, AT)).toBe(400);
    expect(pay(s, "p_d2", 200).result).toMatchObject({ ok: false, error: { code: "exceeds_daily_limit" } });
  });
});

// ── Transfers / pocket money ──────────────────────────────────────

describe("transfers and pocket money", () => {
  it("pocket money is one atomic operation with two linked legs; both balances move", () => {
    const s = linkedState();
    const out = must(sendAllowanceTransition(s, { ...PARENT, operationId: "al_ok", amount: 500 }));
    expect(balanceOf(out, SEED_PARENT_ID)).toBe(PARENT_START - 500);
    expect(teenBalance(out)).toBe(START + 500);
    const legs = out.ledger.filter((e) => e.operationId === "al_ok");
    expect(legs.map((e) => [e.id, e.walletId, e.type, e.direction])).toEqual([
      ["al_ok-dr", PARENT_WALLET, "allowance_debit", "debit"],
      ["al_ok-cr", TEEN_WALLET, "allowance_credit", "credit"],
    ]);
    expect(new Set(legs.map((e) => e.reference)).size).toBe(1);
    expect(legs[0]!.reference).toMatch(/^ALW-/);
    // Incoming/outgoing queries see each side.
    expect(selectIncoming(out, TEEN_WALLET).some((e) => e.id === "al_ok-cr")).toBe(true);
    expect(selectOutgoing(out, PARENT_WALLET).some((e) => e.id === "al_ok-dr")).toBe(true);
    expect(out.notifications.some((n) => n.recipientId === SEED_TEEN_ID && n.title === "Pocket money received")).toBe(true);
  });

  it("insufficient guardian funds: nothing is written on either side", () => {
    let s = linkedState();
    // Drain Priya's wallet down to ₹500 via allowances.
    s = must(sendAllowanceTransition(s, { ...PARENT, operationId: "al_a", amount: 5000 }));
    const out = sendAllowanceTransition(s, { ...PARENT, operationId: "al_b", amount: 600 });
    expect(out.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(out.state).toBe(s);
  });

  it("duplicate pocket money (same operation id) moves money once", () => {
    const once = must(sendAllowanceTransition(linkedState(), { ...PARENT, operationId: "al_dup", amount: 200 }));
    const twice = sendAllowanceTransition(once, { ...PARENT, operationId: "al_dup", amount: 200 });
    expect(twice.result.ok).toBe(true);
    expect(twice.state).toBe(once);
    const changed = sendAllowanceTransition(once, { ...PARENT, operationId: "al_dup", amount: 999 });
    expect(changed.result).toMatchObject({ ok: false, error: { code: "duplicate" } });
  });

  it("wallet-to-wallet transfers post both legs or neither", () => {
    const s = linkedState();
    const draft = (id: string, amount: number) =>
      transferDraft({
        id,
        actorId: SEED_TEEN_ID,
        at: AT,
        from: { walletId: TEEN_WALLET, accountId: SEED_TEEN_ID, name: "Aarav" },
        to: { walletId: PARENT_WALLET, accountId: SEED_PARENT_ID, name: "Priya" },
        amount,
      });
    const ok = postOperation(journalOf(s), draft("t_ok", 250));
    expect(ok.ok).toBe(true);
    if (!ok.ok) return;
    expect(ok.operation.reference).toMatch(/^TRF-/);
    expect(deriveBalance(ok.journal.ledger.filter((e) => e.walletId === TEEN_WALLET))).toBe(START - 250);
    expect(deriveBalance(ok.journal.ledger.filter((e) => e.walletId === PARENT_WALLET))).toBe(PARENT_START + 250);

    const tooMuch = postOperation(journalOf(s), draft("t_big", START + 1));
    expect(tooMuch).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    // A replay of the posted transfer is a no-op.
    const replay = postOperation(ok.journal, draft("t_ok", 250));
    expect(replay).toMatchObject({ ok: true, replayed: true });
    if (replay.ok) expect(replay.journal).toBe(ok.journal);
  });
});

// ── Refunds ───────────────────────────────────────────────────────

describe("refunds (sandbox simulation)", () => {
  it("a refund is a new linked credit; the payment stays; balance restored", () => {
    const paid = must(pay(linkedState(), "p_ref", 400));
    const out = refundTransition(paid, { ...TEEN, entryId: "p_ref" });
    expect(out.result.ok).toBe(true);
    const s = out.state;
    expect(s.ledger.find((e) => e.id === "p_ref")).toEqual(paid.ledger.find((e) => e.id === "p_ref"));
    const refund = s.ledger.find((e) => e.id === fullRefundId("p_ref"));
    expect(refund).toMatchObject({ type: "refund", direction: "credit", amount: 400, relatedEntryId: "p_ref" });
    expect(refund?.reference).toMatch(/^REF-/);
    expect(teenBalance(s)).toBe(START);
    expect(getTransaction(s, "p_ref")).toMatchObject({ status: "reversed", statusText: "Refunded", refundable: 0 });
    expect(s.notifications[0]).toMatchObject({ recipientId: SEED_TEEN_ID, title: "Refund received" });
  });

  it("duplicate refunds are idempotent and never over-refund", () => {
    const paid = must(pay(linkedState(), "p_ref2", 400));
    const once = must(refundTransition(paid, { ...TEEN, entryId: "p_ref2" }));
    const twice = refundTransition(once, { ...TEEN, entryId: "p_ref2" });
    expect(twice.result.ok).toBe(true);
    expect(twice.state).toBe(once);
    // A different key can't refund more than was paid.
    const extra = refundTransition(once, { ...TEEN, entryId: "p_ref2", operationId: "ref_other" });
    expect(extra.result).toMatchObject({ ok: false, error: { code: "not_refundable" } });
    expect(teenBalance(once)).toBe(START);
  });

  it("partial refunds count toward what's left; refunds don't restore the daily limit", () => {
    let s = withRules({ daily: 500 });
    s = must(pay(s, "p_part", 400));
    const original = s.ledger.find((e) => e.id === "p_part")!;
    s = must(refundTransition(s, { ...TEEN, entryId: "p_part", amount: 150, operationId: "ref_part_1" }));
    expect(refundableAmount(s.ledger, original)).toBe(250);
    expect(getTransaction(s, "p_part")?.statusText).toBe("Partly refunded");
    expect(teenBalance(s)).toBe(START - 250);
    expect(selectDailySpending(s, TEEN_WALLET, AT)).toBe(400);
  });

  it("only payments can be refunded, and only by the wallet's teen", () => {
    const s = linkedState();
    const allowance = teenLedger(s).find((e) => e.type === "allowance_credit")!;
    expect(refundTransition(s, { ...TEEN, entryId: allowance.id }).result).toMatchObject({
      ok: false,
      error: { code: "not_refundable" },
    });
    expect(refundTransition(s, { ...PARENT, entryId: "seed_pay_1" }).result.ok).toBe(false);
  });
});

// ── Approvals ─────────────────────────────────────────────────────

describe("approvals", () => {
  const pendingState = () => {
    const out = pay(withRules({ threshold: 500 }), "p_apr", 600);
    expect(out.result).toMatchObject({ ok: true, value: { status: "approval_requested" } });
    return out.state;
  };
  const approvalId = "apr_p_apr";

  it("a pending approval is not a ledger entry and doesn't change the balance", () => {
    const base = withRules({ threshold: 500 });
    const s = pendingState();
    expect(s.ledger).toEqual(base.ledger);
    expect(s.operations).toEqual(base.operations);
    expect(teenBalance(s)).toBe(START);
    expect(s.approvals.find((a) => a.id === approvalId)?.status).toBe("pending");
    expect(s.notifications.some((n) => n.recipientId === SEED_PARENT_ID && n.title === "New approval request")).toBe(true);
  });

  it("approve executes exactly once; repeated and double-clicked approvals are safe", () => {
    const s = pendingState();
    const first = must(decideApprovalTransition(s, { ...PARENT, approvalId, decision: "approve" }));
    const second = decideApprovalTransition(first, { ...PARENT, approvalId, decision: "approve" });
    expect(second.result.ok).toBe(true);
    expect(second.state).toBe(first);
    expect(first.ledger.filter((e) => e.id === "p_apr")).toHaveLength(1);
    expect(first.ledger.find((e) => e.id === "p_apr")).toMatchObject({ approvalId, createdBy: SEED_PARENT_ID });
    expect(teenBalance(first)).toBe(START - 600);
    expect(getTransaction(first, "p_apr")?.approval?.decidedByName).toBe("Priya");
    // Declining after approval can't undo money.
    expect(decideApprovalTransition(first, { ...PARENT, approvalId, decision: "decline" }).result.ok).toBe(false);
    // The teen re-submitting the same payment key doesn't pay again.
    expect(pay(first, "p_apr", 600).state).toBe(first);
  });

  it("re-validates at execution: a frozen wallet or a spent balance blocks it", () => {
    const frozen = must(freeze(pendingState()));
    const out = decideApprovalTransition(frozen, { ...PARENT, approvalId, decision: "approve" });
    expect(out.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    expect(out.state.ledger).toBe(frozen.ledger);
    expect(out.state.approvals.find((a) => a.id === approvalId)?.status).toBe("pending");

    // Three ₹450 payments (under the threshold) leave ₹500 < ₹600.
    let spent = pendingState();
    for (const id of ["p_s1", "p_s2", "p_s3"]) spent = must(pay(spent, id, 450));
    const broke = decideApprovalTransition(spent, { ...PARENT, approvalId, decision: "approve" });
    expect(broke.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(teenBalance(broke.state)).toBe(START - 1350);
  });

  it("only the linked guardian may decide; the teen can't approve their own request", () => {
    const s = pendingState();
    const self = decideApprovalTransition(s, { ...TEEN, approvalId, decision: "approve" });
    expect(self.result.ok).toBe(false);
    expect(self.state.ledger).toBe(s.ledger);
  });

  it("cancelled or disconnected approvals can never execute", () => {
    const cancelled = must(cancelApprovalTransition(pendingState(), { ...TEEN, approvalId }));
    expect(decideApprovalTransition(cancelled, { ...PARENT, approvalId, decision: "approve" }).result.ok).toBe(false);

    const gone = must(disconnectTransition(pendingState(), { ...TEEN, teenId: SEED_TEEN_ID }));
    const out = decideApprovalTransition(gone, { ...PARENT, approvalId, decision: "approve" });
    expect(out.result.ok).toBe(false);
    expect(teenBalance(out.state)).toBe(START);
  });
});

// ── Lifecycle & audit ─────────────────────────────────────────────

describe("lifecycle and audit", () => {
  it("the seed is deterministic with no orphan wallets or entries", () => {
    const a = buildSeedDatabase();
    const b = buildSeedDatabase();
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const accountIds = new Set(a.accounts.map((x) => x.id));
    const walletIds = new Set(a.wallets.map((w) => w.id));
    for (const w of a.wallets) expect(accountIds.has(w.ownerAccountId)).toBe(true);
    for (const e of a.ledger) {
      expect(walletIds.has(e.walletId)).toBe(true);
      expect(a.operations.some((op) => op.id === e.operationId)).toBe(true);
    }
  });

  it("every operation is auditable: id, actor, wallet, amount, time, type, reference", () => {
    const s = must(pay(linkedState(), "p_audit", 120));
    const op = s.operations.find((o) => o.id === "p_audit");
    expect(op).toMatchObject({
      id: "p_audit",
      actorId: SEED_TEEN_ID,
      amount: 120,
      currency: "INR",
      createdAt: AT,
      type: "payment",
      status: "completed",
    });
    expect(op?.reference).toMatch(/^PAY-/);
    expect(op?.legs.some((leg) => leg.walletId === TEEN_WALLET && leg.direction === "debit")).toBe(true);
  });

  it("a deletion request keeps every wallet, entry and operation", () => {
    const db = buildSeedDatabase();
    const next = requestAccountDeletion(db, SEED_TEEN_ID, AT);
    if ("code" in next) throw new Error(next.message);
    expect(next.wallets).toEqual(db.wallets);
    expect(next.ledger).toEqual(db.ledger);
    expect(next.operations).toEqual(db.operations);
  });

  it("notifications never move money", () => {
    const s = must(pay(linkedState(), "p_note", 100));
    const withoutNotes = { ...s, notifications: [] };
    expect(teenBalance(withoutNotes)).toBe(teenBalance(s));
  });
});
