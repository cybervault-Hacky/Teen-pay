import { describe, expect, it } from "vitest";
import { coachWindows, type CoachReport, type LedgerEntry } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import { coachFactsFor, coachReportFor, periodTotals } from "@/sandbox/coach";
import { sendMoneyTransition } from "@/sandbox/peer-transitions";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, SEED_GOAL_SPACE_ID, SEED_PARENT_ID, SEED_PEER_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { decideApprovalTransition, payTransition, refundTransition } from "@/sandbox/transitions";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { linkedDatabase } from "./helpers/fixtures";

/**
 * Money Coach analytics (Phase 10) against the real engine: seed
 * numbers, what counts as spending and income, pending / declined /
 * failed payments, Spaces, privacy and determinism. Explicit clock.
 */

const NOW = "2026-09-27T10:00:00Z";
const AT = "2026-09-27T09:00:00Z";

function report(db: SandboxDatabase, accountId: string, period: "week" | "month" | "30d" = "month"): CoachReport {
  const r = coachReportFor(db, accountId, period, NOW);
  if (!r.ok) throw new Error(`no report: ${r.error.code}`);
  return r.value;
}

function run(
  db: SandboxDatabase,
  actorId: string,
  fn: (s: SandboxState) => { state: SandboxState; result: { ok: boolean } },
): { db: SandboxDatabase; ok: boolean; result: unknown } {
  const scope = scopeFor(db, actorId);
  if (!scope) throw new Error(`no scope for ${actorId}`);
  const out = fn(scope.state);
  return { db: out.result.ok ? mergeScope(db, scope.info, scope.state, out.state) : db, ok: out.result.ok, result: out.result };
}

const pay = (db: SandboxDatabase, amount: number, key: string) =>
  run(db, SEED_TEEN_ID, (s) =>
    payTransition(s, { actorId: SEED_TEEN_ID, at: AT, entryId: key, recipientId: "rec_riya", amount }),
  );

describe("Coach analytics — seed numbers", () => {
  const db = buildSeedDatabase();

  it("month: ₹4,500 received (all pocket money, 3 times), ₹350 spent, ₹2,300 set aside, 51%", () => {
    const r = report(db, SEED_TEEN_ID, "month");
    expect(r.summary).toMatchObject({
      availableBalance: 1850,
      setAside: 2300,
      totalBalance: 4150,
      totalReceived: 4500,
      pocketMoneyReceived: 4500,
      totalSpent: 350,
      spendingTransactionCount: 1,
      netSetAside: 2300,
      savingRate: { kind: "rate", percent: 51 },
      spendingComparison: { kind: "not_enough_data" },
      generatedAt: "2026-09-27",
    });
    expect(r.summary.received).toEqual({ pocketMoney: 4500, fromPeople: 0, sandbox: 0, total: 4500 });
    expect(r.lowData).toBe(true); // wallet opened Sep 1 — nothing to compare with in August
    expect(r.empty).toBe(false);
    expect(r.headline).toBe("You set aside ₹2,300 this month.");
  });

  it("week: ₹350 spent vs ₹0 the week before, ₹500 received, nothing set aside", () => {
    const r = report(db, SEED_TEEN_ID, "week");
    expect(r.summary).toMatchObject({
      totalSpent: 350,
      totalReceived: 500,
      netSetAside: 0,
      savingRate: { kind: "rate", percent: 0 },
      spendingComparison: { kind: "compared", previous: 0, change: "up", percent: null },
    });
    expect(r.lowData).toBe(false);
    const change = r.insights.find((i) => i.kind === "spending_change")!;
    expect(change.title).toBe("You spent ₹350 this week.");
    expect(change.explanation).toContain("You didn't spend anything from Sep 14–20.");
  });

  it("30 days: same totals as the month for this seed; not comparable", () => {
    const r = report(db, SEED_TEEN_ID, "30d");
    expect(r.summary.range).toMatchObject({ startDay: "2026-08-29", endDay: "2026-09-27" });
    expect(r.summary).toMatchObject({ totalSpent: 350, totalReceived: 4500, netSetAside: 2300 });
    expect(r.summary.spendingComparison).toEqual({ kind: "not_enough_data" });
  });

  it("balances and goals come from the existing selectors (no second calculation)", () => {
    const r = report(db, SEED_TEEN_ID);
    expect(r.goals.map((g) => [g.name, g.type, g.balance, g.target, g.percent, g.href])).toEqual([
      ["Save", "save", 800, 2000, 40, "/money"],
      ["New Bike", "goal", 1500, 2500, 60, `/money/${SEED_GOAL_SPACE_ID}`],
    ]);
    const bike = r.goals.find((g) => g.name === "New Bike")!;
    expect(bike).toMatchObject({ remaining: 1000, reached: false, deadline: "2026-11-30", daysLeft: 64, deadlineState: "upcoming" });
    const insights = r.insights.map((i) => i.title);
    expect(insights).toContain("You have ₹1,850 available and ₹2,300 set aside.");
    expect(insights).toContain("Your New Bike goal is 60% complete.");
    expect(insights).toContain("Save is 40% of the way to its ₹2,000 target.");
  });
});

