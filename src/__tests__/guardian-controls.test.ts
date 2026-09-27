import { describe, expect, it } from "vitest";
import {
  disconnectTransition,
  updateGuardianNotificationsTransition,
  updateSpendingRulesTransition,
} from "@/sandbox/family-transitions";
import { databaseFromState, isSandboxDatabase, migrateV1, migrateV3, migrateV4, migrateV5, migrateV6, migrateV7 } from "@/sandbox/persistence";
import {
  describeScheduleCadence,
  evaluatePayment,
  nextAllowanceDate,
  spendingStatus,
  spentOnDay,
} from "@/sandbox/rules";
import { buildSeedState, SEED_PARENT_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { createPocketMoneyScheduleTransition } from "@/sandbox/allowance-transitions";
import {
  cancelApprovalTransition,
  decideApprovalTransition,
  payTransition,
  sendAllowanceTransition,
} from "@/sandbox/transitions";
import type { SandboxState } from "@/sandbox/types";
import {
  AT,
  LEGACY_SEED_GOALS,
  PARENT,
  TEEN,
  legacySeedLedger,
  linkedState,
  must,
  teenBalance,
  teenLedger,
  withRules,
} from "./helpers/fixtures";

const SEED_BALANCE = 1850;
// Phase 5: views hold the parent's wallet too — balance is the teen's.
const balance = (s: { ledger: SandboxState["ledger"] }) => teenBalance(s);

function pay(s: SandboxState, amount: number, entryId = `pay_${amount}_${Math.random()}`, at = AT) {
  return payTransition(s, { actorId: SEED_TEEN_ID, at, entryId, recipientId: "rec_riya", amount });
}

describe("limits — daily limit", () => {
  it("counts only today's payments (Asia/Kolkata calendar day)", () => {
    const s = must(pay(withRules({ daily: 500 }), 200, "pay_a"));
    expect(spentOnDay(s.ledger, AT)).toBe(200);
    // 23:59 IST on the 26th is still "today"; 00:01 IST on the 27th is not.
    expect(spentOnDay(s.ledger, "2026-09-26T18:29:00Z")).toBe(200);
    expect(spentOnDay(s.ledger, "2026-09-26T18:31:00Z")).toBe(0);
  });

  it("allows payments within the limit", () => {
    const out = pay(withRules({ daily: 500 }), 300);
    expect(out.result.ok).toBe(true);
    expect(balance(out.state)).toBe(SEED_BALANCE - 300);
  });

  it("rejects ₹350 after ₹300 spent under a ₹500 daily limit — ledger unchanged", () => {
    const s = must(pay(withRules({ daily: 500 }), 300, "pay_first"));
    const out = pay(s, 350, "pay_second");
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe("exceeds_daily_limit");
      expect(out.result.error.message).toMatch(/^This payment would exceed today's spending limit\./);
      expect(out.result.error.message).toMatch(/₹200 left today/);
    }
    expect(out.state).toBe(s);
    expect(out.state.ledger).toHaveLength(s.ledger.length);
  });

  it("allows exactly the remaining amount", () => {
    const s = must(pay(withRules({ daily: 500 }), 300, "pay_first"));
    expect(pay(s, 200, "pay_exact").result.ok).toBe(true);
  });

  it("resets on the next calendar day", () => {
    const s = must(pay(withRules({ daily: 500 }), 500, "pay_today"));
    expect(pay(s, 100, "pay_more").result.ok).toBe(false);
    expect(pay(s, 100, "pay_tomorrow", "2026-09-27T04:00:00Z").result.ok).toBe(true);
  });

  it("computes the remaining limit and never goes negative", () => {
    let s = withRules({ daily: 500 });
    expect(spendingStatus(s, SEED_TEEN_ID, AT)).toMatchObject({
      controlsActive: true,
      todaySpent: 0,
      dailyLimit: 500,
      remainingToday: 500,
    });
    s = must(pay(s, 350, "pay_350"));
    expect(spendingStatus(s, SEED_TEEN_ID, AT).remainingToday).toBe(150);
    // The guardian lowers the limit below today's spend.
    s = withRules({ daily: 100 }, s);
    expect(spendingStatus(s, SEED_TEEN_ID, AT).remainingToday).toBe(0);
  });

  it("moving money to Save is not spending", () => {
    let s = withRules({ daily: 500 });
    s = must(
      moveSpaceMoneyTransition(s, {
        ...TEEN,
        operationId: "save_1",
        spaceId: SEED_SAVE_SPACE_ID,
        amount: 600,
        direction: "add",
      }),
    );
    expect(spentOnDay(s.ledger, AT)).toBe(0);
    expect(pay(s, 500, "pay_ok").result.ok).toBe(true);
  });
});

describe("limits — per-transaction limit", () => {
  it("rejects a payment above the per-payment limit with supportive copy", () => {
    const s = withRules({ perTx: 1000 });
    const out = pay(s, 1200);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) {
      expect(out.result.error.code).toBe("exceeds_transaction_limit");
      expect(out.result.error.message).toMatch(/outside your current spending rules/i);
      expect(out.result.error.message).not.toMatch(/not allowed|blocked/i);
    }
    expect(out.state).toBe(s);
  });

  it("accepts exactly the per-payment limit", () => {
    expect(pay(withRules({ perTx: 1000 }), 1000).result.ok).toBe(true);
  });

  it("is separate from the ₹10,000 technical sandbox cap", () => {
    const out = pay(withRules({}), 10_001);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe("exceeds_sandbox_limit");
  });
});

