import { describe, expect, it } from "vitest";
import {
  countOccurrences,
  describePocketMoneyCadence,
  dueInstant,
  firstOccurrenceOnOrAfter,
  INSUFFICIENT_FUNDS_MESSAGE,
  latestOccurrenceBetween,
  nextOccurrenceAfter,
  pocketMoneyExecutionId,
  upcomingOccurrence,
  validatePocketMoneyInput,
} from "@/domain";
import {
  cancelPocketMoneyScheduleTransition,
  createPocketMoneyScheduleTransition,
  executeDuePocketMoneyTransition,
  pausePocketMoneyScheduleTransition,
  resumePocketMoneyScheduleTransition,
  updatePocketMoneyScheduleTransition,
  type CreatePocketMoneyInput,
} from "@/sandbox/allowance-transitions";
import { disconnectTransition } from "@/sandbox/family-transitions";
import { spentOnDay } from "@/sandbox/rules";
import {
  getTransaction,
  selectAvailableBalance,
  selectNextPocketMoney,
  selectPocketMoneyExecutions,
  selectPocketMoneyTotals,
  selectScheduleHistory,
  selectScheduleSummary,
  selectSchedulesForParent,
  selectSchedulesForTeen,
  selectTotal,
  selectTransactions,
  selectUpcomingPocketMoney,
} from "@/sandbox/selectors";
import { SEED_PARENT_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { payTransition, setWalletStatusTransition } from "@/sandbox/transitions";
import type { SandboxState } from "@/sandbox/types";
import {
  AT,
  PARENT,
  PARENT_WALLET,
  TEEN,
  TEEN_WALLET,
  balanceOf,
  linkedState,
  must,
  withRules,
} from "./helpers/fixtures";

// 26 Sep 2026 (AT) is a Saturday. A weekly Monday plan starting that
// day first runs on Mon 28 Sep, then Mon 5 Oct, 12 Oct, ...
const MON1 = "2026-09-28T06:00:00Z";
const MON2 = "2026-10-05T06:00:00Z";
const MON3 = "2026-10-12T06:00:00Z";
const PARENT_START = 5500;
const TEEN_START = 1850;

function plan(overrides: Partial<CreatePocketMoneyInput> = {}): CreatePocketMoneyInput {
  return {
    ...PARENT,
    scheduleId: "pms_1",
    teenId: SEED_TEEN_ID,
    amount: 500,
    frequency: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 1,
    startDate: "2026-09-26",
    ...overrides,
  };
}

function scheduled(overrides: Partial<CreatePocketMoneyInput> = {}, base = linkedState()): SandboxState {
  return must(createPocketMoneyScheduleTransition(base, plan(overrides)));
}

function execute(s: SandboxState, asOf: string, extra: { scheduleId?: string; actorId?: string } = {}) {
  return executeDuePocketMoneyTransition(s, { ...PARENT, at: asOf, asOf, ...extra });
}

const schedule = (s: SandboxState, id = "pms_1") => s.schedules.find((x) => x.id === id)!;
const parentMoney = (s: SandboxState) => balanceOf(s, SEED_PARENT_ID);
const teenMoney = (s: SandboxState) => balanceOf(s, SEED_TEEN_ID);
const scheduledOps = (s: SandboxState) => s.operations.filter((op) => op.scheduleId !== undefined);

function frozen(s: SandboxState, walletId: string): SandboxState {
  return { ...s, wallets: s.wallets.map((w) => (w.id === walletId ? { ...w, status: "frozen" as const } : w)) };
}

// ── Domain: calendar and validation ──────────────────────────────

describe("pocket money domain — calendar", () => {
  const weekly = { frequency: "weekly" as const, dayOfWeek: 1, dayOfMonth: 1 };
  const monthly = { frequency: "monthly" as const, dayOfWeek: 1, dayOfMonth: 15 };

  it("finds the first, next and latest occurrences deterministically", () => {
    expect(firstOccurrenceOnOrAfter(weekly, "2026-09-26")).toBe("2026-09-28");
    expect(firstOccurrenceOnOrAfter(weekly, "2026-09-28")).toBe("2026-09-28");
    expect(nextOccurrenceAfter(weekly, "2026-09-28")).toBe("2026-10-05");
    expect(firstOccurrenceOnOrAfter(monthly, "2026-09-26")).toBe("2026-10-15");
    expect(nextOccurrenceAfter(monthly, "2026-12-15")).toBe("2027-01-15");
    expect(latestOccurrenceBetween(weekly, "2026-09-28", "2026-10-20")).toBe("2026-10-19");
    expect(latestOccurrenceBetween(weekly, "2026-09-29", "2026-10-04")).toBeNull();
    expect(countOccurrences(weekly, "2026-09-28", "2026-10-19")).toBe(3);
    expect(countOccurrences(monthly, "2026-10-15", "2027-01-15")).toBe(3);
  });

  it("an occurrence is due at 00:00 IST and has one execution id", () => {
    expect(dueInstant("2026-09-28")).toBe("2026-09-27T18:30:00.000Z");
    expect(pocketMoneyExecutionId("pms_1", "2026-09-28")).toBe("pms_1:2026-09-28");
    expect(describePocketMoneyCadence(weekly)).toBe("Every Monday");
    expect(describePocketMoneyCadence({ ...monthly, dayOfMonth: 22 })).toBe("On the 22nd of every month");
  });

  it("upcoming skips processed occurrences and respects the end date", () => {
    const base = { ...weekly, startDate: "2026-09-26", runs: [] };
    expect(upcomingOccurrence(base, "2026-09-26")).toBe("2026-09-28");
    const ran = { ...base, runs: [{ occurrence: "2026-09-28" }] } as unknown as Parameters<typeof upcomingOccurrence>[0];
    expect(upcomingOccurrence(ran, "2026-09-28")).toBe("2026-10-05");
    expect(upcomingOccurrence({ ...base, endDate: "2026-09-27" }, "2026-09-26")).toBeNull();
  });

  it("validates amount, days and dates", () => {
    const ok = { amount: 500, ...weekly, startDate: "2026-09-26" };
    expect(validatePocketMoneyInput(ok, "2026-09-26")).toBeNull();
    expect(validatePocketMoneyInput({ ...ok, amount: 0 }, "2026-09-26")?.field).toBe("amount");
    expect(validatePocketMoneyInput({ ...ok, amount: -5 }, "2026-09-26")?.field).toBe("amount");
    expect(validatePocketMoneyInput({ ...ok, amount: 12.5 }, "2026-09-26")?.field).toBe("amount");
    expect(validatePocketMoneyInput({ ...ok, amount: 10_001 }, "2026-09-26")?.field).toBe("amount");
    expect(validatePocketMoneyInput({ ...ok, dayOfWeek: 7 }, "2026-09-26")?.field).toBe("day");
    expect(validatePocketMoneyInput({ ...ok, ...monthly, dayOfMonth: 29 }, "2026-09-26")?.field).toBe("day");
    expect(validatePocketMoneyInput({ ...ok, startDate: "2026-09-25" }, "2026-09-26")?.field).toBe("startDate");
    expect(validatePocketMoneyInput({ ...ok, startDate: "2026-02-30" }, "2026-01-01")?.field).toBe("startDate");
    expect(validatePocketMoneyInput({ ...ok, endDate: "2026-09-25" }, "2026-09-26")?.field).toBe("endDate");
    // No Monday between Sat 26 and Sun 27 Sep.
    expect(validatePocketMoneyInput({ ...ok, endDate: "2026-09-27" }, "2026-09-26")?.message).toMatch(
      /no transfer day/i,
    );
  });
});

// ── Create ───────────────────────────────────────────────────────

describe("pocket money — create", () => {
  it("stores an active schedule between the two primary wallets and moves no money", () => {
    const out = createPocketMoneyScheduleTransition(linkedState(), plan());
    expect(out.result.ok).toBe(true);
    const s = out.state;
    expect(schedule(s)).toMatchObject({
      parentAccountId: SEED_PARENT_ID,
      teenAccountId: SEED_TEEN_ID,
      sourceWalletId: PARENT_WALLET,
      destinationWalletId: TEEN_WALLET,
      amount: 500,
      currency: "INR",
      frequency: "weekly",
      dayOfWeek: 1,
      startDate: "2026-09-26",
      nextRunAt: dueInstant("2026-09-28"),
      status: "active",
      createdBy: SEED_PARENT_ID,
      createdAt: AT,
      version: 1,
      runs: [],
    });
    expect(s.ledger).toEqual(linkedState().ledger);
    expect(s.operations).toEqual(linkedState().operations);
  });

  it("the same form submitted twice creates one schedule", () => {
    const once = scheduled();
    const twice = createPocketMoneyScheduleTransition(once, plan());
    expect(twice.result.ok).toBe(true);
    expect(twice.state.schedules).toHaveLength(1);
    expect(twice.state).toBe(once);
  });

  it("allows one open schedule per parent and teen", () => {
    const out = createPocketMoneyScheduleTransition(scheduled(), plan({ scheduleId: "pms_2", amount: 300 }));
    expect(out.result.ok).toBe(false);
    if (!out.result.ok) expect(out.result.error.code).toBe("duplicate");
    // A cancelled one doesn't block a new schedule.
    const cancelled = must(cancelPocketMoneyScheduleTransition(scheduled(), { ...PARENT, scheduleId: "pms_1" }));
    expect(createPocketMoneyScheduleTransition(cancelled, plan({ scheduleId: "pms_2" })).result.ok).toBe(true);
  });

  it("rejects invalid plans with a field", () => {
    for (const bad of [
      { amount: 0 },
      { amount: 20_000 },
      { startDate: "2026-09-01" },
      { endDate: "2026-09-20" },
      { frequency: "monthly" as const, dayOfMonth: 30 },
    ]) {
      const out = createPocketMoneyScheduleTransition(linkedState(), plan(bad));
      expect(out.result.ok).toBe(false);
      if (!out.result.ok) expect(out.result.error.field).toBeDefined();
      expect(out.state.schedules).toHaveLength(0);
    }
  });

  it("refuses when the parent's wallet is closed", () => {
    const s = linkedState();
    const closed = { ...s, wallets: s.wallets.map((w) => (w.id === PARENT_WALLET ? { ...w, status: "closed" as const } : w)) };
    expect(createPocketMoneyScheduleTransition(closed, plan()).result.ok).toBe(false);
  });
});

// ── Execution ────────────────────────────────────────────────────

describe("pocket money — execution", () => {
  it("nothing is due before the first transfer day", () => {
    const s = scheduled();
    const out = execute(s, "2026-09-27T12:00:00Z");
    expect(out.result.ok).toBe(true);
    if (out.result.ok) expect(out.result.value.outcomes).toEqual([]);
    expect(out.state).toBe(s);
  });

  it("pays one occurrence atomically: both legs, one ALW reference, schedule advanced", () => {
    const s0 = scheduled();
    const out = execute(s0, MON1);
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return;
    const [outcome] = out.result.value.outcomes;
    expect(outcome).toMatchObject({ scheduleId: "pms_1", occurrence: "2026-09-28", status: "completed", missed: 0 });
    expect(outcome!.reference).toMatch(/^ALW-[0-9A-Z]{8}$/);

    const s = out.state;
    expect(parentMoney(s)).toBe(PARENT_START - 500);
    expect(teenMoney(s)).toBe(TEEN_START + 500);
    expect(parentMoney(s) + teenMoney(s)).toBe(PARENT_START + TEEN_START);

    const op = s.operations.find((o) => o.id === "pms_1:2026-09-28")!;
    expect(op).toMatchObject({ type: "allowance", amount: 500, scheduleId: "pms_1", scheduledFor: "2026-09-28" });
    const legs = s.ledger.filter((e) => e.operationId === op.id);
    expect(legs).toHaveLength(2);
    const debit = legs.find((e) => e.direction === "debit")!;
    const credit = legs.find((e) => e.direction === "credit")!;
    expect(debit).toMatchObject({ walletId: PARENT_WALLET, amount: 500, status: "completed", reference: op.reference });
    expect(credit).toMatchObject({ walletId: TEEN_WALLET, amount: 500, status: "completed", reference: op.reference });
    expect(credit.createdAt).toBe(MON1);

    expect(schedule(s)).toMatchObject({
      status: "active",
      nextRunAt: dueInstant("2026-10-05"),
      lastRunAt: MON1,
      version: 2,
    });
    expect(schedule(s).runs).toEqual([
      expect.objectContaining({ id: "pms_1:2026-09-28", status: "completed", reference: op.reference, operationId: op.id }),
    ]);
  });

  it("the same occurrence never pays twice — repeat, retry and replay", () => {
    const once = execute(scheduled(), MON1).state;
    // Same asOf again: nothing is due any more.
    const again = execute(once, MON1);
    expect(again.state).toBe(once);
    // Later the same day: still nothing.
    expect(execute(once, "2026-09-28T17:00:00Z").state).toBe(once);
    expect(scheduledOps(once)).toHaveLength(1);
    expect(parentMoney(once)).toBe(PARENT_START - 500);

    // A stale client replays the old schedule (nextRunAt still on the
    // 28th) against the paid ledger: already processed, no new money.
    const stale = { ...once, schedules: [scheduled().schedules[0]!] };
    const replay = execute(stale, MON1);
    expect(replay.result.ok).toBe(true);
    if (replay.result.ok) expect(replay.result.value.outcomes[0]?.status).toBe("already_processed");
    expect(scheduledOps(replay.state)).toHaveLength(1);
    expect(parentMoney(replay.state)).toBe(PARENT_START - 500);
    expect(teenMoney(replay.state)).toBe(TEEN_START + 500);
  });

  it("two concurrent attempts from the same starting state settle to one payment", () => {
    const start = scheduled();
    const first = execute(start, MON1).state;
    // The second attempt is computed from the same snapshot, then
    // re-applied on top of the first result (what a commit does).
    const second = execute(first, MON1).state;
    expect(second).toBe(first);
    const raced = execute({ ...first, schedules: start.schedules }, MON1).state;
    expect(scheduledOps(raced)).toHaveLength(1);
    expect(teenMoney(raced)).toBe(TEEN_START + 500);
  });

  it("missed policy: only the latest due occurrence is paid; skipped ones are counted", () => {
    const s0 = scheduled();
    // Three Mondays (28 Sep, 5 Oct, 12 Oct) have passed by 13 Oct.
    const out = execute(s0, "2026-10-13T06:00:00Z");
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return;
    expect(out.result.value.outcomes).toEqual([
      expect.objectContaining({ occurrence: "2026-10-12", status: "completed", missed: 2 }),
    ]);
    expect(teenMoney(out.state)).toBe(TEEN_START + 500);
    expect(schedule(out.state).runs[0]).toMatchObject({ occurrence: "2026-10-12", missed: 2 });
    expect(schedule(out.state).nextRunAt).toBe(dueInstant("2026-10-19"));
  });

  it("successive occurrences each pay once and conserve money", () => {
    let s = scheduled();
    for (const day of [MON1, MON2, MON3]) s = execute(s, day).state;
    expect(scheduledOps(s)).toHaveLength(3);
    expect(parentMoney(s)).toBe(PARENT_START - 1500);
    expect(teenMoney(s)).toBe(TEEN_START + 1500);
    expect(parentMoney(s) + teenMoney(s)).toBe(PARENT_START + TEEN_START);
    expect(new Set(s.operations.map((o) => o.reference)).size).toBe(s.operations.length);
  });

  it("insufficient funds: no partial payment, no negative balance, marked failed, not retried", () => {
    const s0 = scheduled({ amount: 6000 });
    const out = execute(s0, MON1);
    expect(out.result.ok).toBe(true);
    if (!out.result.ok) return;
    expect(out.result.value.outcomes[0]).toMatchObject({ status: "failed", message: INSUFFICIENT_FUNDS_MESSAGE });
    expect(INSUFFICIENT_FUNDS_MESSAGE).toBe(
      "Pocket money couldn't be sent because the parent's available balance was too low.",
    );
    const s = out.state;
    expect(parentMoney(s)).toBe(PARENT_START);
    expect(teenMoney(s)).toBe(TEEN_START);
    expect(scheduledOps(s)).toHaveLength(0);
    expect(s.ledger).toEqual(s0.ledger);
    // The schedule stays intact and moves to the next occurrence.
    expect(schedule(s)).toMatchObject({ status: "active", amount: 6000, nextRunAt: dueInstant("2026-10-05") });
    expect(schedule(s).runs[0]).toMatchObject({ status: "failed", reason: "insufficient_funds" });
    expect(schedule(s).runs[0]?.reference).toBeUndefined();
    // Retrying the failed occurrence does nothing.
    expect(execute(s, MON1).state).toBe(s);
    const replay = execute({ ...s, schedules: s0.schedules }, MON1);
    // A stale client can't re-run it either: the run list is the record.
    expect(scheduledOps(replay.state)).toHaveLength(0);
  });

  it("a failure is never shown as received and notifies both sides appropriately", () => {
    const s = execute(scheduled({ amount: 6000 }), MON1).state;
    expect(selectTransactions(s).some((t) => t.title === "Pocket money received")).toBe(false);
    const parent = s.notifications.find((n) => n.recipientId === SEED_PARENT_ID && n.title === "Pocket money not sent");
    expect(parent?.body).toContain(INSUFFICIENT_FUNDS_MESSAGE);
    const teen = s.notifications.find((n) => n.recipientId === SEED_TEEN_ID && n.title === "Pocket money didn't arrive");
    expect(teen).toBeDefined();
    expect(teen?.body).not.toMatch(/balance was too low/);
  });

  it("frozen source fails safely: nothing moves", () => {
    const s = execute(frozen(scheduled(), PARENT_WALLET), MON1).state;
    expect(schedule(s).runs[0]).toMatchObject({ status: "failed", reason: "source_frozen" });
    expect(parentMoney(s)).toBe(PARENT_START);
    expect(teenMoney(s)).toBe(TEEN_START);
    expect(scheduledOps(s)).toHaveLength(0);
  });

  it("frozen destination fails the occurrence without a single leg", () => {
    const base = scheduled();
    const iced = must(setWalletStatusTransition(base, { ...TEEN, walletId: TEEN_WALLET, status: "frozen" }));
    const s = execute(iced, MON1).state;
    expect(schedule(s).runs[0]).toMatchObject({ status: "failed", reason: "destination_frozen" });
    expect(s.ledger.filter((e) => e.scheduleId)).toHaveLength(0);
    expect(parentMoney(s)).toBe(PARENT_START);
    // After unfreezing, the next occurrence pays normally.
    const thawed = must(setWalletStatusTransition(s, { ...TEEN, at: MON1, walletId: TEEN_WALLET, status: "active" }));
    const paid = execute(thawed, MON2).state;
    expect(schedule(paid).runs.map((r) => r.status)).toEqual(["failed", "completed"]);
    expect(teenMoney(paid)).toBe(TEEN_START + 500);
  });

  it("end date: the final eligible occurrence pays, then the schedule completes and stays", () => {
    const s0 = scheduled({ endDate: "2026-10-05" });
    let s = execute(s0, MON1).state;
    expect(schedule(s).status).toBe("active");
    s = execute(s, MON2).state;
    expect(schedule(s)).toMatchObject({ status: "completed", endedReason: "end_date_reached", nextRunAt: null });
    expect(schedule(s).runs).toHaveLength(2);
    expect(teenMoney(s)).toBe(TEEN_START + 1000);
    expect(s.notifications.some((n) => n.title === "Schedule completed")).toBe(true);
    // Never runs again and is never deleted.
    expect(execute(s, MON3).state).toBe(s);
    expect(s.schedules).toHaveLength(1);
    const explicit = execute(s, MON3, { scheduleId: "pms_1" });
    expect(explicit.result.ok).toBe(false);
  });

  it("a long gap past the end date pays only the last eligible occurrence", () => {
    const s = execute(scheduled({ endDate: "2026-10-05" }), "2026-11-30T06:00:00Z").state;
    expect(schedule(s).runs).toEqual([expect.objectContaining({ occurrence: "2026-10-05", missed: 1 })]);
    expect(schedule(s).status).toBe("completed");
    expect(teenMoney(s)).toBe(TEEN_START + 500);
  });
});

// ── Lifecycle ────────────────────────────────────────────────────

describe("pocket money — pause, resume, cancel, edit", () => {
  it("pause blocks execution but keeps the schedule visible", () => {
    const paused = must(pausePocketMoneyScheduleTransition(scheduled(), { ...PARENT, scheduleId: "pms_1" }));
    expect(schedule(paused)).toMatchObject({ status: "paused", nextRunAt: null });
    expect(execute(paused, MON1).state).toBe(paused);
    expect(execute(paused, MON1, { scheduleId: "pms_1" }).result.ok).toBe(false);
    expect(selectSchedulesForParent(paused, SEED_PARENT_ID)).toHaveLength(1);
    expect(selectSchedulesForTeen(paused, SEED_TEEN_ID)).toHaveLength(1);
    // Pausing twice is a no-op.
    expect(pausePocketMoneyScheduleTransition(paused, { ...PARENT, scheduleId: "pms_1" }).state).toBe(paused);
  });

  it("resume picks the next valid occurrence — skipped days don't back-pay", () => {
    const s1 = execute(scheduled(), MON1).state;
    const paused = must(pausePocketMoneyScheduleTransition(s1, { ...PARENT, at: MON1, scheduleId: "pms_1" }));
    // Resumed on Wed 7 Oct: 5 Oct was during the pause, so next is 12 Oct.
    const resumed = resumePocketMoneyScheduleTransition(paused, { ...PARENT, at: "2026-10-07T06:00:00Z", scheduleId: "pms_1" });
    expect(resumed.result.ok).toBe(true);
    if (resumed.result.ok) expect(resumed.result.value.nextOccurrence).toBe("2026-10-12");
    const s = execute(resumed.state, "2026-10-12T06:00:00Z").state;
    expect(schedule(s).runs.map((r) => r.occurrence)).toEqual(["2026-09-28", "2026-10-12"]);
    expect(teenMoney(s)).toBe(TEEN_START + 1000);
  });

  it("cancel stops future runs and keeps history", () => {
    const s1 = execute(scheduled(), MON1).state;
    const cancelled = must(cancelPocketMoneyScheduleTransition(s1, { ...PARENT, at: MON1, scheduleId: "pms_1" }));
    expect(schedule(cancelled)).toMatchObject({ status: "cancelled", endedReason: "cancelled", nextRunAt: null });
    expect(schedule(cancelled).runs).toHaveLength(1);
    expect(execute(cancelled, MON3).state).toBe(cancelled);
    expect(resumePocketMoneyScheduleTransition(cancelled, { ...PARENT, scheduleId: "pms_1" }).result.ok).toBe(false);
    expect(
      updatePocketMoneyScheduleTransition(cancelled, { ...PARENT, scheduleId: "pms_1", expectedVersion: schedule(cancelled).version, amount: 100 })
        .result.ok,
    ).toBe(false);
    // History stays readable.
    expect(selectScheduleSummary(cancelled, "pms_1")).toMatchObject({ successes: 1, failures: 0, totalPaid: 500, statusLabel: "Cancelled" });
    expect(selectScheduleHistory(cancelled, "pms_1")).toHaveLength(1);
  });

  it("edits apply to future runs only and a stale edit is refused", () => {
    const s1 = execute(scheduled(), MON1).state;
    const v = schedule(s1).version;
    const edited = updatePocketMoneyScheduleTransition(s1, { ...PARENT, at: MON1, scheduleId: "pms_1", expectedVersion: v, amount: 700 });
    expect(edited.result.ok).toBe(true);
    const s2 = execute(edited.state, MON2).state;
    expect(schedule(s2).runs.map((r) => r.amount)).toEqual([500, 700]);
    expect(teenMoney(s2)).toBe(TEEN_START + 1200);
    // A screen still holding version v tries to edit again.
    const stale = updatePocketMoneyScheduleTransition(s2, { ...PARENT, at: MON2, scheduleId: "pms_1", expectedVersion: v, amount: 900 });
    expect(stale.result.ok).toBe(false);
    if (!stale.result.ok) expect(stale.result.error.code).toBe("stale_schedule");
    expect(schedule(stale.state).amount).toBe(700);
    // A stale pause with an old version is refused too.
    const stalePause = pausePocketMoneyScheduleTransition(s2, { ...PARENT, scheduleId: "pms_1", expectedVersion: v });
    expect(stalePause.result.ok).toBe(false);
    // Starting date can't move once a run exists.
    const moved = updatePocketMoneyScheduleTransition(s2, {
      ...PARENT,
      at: MON2,
      scheduleId: "pms_1",
      expectedVersion: schedule(s2).version,
      startDate: "2026-10-20",
    });
    expect(moved.result.ok).toBe(false);
  });

  it("disconnecting the family ends the schedule; history stays", () => {
    const s1 = execute(scheduled(), MON1).state;
    const off = must(disconnectTransition(s1, { ...PARENT, at: MON1, teenId: SEED_TEEN_ID }));
    expect(schedule(off)).toMatchObject({ status: "cancelled", endedReason: "family_disconnected", nextRunAt: null });
    expect(schedule(off).runs).toHaveLength(1);
    expect(execute(off, MON2).result.ok).toBe(false);
    expect(teenMoney(off)).toBe(TEEN_START + 500);
  });
});

// ── Interactions ─────────────────────────────────────────────────

describe("pocket money — interactions with balances and rules", () => {
  it("lands in the available balance, never auto-allocated to a Space", () => {
    const before = scheduled();
    const s = execute(before, MON1).state;
    expect(selectAvailableBalance(s)).toBe(selectAvailableBalance(before) + 500);
    const credit = s.ledger.find((e) => e.scheduleId && e.direction === "credit")!;
    expect(credit.spaceId).toBeUndefined();
    // The teen can then move part of it into Save, separately.
    const saved = must(
      moveSpaceMoneyTransition(s, { ...TEEN, at: MON1, operationId: "save_pm", spaceId: SEED_SAVE_SPACE_ID, amount: 200, direction: "add" }),
    );
    expect(selectAvailableBalance(saved)).toBe(selectAvailableBalance(s) - 200);
    // Moving to a Space doesn't change the wallet's total.
    expect(selectTotal(saved)).toBe(selectTotal(s));
    expect(selectTotal(s)).toBe(selectTotal(before) + 500);
  });

  it("is income: it doesn't count toward the daily spending limit", () => {
    const base = scheduled({}, withRules({ daily: 500 }));
    const s = execute(base, MON1).state;
    expect(spentOnDay(s.ledger, MON1, TEEN_WALLET)).toBe(0);
    const paid = payTransition(s, { ...TEEN, at: MON1, entryId: "pay_after_pm", recipientId: "rec_riya", amount: 500 });
    expect(paid.result.ok).toBe(true);
  });

  it("appears in Activity from the same transactions, with schedule context", () => {
    const s = execute(scheduled(), MON1).state;
    const rows = selectTransactions(s).filter((t) => t.title === "Pocket money received");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ amount: 500, direction: "in", subtitle: "Scheduled · From Priya" });
    const credit = s.ledger.find((e) => e.scheduleId && e.direction === "credit")!;
    expect(rows[0]!.id).toBe(credit.id);
    const detail = getTransaction(s, credit.id);
    expect(detail).toMatchObject({ scheduledFor: "2026-09-28", status: "completed", statusText: "Completed" });
    expect(detail?.reference).toMatch(/^ALW-/);
    // Manual pocket money keeps its own title.
    expect(selectTransactions(s).filter((t) => t.title === "Pocket money")).toHaveLength(
      selectTransactions(scheduled()).filter((t) => t.title === "Pocket money").length,
    );
  });

  it("notifies once per outcome: sent to the parent, received to the teen", () => {
    const base = scheduled();
    const s = execute(base, MON1).state;
    const fresh = s.notifications.filter((n) => !base.notifications.some((b) => b.id === n.id));
    const sent = fresh.filter((n) => n.title === "Pocket money sent");
    const received = fresh.filter((n) => n.title === "Pocket money received");
    expect(fresh).toHaveLength(2);
    expect(sent.map((n) => n.recipientId)).toEqual([SEED_PARENT_ID]);
    expect(received.map((n) => n.recipientId)).toEqual([SEED_TEEN_ID]);
    // Replaying adds nothing.
    const again = execute({ ...s, schedules: scheduled().schedules }, MON1).state;
    expect(again.notifications.filter((n) => n.title === "Pocket money sent")).toHaveLength(1);
  });
});