describe("Coach analytics — what counts", () => {
  it("classifies every ledger type once: spending, income, refunds, Spaces, reversals", () => {
    const at = "2026-09-20T06:00:00Z";
    const e = (type: LedgerEntry["type"], direction: "credit" | "debit", amount: number): LedgerEntry =>
      ({ id: `${type}_${amount}`, walletId: "w", type, direction, amount, status: "completed", createdAt: at }) as unknown as LedgerEntry;
    const entries = [
      e("payment_sent", "debit", 100),
      e("transfer_out", "debit", 40),
      e("allowance_credit", "credit", 500),
      e("transfer_in", "credit", 30),
      e("payment_received", "credit", 20),
      e("deposit", "credit", 1000),
      e("refund", "credit", 25),
      e("reversal", "debit", 999),
      e("adjustment", "credit", 7),
      e("allowance_debit", "debit", 500),
      e("space_allocation", "debit", 300),
      e("space_release", "credit", 50),
    ];
    const t = periodTotals(entries, coachWindows("month", NOW).current);
    expect(t).toMatchObject({ spent: 140, spendingCount: 2, payments: 100, transfers: 40, refunded: 25, movedToSpaces: 300, movedFromSpaces: 50, pocketMoneyCount: 1 });
    expect(t.received).toEqual({ pocketMoney: 500, fromPeople: 50, sandbox: 1000, total: 1550 });
    // Outside the window: nothing counts.
    expect(periodTotals(entries, coachWindows("week", NOW).current).spent).toBe(0);
  });

  it("a completed payment increases spent; available drops; set aside doesn't change", () => {
    const before = report(buildSeedDatabase(), SEED_TEEN_ID);
    const out = pay(buildSeedDatabase(), 200, "ent_coach_a");
    expect(out.ok).toBe(true);
    const after = report(out.db, SEED_TEEN_ID);
    expect(after.summary.totalSpent).toBe(before.summary.totalSpent + 200);
    expect(after.summary.spendingTransactionCount).toBe(2);
    expect(after.summary.availableBalance).toBe(before.summary.availableBalance - 200);
    expect(after.summary.setAside).toBe(before.summary.setAside);
    expect(after.summary.totalReceived).toBe(before.summary.totalReceived);
  });

  it("a pending payment isn't spending, and still isn't after it's declined", () => {
    let db = linkedDatabase({ threshold: 100 });
    const base = report(db, SEED_TEEN_ID).summary;
    const out = pay(db, 300, "ent_coach_pending");
    expect(out.ok).toBe(true);
    expect(out.result).toMatchObject({ value: { status: "approval_requested" } });
    db = out.db;
    const pending = report(db, SEED_TEEN_ID);
    expect(pending.summary.totalSpent).toBe(base.totalSpent);
    expect(pending.summary.availableBalance).toBe(base.availableBalance);
    expect(pending.insights[0]).toMatchObject({ kind: "pending_approval", title: "₹300 is waiting for approval." });

    const approvalId = db.teenRecords.flatMap((r) => r.approvals).find((a) => a.status === "pending")!.id;
    const declined = run(db, SEED_PARENT_ID, (s) =>
      decideApprovalTransition(s, { actorId: SEED_PARENT_ID, at: AT, approvalId, decision: "decline" }),
    );
    expect(declined.ok).toBe(true);
    const after = report(declined.db, SEED_TEEN_ID);
    expect(after.summary.totalSpent).toBe(base.totalSpent);
    expect(after.summary.spendingTransactionCount).toBe(base.spendingTransactionCount);
    expect(after.insights.some((i) => i.kind === "pending_approval")).toBe(false);
  });

  it("a failed payment writes nothing and changes nothing", () => {
    const db = buildSeedDatabase();
    const out = pay(db, 99999, "ent_coach_fail");
    expect(out.ok).toBe(false);
    expect(report(out.db, SEED_TEEN_ID).summary).toEqual(report(db, SEED_TEEN_ID).summary);
  });

  it("money from a friend is received (from people), never spending; sending is spending", () => {
    const db = buildSeedDatabase();
    const inbound = sendMoneyTransition(db, { actorId: SEED_PEER_ID, at: AT, recipient: "@aarav", amount: 150, idempotencyKey: "coach-in" });
    expect(inbound.result.ok).toBe(true);
    const r = report(inbound.db, SEED_TEEN_ID).summary;
    expect(r.received).toMatchObject({ fromPeople: 150, total: 4650 });
    expect(r.totalSpent).toBe(350);

    const outbound = sendMoneyTransition(inbound.db, { actorId: SEED_TEEN_ID, at: AT, recipient: "@meera", amount: 60, idempotencyKey: "coach-out" });
    expect(outbound.result.ok).toBe(true);
    const s = report(outbound.db, SEED_TEEN_ID);
    expect(s.summary.totalSpent).toBe(410);
    expect(s.summary.spendingTransactionCount).toBe(2);
    expect(s.insights.find((i) => i.kind === "spending_split")?.title).toBe("Most of your spending was payments.");
  });

  it("moving money into a Space raises set aside, isn't spending; moving back reduces the net", () => {
    const db = buildSeedDatabase();
    const move = (d: SandboxDatabase, amount: number, direction: "add" | "withdraw", key: string) =>
      run(d, SEED_TEEN_ID, (s) =>
        moveSpaceMoneyTransition(s, { actorId: SEED_TEEN_ID, at: AT, operationId: key, spaceId: SEED_SAVE_SPACE_ID, amount, direction }),
      );
    const added = move(db, 200, "add", "coach-add");
    expect(added.ok).toBe(true);
    const a = report(added.db, SEED_TEEN_ID, "week").summary;
    expect(a).toMatchObject({ setAside: 2500, availableBalance: 1650, netSetAside: 200, totalSpent: 350, totalReceived: 500 });
    expect(a.savingRate).toEqual({ kind: "rate", percent: 40 });

    const back = move(added.db, 300, "withdraw", "coach-back");
    expect(back.ok).toBe(true);
    const b = report(back.db, SEED_TEEN_ID, "week");
    expect(b.summary).toMatchObject({ setAside: 2200, netSetAside: -100, totalSpent: 350 });
    expect(b.summary.savingRate).toEqual({ kind: "moved_out", amount: 100 });
    expect(b.insights.find((i) => i.kind === "moved_from_spaces")?.title).toBe(
      "You moved ₹100 from Spaces back to available this week.",
    );
  });

  it("a refund is money back — shown separately, never income or negative spending", () => {
    const paid = pay(buildSeedDatabase(), 200, "ent_coach_refund");
    const refunded = run(paid.db, SEED_TEEN_ID, (s) =>
      refundTransition(s, { actorId: SEED_TEEN_ID, at: AT, entryId: "ent_coach_refund", operationId: "coach-refund" }),
    );
    expect(refunded.ok).toBe(true);
    const r = report(refunded.db, SEED_TEEN_ID).summary;
    expect(r.refunded).toBe(200);
    expect(r.totalSpent).toBe(550);
    expect(r.totalReceived).toBe(4500);
  });
});