describe("limits — only active while linked", () => {
  it("no guardian, no rules: large payments within balance just work", () => {
    expect(pay(buildSeedState(), 1500).result.ok).toBe(true);
  });

  it("disconnecting switches rules off", () => {
    let s = withRules({ daily: 100, threshold: 50 });
    expect(pay(s, 90).result.ok).toBe(true);
    s = must(disconnectTransition(s, { ...TEEN, teenId: SEED_TEEN_ID }));
    const out = pay(s, 900, "pay_after");
    expect(out.result.ok).toBe(true);
    if (out.result.ok) expect(out.result.value.status).toBe("completed");
  });

  it("guardian rule inputs are validated", () => {
    const bad = updateSpendingRulesTransition(linkedState(), {
      ...PARENT,
      teenId: SEED_TEEN_ID,
      limits: { dailyLimit: 0, perTransactionLimit: null },
      approval: { threshold: null },
    });
    expect(bad.result.ok).toBe(false);
    const frac = updateSpendingRulesTransition(linkedState(), {
      ...PARENT,
      teenId: SEED_TEEN_ID,
      limits: { dailyLimit: null, perTransactionLimit: 10.5 },
      approval: { threshold: null },
    });
    expect(frac.result.ok).toBe(false);
  });

  it("only the linked guardian can change rules", () => {
    const teenTry = updateSpendingRulesTransition(linkedState(), {
      ...TEEN,
      teenId: SEED_TEEN_ID,
      limits: { dailyLimit: 5000, perTransactionLimit: null },
      approval: { threshold: null },
    });
    expect(teenTry.result.ok).toBe(false);
    if (!teenTry.result.ok) expect(teenTry.result.error.code).toBe("not_permitted");

    const unlinked = updateSpendingRulesTransition(buildSeedState(), {
      ...PARENT,
      teenId: SEED_TEEN_ID,
      limits: { dailyLimit: 500, perTransactionLimit: null },
      approval: { threshold: null },
    });
    expect(unlinked.result.ok).toBe(false);
    if (!unlinked.result.ok) expect(unlinked.result.error.code).toBe("not_linked");
  });

  it("the teen is told when rules change (no hidden restrictions)", () => {
    const s = withRules({ daily: 500, threshold: 500 });
    const note = s.notifications.find(
      (n) => n.recipientId === SEED_TEEN_ID && n.title === "Spending rules updated",
    );
    expect(note?.body).toMatch(/Daily limit ₹500/);
    expect(note?.body).toMatch(/Approval above ₹500/);
    expect(s.familyEvents[0]?.type).toBe("spending_limit_updated");
  });
});