// ── Selectors ────────────────────────────────────────────────────

describe("pocket money — selectors", () => {
  it("summaries, upcoming, history and totals derive from schedules and the ledger", () => {
    let s = scheduled();
    expect(selectNextPocketMoney(s, SEED_TEEN_ID)).toMatchObject({ occurrence: "2026-09-28" });
    expect(selectUpcomingPocketMoney(s, { parentId: SEED_PARENT_ID })).toHaveLength(1);
    s = execute(s, MON1).state;
    s = updatePocketMoneyScheduleTransition(s, {
      ...PARENT,
      at: MON1,
      scheduleId: "pms_1",
      expectedVersion: schedule(s).version,
      amount: 6000,
    }).state;
    s = execute(s, MON2).state;
    expect(selectScheduleSummary(s, "pms_1")).toMatchObject({
      cadence: "Every Monday",
      statusLabel: "Active",
      nextOccurrence: "2026-10-12",
      totalPaid: 500,
      failures: 1,
      parentName: "Priya",
    });
    expect(selectScheduleSummary(s, "pms_1")).toMatchObject({ totalRuns: 2, successes: 1 });
    expect(selectScheduleSummary(s, "pms_1")?.lastRun).toMatchObject({ occurrence: "2026-10-05", status: "failed" });
    expect(selectScheduleHistory(s, "pms_1").map((r) => r.occurrence)).toEqual(["2026-10-05", "2026-09-28"]);
    expect(selectPocketMoneyExecutions(s, SEED_TEEN_ID).map((r) => r.status)).toEqual(["failed", "completed"]);
    expect(selectPocketMoneyTotals(s, SEED_TEEN_ID)).toEqual({ received: 500, sent: 0 });
    expect(selectPocketMoneyTotals(s, SEED_PARENT_ID)).toEqual({ received: 0, sent: 500 });
    const paused = must(pausePocketMoneyScheduleTransition(s, { ...PARENT, at: MON2, scheduleId: "pms_1" }));
    expect(selectNextPocketMoney(paused, SEED_TEEN_ID)).toBeNull();
    expect(selectUpcomingPocketMoney(paused, { teenId: SEED_TEEN_ID })).toHaveLength(0);
  });
});