describe("Coach privacy", () => {
  it("parents get no Coach — not their own, not the teen's", () => {
    for (const db of [buildSeedDatabase(), linkedDatabase()]) {
      const r = coachReportFor(db, SEED_PARENT_ID, "month", NOW);
      expect(r).toEqual({ ok: false, error: { code: "not_permitted", message: "Money Coach is available on teen accounts." } });
    }
    // Even handed the linked parent's scoped state directly, the facts are null.
    const scope = scopeFor(linkedDatabase(), SEED_PARENT_ID)!;
    expect(coachFactsFor(scope.state, "month", NOW)).toBeNull();
  });

  it("unknown or empty accounts get nothing", () => {
    expect(coachReportFor(buildSeedDatabase(), "usr_nobody", "month", NOW).ok).toBe(false);
    expect(coachReportFor(buildSeedDatabase(), "", "month", NOW).ok).toBe(false);
  });

  it("another teen sees only their own money", () => {
    const db = buildSeedDatabase();
    const meera = report(db, SEED_PEER_ID);
    expect(meera.summary.availableBalance).toBe(1200);
    expect(meera.summary.received).toMatchObject({ pocketMoney: 0, sandbox: 1200 });
    expect(meera.goals.map((g) => g.name)).not.toContain("New Bike");
    const json = JSON.stringify(meera);
    expect(json).not.toMatch(/1,850|2,300|New Bike|Aarav/);
  });

  it("a brand-new teen gets the empty state", () => {
    const created = createAccount(buildSeedDatabase(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in created) throw new Error(created.message);
    const r = report(created.db, created.account.id);
    expect(r.empty).toBe(true);
    expect(r.insights).toEqual([]);
    expect(r.headline).toBe("Your Money Coach is getting to know your money.");
    expect(r.summary).toMatchObject({ availableBalance: 0, setAside: 0, totalSpent: 0, totalReceived: 0 });
    expect(r.summary.savingRate).toEqual({ kind: "not_enough_data" });
    // A brand-new parent: no Coach at all.
    const parent = createAccount(created.db, { role: "parent", displayName: "Anil Rao", username: "anilrao" }, AT);
    if ("code" in parent) throw new Error(parent.message);
    expect(coachReportFor(parent.db, parent.account.id, "month", NOW).ok).toBe(false);
  });

  it("reports contain no internal ids, guardian settings or notifications", () => {
    const db = linkedDatabase({ threshold: 100, daily: 1000 });
    for (const period of ["week", "month", "30d"] as const) {
      const json = JSON.stringify(report(db, SEED_TEEN_ID, period));
      expect(json).not.toMatch(/usr_|wal_|fam_|ope_|ntf_|ent_|apr_|inv_|sched|dailyLimit|threshold|guardian|notification|token|session/i);
    }
  });
});

describe("Coach determinism and read-only guarantee", () => {
  it("same data and day → identical output; independent of call order", () => {
    const a = coachReportFor(buildSeedDatabase(), SEED_TEEN_ID, "week", NOW);
    const b = coachReportFor(structuredClone(buildSeedDatabase()), SEED_TEEN_ID, "week", NOW);
    expect(a).toEqual(b);
    // A different time on the same IST day gives the same report.
    const c = coachReportFor(buildSeedDatabase(), SEED_TEEN_ID, "week", "2026-09-27T17:00:00Z");
    expect(c).toEqual(a);
  });

  it("is memoized per database snapshot, account, period and day", () => {
    const db = buildSeedDatabase();
    const first = coachReportFor(db, SEED_TEEN_ID, "month", NOW);
    expect(coachReportFor(db, SEED_TEEN_ID, "month", NOW)).toBe(first);
    expect(coachReportFor(db, SEED_TEEN_ID, "week", NOW)).not.toBe(first);
    expect(coachReportFor(db, SEED_PEER_ID, "month", NOW)).not.toBe(first);
    // A new snapshot (money moved) is recalculated.
    const moved = pay(db, 50, "ent_coach_memo").db;
    const next = coachReportFor(moved, SEED_TEEN_ID, "month", NOW);
    expect(next).not.toBe(first);
    expect(next.ok && next.value.summary.totalSpent).toBe(400);
  });

  it("never changes the database", () => {
    const db = linkedDatabase({ threshold: 100 });
    const before = JSON.stringify(db);
    for (const id of [SEED_TEEN_ID, SEED_PARENT_ID, SEED_PEER_ID, "usr_nobody"]) {
      for (const period of ["week", "month", "30d"] as const) coachReportFor(db, id, period, NOW);
    }
    expect(JSON.stringify(db)).toBe(before);
  });
});