describe("approvals — creation", () => {
  it("a payment above the threshold creates a pending approval and moves nothing", () => {
    const s = withRules({ threshold: 500 });
    const out = pay(s, 750, "pay_750");
    expect(out.result.ok).toBe(true);
    if (out.result.ok) expect(out.result.value.status).toBe("approval_requested");
    expect(balance(out.state)).toBe(SEED_BALANCE);
    expect(out.state.ledger).toBe(s.ledger);
    // Phase 5: no payment operation is recorded while pending.
    expect(out.state.operations).toBe(s.operations);
    const approval = out.state.approvals[0];
    expect(approval).toMatchObject({
      status: "pending",
      amount: 750,
      teenId: SEED_TEEN_ID,
      guardianId: SEED_PARENT_ID,
      recipientId: "rec_riya",
      recipientName: "Riya Patel",
      paymentEntryId: "pay_750",
    });
  });

  it("a payment equal to the threshold does not need approval", () => {
    const out = pay(withRules({ threshold: 500 }), 500);
    expect(out.result.ok).toBe(true);
    if (out.result.ok) expect(out.result.value.status).toBe("completed");
  });

  it("replaying the same payment id never creates a second approval", () => {
    const s = must(pay(withRules({ threshold: 500 }), 750, "pay_750"));
    const again = pay(s, 750, "pay_750");
    expect(again.result.ok).toBe(true);
    expect(again.state).toBe(s);
    expect(again.state.approvals).toHaveLength(1);
  });

  it("approval requests still require enough balance", () => {
    const out = pay(withRules({ threshold: 500 }), 5000);
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe("insufficient_balance");
  });

  it("notifies the teen and the parent", () => {
    const s = must(pay(withRules({ threshold: 500 }), 750, "pay_750"));
    const teen = s.notifications.find((n) => n.recipientId === SEED_TEEN_ID && n.kind === "approval");
    const parent = s.notifications.find((n) => n.recipientId === SEED_PARENT_ID && n.kind === "approval");
    expect(teen?.title).toBe("Approval requested");
    expect(teen?.body).toBe("Your ₹750 payment to Riya Patel is waiting for Priya.");
    expect(parent?.title).toBe("New approval request");
    expect(parent?.body).toBe("Aarav wants to send ₹750 to Riya Patel.");
  });

  it("the evaluate step exposes the decision for the UI (single rules source)", () => {
    const s = withRules({ threshold: 500, daily: 500 });
    const d = evaluatePayment(s, { teenId: SEED_TEEN_ID, recipientId: "rec_riya", amount: 750, at: AT });
    expect(d.kind).toBe("needs_approval");
  });
});

describe("approvals — decisions", () => {
  const pending = () => must(pay(withRules({ threshold: 500 }), 750, "pay_750"));
  const approvalId = "apr_pay_750";

  it("approve executes the payment through the ledger exactly once", () => {
    const out = decideApprovalTransition(pending(), { ...PARENT, approvalId, decision: "approve" });
    expect(out.result.ok).toBe(true);
    expect(balance(out.state)).toBe(SEED_BALANCE - 750);
    const entries = out.state.ledger.filter((e) => e.id === "pay_750");
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("payment_sent");
    // Phase 5: the payment record is an operation linked to the approval.
    const ops = out.state.operations.filter((op) => op.id === "pay_750");
    expect(ops).toHaveLength(1);
    expect(ops[0]?.type).toBe("payment");
    expect(ops[0]?.approvalId).toBe(approvalId);
    expect(out.state.approvals[0]?.status).toBe("approved");
    expect(out.state.approvals[0]?.decidedBy).toBe(SEED_PARENT_ID);
  });

  it("double approve is idempotent — never a second debit", () => {
    const once = must(decideApprovalTransition(pending(), { ...PARENT, approvalId, decision: "approve" }));
    const twice = decideApprovalTransition(once, { ...PARENT, approvalId, decision: "approve" });
    expect(twice.result.ok).toBe(true);
    expect(twice.state).toBe(once);
    expect(balance(twice.state)).toBe(SEED_BALANCE - 750);
    expect(twice.state.ledger.filter((e) => e.id === "pay_750")).toHaveLength(1);
  });

  it("the teen's original payment id replayed after approval does not double-post", () => {
    const once = must(decideApprovalTransition(pending(), { ...PARENT, approvalId, decision: "approve" }));
    const replay = pay(once, 750, "pay_750");
    expect(replay.state).toBe(once);
  });

  it("approved: teen is notified once (no duplicate 'Payment sent')", () => {
    const s = must(decideApprovalTransition(pending(), { ...PARENT, approvalId, decision: "approve" }));
    const teenNotes = s.notifications.filter((n) => n.recipientId === SEED_TEEN_ID);
    expect(teenNotes.filter((n) => n.title === "Payment approved")).toHaveLength(1);
    expect(teenNotes.find((n) => n.title === "Payment approved")?.body).toBe(
      "Priya approved ₹750 to Riya Patel. It's been sent.",
    );
    expect(teenNotes.filter((n) => n.title === "Payment sent" && n.body.includes("₹750"))).toHaveLength(0);
  });

  it("decline moves no money and notifies the teen", () => {
    const before = pending();
    const out = decideApprovalTransition(before, { ...PARENT, approvalId, decision: "decline" });
    expect(out.result.ok).toBe(true);
    expect(out.state.ledger).toBe(before.ledger);
    expect(balance(out.state)).toBe(SEED_BALANCE);
    expect(out.state.approvals[0]?.status).toBe("declined");
    const note = out.state.notifications.find((n) => n.title === "Payment not approved");
    expect(note?.recipientId).toBe(SEED_TEEN_ID);
    expect(note?.body).toMatch(/No money moved/);
  });

  it("a declined request cannot be approved later", () => {
    const declined = must(decideApprovalTransition(pending(), { ...PARENT, approvalId, decision: "decline" }));
    const out = decideApprovalTransition(declined, { ...PARENT, approvalId, decision: "approve" });
    expect(out.result.ok).toBe(false);
    expect(balance(out.state)).toBe(SEED_BALANCE);
  });

  it("only the connected guardian can decide", () => {
    const out = decideApprovalTransition(pending(), { ...TEEN, approvalId, decision: "approve" });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe("not_permitted");
  });

  it("re-checks balance at approval time and stays pending if short", () => {
    let s = pending();
    s = must(
      moveSpaceMoneyTransition(s, {
        ...TEEN,
        operationId: "save_big",
        spaceId: SEED_SAVE_SPACE_ID,
        amount: 1500,
        direction: "add",
      }),
    );
    const out = decideApprovalTransition(s, { ...PARENT, approvalId, decision: "approve" });
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.message).toMatch(/isn't enough/);
    expect(out.state.approvals.find((a) => a.id === approvalId)?.status).toBe("pending");
  });

  it("approval overrides the daily limit for that payment and counts toward today", () => {
    let s = withRules({ daily: 500, threshold: 500 });
    s = must(pay(s, 200, "pay_200"));
    s = must(pay(s, 750, "pay_750"));
    s = must(decideApprovalTransition(s, { ...PARENT, approvalId, decision: "approve" }));
    expect(spentOnDay(s.ledger, AT)).toBe(950);
    expect(pay(s, 50, "pay_50").result.ok).toBe(false);
  });

  it("the per-payment limit still applies when approving", () => {
    let s = pending();
    s = withRules({ threshold: 500, perTx: 600 }, s);
    const out = decideApprovalTransition(s, { ...PARENT, approvalId, decision: "approve" });
    expect(out.result.ok).toBe(false);
    expect(balance(out.state)).toBe(SEED_BALANCE);
  });

  it("the teen can cancel a pending request; the parent is told", () => {
    const out = cancelApprovalTransition(pending(), { ...TEEN, approvalId });
    expect(out.result.ok).toBe(true);
    expect(out.state.approvals[0]?.status).toBe("cancelled");
    expect(
      out.state.notifications.some(
        (n) => n.recipientId === SEED_PARENT_ID && n.title === "Approval request withdrawn",
      ),
    ).toBe(true);
    const late = decideApprovalTransition(out.state, { ...PARENT, approvalId, decision: "approve" });
    expect(late.result.ok).toBe(false);
  });

  it("disconnecting cancels pending approvals without moving money", () => {
    const s = must(disconnectTransition(pending(), { ...PARENT, teenId: SEED_TEEN_ID }));
    expect(s.approvals[0]?.status).toBe("cancelled");
    expect(s.approvals[0]?.cancelReason).toBe("Family disconnected");
    expect(balance(s)).toBe(SEED_BALANCE);
  });
});

describe("allowance — one-time and schedule", () => {
  it("allowance still credits the teen through the ledger once linked", () => {
    const out = sendAllowanceTransition(linkedState(), { ...PARENT, operationId: "allow_1", amount: 500 });
    expect(out.result.ok).toBe(true);
    expect(balance(out.state)).toBe(SEED_BALANCE + 500);
    // Phase 5: one operation, two sides — the teen's side is the credit.
    const entry = teenLedger(out.state).find((e) => e.operationId === "allow_1");
    expect(entry?.type).toBe("allowance_credit");
    expect(entry?.counterparty).toMatchObject({ kind: "guardian", id: SEED_PARENT_ID, name: "Priya" });
    expect(out.state.notifications[0]?.body).toBe("₹500 from Priya is in Aarav's wallet.");
    // Idempotent.
    const again = sendAllowanceTransition(out.state, { ...PARENT, operationId: "allow_1", amount: 500 });
    expect(balance(again.state)).toBe(SEED_BALANCE + 500);
  });

  // Phase 7: the preview became a real schedule. Same guarantees
  // (cadence copy, next date, notification, nothing moves on save),
  // now asserted on the stored schedule record.
  it("stores a weekly schedule and previews the next date", () => {
    const cadence = { frequency: "weekly" as const, dayOfWeek: 1, dayOfMonth: 1 };
    const out = createPocketMoneyScheduleTransition(linkedState(), {
      ...PARENT,
      scheduleId: "pms_weekly",
      teenId: SEED_TEEN_ID,
      amount: 500,
      ...cadence,
      startDate: "2026-09-26",
    });
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return;
    const s = out.state;
    expect(s.schedules[0]).toMatchObject({
      id: "pms_weekly",
      amount: 500,
      frequency: "weekly",
      dayOfWeek: 1,
      status: "active",
      parentAccountId: SEED_PARENT_ID,
      teenAccountId: SEED_TEEN_ID,
      version: 1,
      runs: [],
    });
    expect(describeScheduleCadence(cadence)).toBe("Every Monday");
    // 26 Sep 2026 is a Saturday → next Monday is 28 Sep.
    expect(nextAllowanceDate(cadence, AT)).toBe("2026-09-28");
    expect(out.result.value.nextOccurrence).toBe("2026-09-28");
    // Scheduling moves no money.
    expect(balance(s)).toBe(SEED_BALANCE);
    expect(s.ledger).toEqual(linkedState().ledger);
    expect(s.notifications[0]?.title).toBe("Pocket money scheduled");
  });

  it("monthly schedule preview", () => {
    const cadence = { frequency: "monthly" as const, dayOfWeek: 1, dayOfMonth: 1 };
    expect(nextAllowanceDate(cadence, AT)).toBe("2026-10-01");
    expect(describeScheduleCadence(cadence)).toBe("On the 1st of every month");
  });

  it("rejects invalid schedules", () => {
    const out = createPocketMoneyScheduleTransition(linkedState(), {
      ...PARENT,
      scheduleId: "pms_bad",
      teenId: SEED_TEEN_ID,
      amount: 500,
      frequency: "monthly",
      dayOfWeek: 1,
      dayOfMonth: 31,
      startDate: "2026-09-26",
    });
    expect(out.result.ok).toBe(false);
    expect(out.state.schedules).toHaveLength(0);
  });
});

describe("notifications — guardian preferences", () => {
  it("payments notify the parent only when they opted in", () => {
    let s = linkedState();
    s = must(pay(s, 100, "pay_quiet"));
    expect(s.notifications.some((n) => n.recipientId === SEED_PARENT_ID && n.title.includes("sent a payment"))).toBe(false);
    s = must(updateGuardianNotificationsTransition(s, { ...PARENT, teenId: SEED_TEEN_ID, payments: true, savings: true }));
    s = must(pay(s, 100, "pay_loud"));
    expect(s.notifications.some((n) => n.recipientId === SEED_PARENT_ID && n.title === "Aarav sent a payment")).toBe(true);
    // The teen is told about the preference change.
    expect(s.notifications.some((n) => n.recipientId === SEED_TEEN_ID && n.title === "Parent notifications updated")).toBe(true);
  });

  it("reading notifications never changes money", () => {
    const s = linkedState();
    const read = { ...s, notifications: s.notifications.map((n) => ({ ...n, read: true })) };
    expect(read.ledger).toBe(s.ledger);
  });
});

// Phase 4: the persisted schema is v3 (a database of accounts,
// families and wallets). These keep the Phase 3 intent on it.
describe("persistence — schema v3", () => {
  it("guardian-controlled state is a valid database and survives a JSON round trip", () => {
    const s = must(pay(withRules({ threshold: 500 }), 750, "pay_750"));
    const round: unknown = JSON.parse(JSON.stringify(databaseFromState(s)));
    expect(isSandboxDatabase(round)).toBe(true);
  });

  it("rejects a membership pointing at an unknown account", () => {
    const db = databaseFromState(linkedState());
    const broken = {
      ...db,
      families: db.families.map((f) => ({
        ...f,
        members: [...f.members, { ...f.members[0]!, id: "mem_x", accountId: "usr_ghost" }],
      })),
    };
    expect(isSandboxDatabase(JSON.parse(JSON.stringify(broken)))).toBe(false);
  });

  it("migrates a Phase 2 (v1) payload: money kept, family starts unlinked", () => {
    const seed = buildSeedState();
    const v1 = {
      version: 1,
      ledger: [
        ...legacySeedLedger(),
        {
          id: "pay_old",
          type: "payment_sent",
          direction: "debit",
          amount: 100,
          currency: "INR",
          description: "Old",
          counterparty: { kind: "person", id: "rec_riya", name: "Riya Patel" },
          createdAt: "2026-09-25T10:00:00Z",
        },
      ],
      payments: [],
      requests: [],
      notifications: [{ id: "n1", kind: "money", title: "Payment sent", body: "x", read: false, createdAt: AT }],
      recipients: seed.recipients,
      goals: LEGACY_SEED_GOALS,
      family: { teen: {}, parent: {}, familyName: "Sharma family" },
    };
    // Phase 9: v1 → v3 → v4 → v5 → v6 → v7 → v8.
    const migrated = migrateV7(
      migrateV6(
        migrateV5(
          migrateV4(migrateV3(migrateV1(JSON.parse(JSON.stringify(v1)), buildSeedState)), AT),
          AT,
        ),
      ),
    );
    expect(isSandboxDatabase(JSON.parse(JSON.stringify(migrated)))).toBe(true);
    expect(balance(migrated)).toBe(SEED_BALANCE - 100);
    expect(migrated.notifications[0]?.recipientId).toBe(SEED_TEEN_ID);
    expect(migrated.families[0]?.links[0]?.status).toBe("not_linked");
  });
});
