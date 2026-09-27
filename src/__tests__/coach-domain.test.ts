import { describe, expect, it } from "vitest";
import {
  COACH_CATEGORIES,
  COACH_LESSONS,
  COACH_PERIODS,
  MAX_COACH_INSIGHTS,
  coachINR,
  coachWindows,
  compareSpending,
  deriveCoachReport,
  deriveInsights,
  formatDayRange,
  isCoachPeriod,
  isInRange,
  lessonAnchor,
  savingRateOf,
  type CoachFacts,
  type CoachGoal,
  type CoachPeriodTotals,
} from "@/domain";

/**
 * Money Coach domain (Phase 10): periods, definitions and the
 * deterministic insight rules — pure functions, explicit `now`.
 */

const NOW = "2026-09-27T10:00:00Z"; // Sunday, Sep 27 2026 (IST)

function totals(over: Partial<CoachPeriodTotals> = {}): CoachPeriodTotals {
  const received = { pocketMoney: 0, fromPeople: 0, sandbox: 0, total: 0, ...(over.received ?? {}) };
  received.total = received.pocketMoney + received.fromPeople + received.sandbox;
  return {
    spent: 0,
    spendingCount: 0,
    payments: 0,
    transfers: 0,
    refunded: 0,
    pocketMoneyCount: 0,
    movedToSpaces: 0,
    movedFromSpaces: 0,
    ...over,
    received,
  };
}

function facts(over: Partial<CoachFacts> = {}): CoachFacts {
  const period = over.period ?? "month";
  return {
    period,
    windows: coachWindows(period, NOW),
    hasHistory: true,
    canCompare: true,
    available: 1000,
    setAside: 500,
    total: 1500,
    current: totals(),
    previous: totals(),
    goals: [],
    pendingApprovals: { count: 0, amount: 0 },
    nextPocketMoney: null,
    ...over,
  };
}

const goal = (over: Partial<CoachGoal> = {}): CoachGoal => ({
  name: "New Bike",
  type: "goal",
  href: "/money/goal_bike",
  balance: 1500,
  target: 2500,
  percent: 60,
  remaining: 1000,
  reached: false,
  ...over,
});

describe("Coach periods (IST, explicit now)", () => {
  it("has exactly three periods", () => {
    expect(COACH_PERIODS).toEqual(["week", "month", "30d"]);
    expect(isCoachPeriod("week")).toBe(true);
    expect(isCoachPeriod("year")).toBe(false);
    expect(isCoachPeriod(undefined)).toBe(false);
  });

  it("week runs Monday to today, compared with the same weekdays last week", () => {
    const w = coachWindows("week", NOW);
    expect(w.today).toBe("2026-09-27");
    expect(w.current).toMatchObject({ startDay: "2026-09-21", endDay: "2026-09-27", days: 7 });
    expect(w.previous).toMatchObject({ startDay: "2026-09-14", endDay: "2026-09-20", days: 7 });
    // On a Monday, the week is just today.
    const mon = coachWindows("week", "2026-09-28T04:00:00Z");
    expect(mon.current).toMatchObject({ startDay: "2026-09-28", endDay: "2026-09-28", days: 1 });
    expect(mon.previous).toMatchObject({ startDay: "2026-09-21", endDay: "2026-09-21", days: 1 });
  });

  it("month runs from the 1st, compared with the same days last month (capped at month end)", () => {
    const m = coachWindows("month", NOW);
    expect(m.current).toMatchObject({ startDay: "2026-09-01", endDay: "2026-09-27", days: 27 });
    expect(m.previous).toMatchObject({ startDay: "2026-08-01", endDay: "2026-08-27", days: 27 });
    // Mar 31 → Feb has 28 days in 2026.
    const mar = coachWindows("month", "2026-03-31T06:00:00Z");
    expect(mar.previous).toMatchObject({ startDay: "2026-02-01", endDay: "2026-02-28" });
    // January compares with December of the previous year.
    const jan = coachWindows("month", "2026-01-10T06:00:00Z");
    expect(jan.previous).toMatchObject({ startDay: "2025-12-01", endDay: "2025-12-10" });
  });

  it("30 days is today and the 29 days before, compared with the 30 days before that", () => {
    const d = coachWindows("30d", NOW);
    expect(d.current).toMatchObject({ startDay: "2026-08-29", endDay: "2026-09-27", days: 30 });
    expect(d.previous).toMatchObject({ startDay: "2026-07-30", endDay: "2026-08-28", days: 30 });
  });

  it("uses India time, not UTC or the device timezone", () => {
    // 20:00 UTC on Sep 30 is already Oct 1 in India.
    const late = coachWindows("month", "2026-09-30T20:00:00Z");
    expect(late.today).toBe("2026-10-01");
    expect(late.current.startDay).toBe("2026-10-01");
    const range = coachWindows("month", NOW).current;
    expect(isInRange("2026-08-31T18:29:00Z", range)).toBe(false); // Aug 31, 23:59 IST
    expect(isInRange("2026-08-31T18:30:00Z", range)).toBe(true); // Sep 1, 00:00 IST
    expect(isInRange("2026-09-27T18:29:00Z", range)).toBe(true); // Sep 27, 23:59 IST
    expect(isInRange("2026-09-27T18:30:00Z", range)).toBe(false); // Sep 28 IST
    expect(isInRange("not a date", range)).toBe(false);
  });

  it("formats ranges readably", () => {
    expect(formatDayRange(coachWindows("month", NOW).current)).toBe("Sep 1–27");
    expect(formatDayRange(coachWindows("30d", NOW).current)).toBe("Aug 29 – Sep 27");
    expect(coachINR(1850)).toBe("₹1,850");
    expect(coachINR(125000)).toBe("₹1,25,000");
  });
});

describe("Coach definitions", () => {
  it("savings rate = net moved into Spaces ÷ received; zero received is not enough data", () => {
    expect(savingRateOf(2300, 4500)).toEqual({ kind: "rate", percent: 51 });
    expect(savingRateOf(0, 500)).toEqual({ kind: "rate", percent: 0 });
    expect(savingRateOf(100, 0)).toEqual({ kind: "not_enough_data" });
    expect(savingRateOf(0, 0)).toEqual({ kind: "not_enough_data" });
    expect(savingRateOf(-200, 500)).toEqual({ kind: "moved_out", amount: 200 });
    expect(savingRateOf(900, 500)).toEqual({ kind: "above_received" });
    expect(savingRateOf(Number.NaN, 500)).toEqual({ kind: "not_enough_data" });
  });

  it("spending comparison: ±10% is similar, no previous data is not enough data", () => {
    expect(compareSpending(350, null)).toEqual({ kind: "not_enough_data" });
    expect(compareSpending(110, 100)).toMatchObject({ kind: "compared", change: "similar" });
    expect(compareSpending(150, 100)).toMatchObject({ kind: "compared", change: "up", percent: 50 });
    expect(compareSpending(50, 100)).toMatchObject({ kind: "compared", change: "down", percent: 50 });
    expect(compareSpending(350, 0)).toMatchObject({ kind: "compared", change: "up", percent: null });
    expect(compareSpending(0, 0)).toMatchObject({ kind: "compared", change: "similar" });
  });
});

describe("Coach insight engine", () => {
  it("no history → no insights and the welcome state", () => {
    const f = facts({ hasHistory: false, available: 0, setAside: 0, total: 0, canCompare: false, previous: null });
    expect(deriveInsights(f)).toEqual([]);
    const report = deriveCoachReport(f);
    expect(report.empty).toBe(true);
    expect(report.lowData).toBe(false);
    expect(report.headline).toBe("Your Money Coach is getting to know your money.");
  });

  it("orders by priority: balance, goals, spending, pocket money, education", () => {
    const f = facts({
      goals: [goal()],
      current: totals({ spent: 300, spendingCount: 2, payments: 300, received: { pocketMoney: 500, fromPeople: 0, sandbox: 0, total: 0 }, pocketMoneyCount: 1 }),
      previous: totals({ spent: 100, spendingCount: 1, payments: 100 }),
    });
    const kinds = deriveInsights(f).map((i) => i.kind);
    expect(kinds[0]).toBe("balance_split");
    expect(kinds.indexOf("goal_progress")).toBeLessThan(kinds.indexOf("spending_change"));
    expect(kinds.indexOf("spending_change")).toBeLessThan(kinds.indexOf("pocket_money_received"));
    expect(kinds[kinds.length - 1]).toBe("lesson");
  });

  it("puts a pending approval first, as information only (links to Activity)", () => {
    const ins = deriveInsights(facts({ pendingApprovals: { count: 1, amount: 600 } }));
    expect(ins[0]!.kind).toBe("pending_approval");
    expect(ins[0]!.title).toContain("₹600");
    expect(ins[0]!.explanation).toMatch(/isn't counted as spending/i);
    // Information only: the one action is a Learn link, never approve/cancel.
    expect(ins[0]!.action).toEqual({ kind: "learn", label: "Learn about pending payments", href: "#learn-pending-payments" });
  });

  it("describes spending changes factually, with the period and the comparison", () => {
    const up = deriveInsights(
      facts({ current: totals({ spent: 300, spendingCount: 2 }), previous: totals({ spent: 200, spendingCount: 1 }) }),
    ).find((i) => i.kind === "spending_change")!;
    expect(up.title).toBe("You spent 50% more this month than in the same days last month.");
    expect(up.explanation).toContain("Sep 1–27");
    expect(up.explanation).toContain("Aug 1–27");
    expect(up.comparison).toEqual({ amount: 200, label: "the same days last month" });
    const down = deriveInsights(
      facts({ current: totals({ spent: 100, spendingCount: 1 }), previous: totals({ spent: 200, spendingCount: 1 }) }),
    ).find((i) => i.kind === "spending_change")!;
    expect(down.title).toMatch(/less/);
  });

  it("says 'not enough data' instead of comparing a brand-new wallet", () => {
    const f = facts({ canCompare: false, previous: null, current: totals({ spent: 350, spendingCount: 1 }) });
    const ins = deriveInsights(f);
    expect(ins.some((i) => i.kind === "spending_change")).toBe(false);
    expect(ins.find((i) => i.kind === "spending_total")!.explanation).toMatch(/Not enough data yet to compare/);
    expect(deriveCoachReport(f).lowData).toBe(true);
  });

  it("goals: reached first, at most two goal insights; the report lists them all", () => {
    const goals = [
      goal({ name: "A", href: "/money/a", percent: 20 }),
      goal({ name: "B", href: "/money/b", percent: 100, reached: true, balance: 2500, remaining: 0 }),
      goal({ name: "C", href: "/money/c", percent: 90 }),
    ];
    const f = facts({ goals });
    const g = deriveInsights(f).filter((i) => i.category === "goals");
    expect(g).toHaveLength(2);
    expect(g[0]!.kind).toBe("goal_reached");
    expect(g[0]!.tone).toBe("positive");
    expect(deriveCoachReport(f).goals).toHaveLength(3);
  });

  it("Save Spaces aren't called goals", () => {
    const ins = deriveInsights(facts({ goals: [goal({ name: "Save", type: "save", percent: 40, target: 2000 })] }));
    expect(ins.find((i) => i.category === "goals")!.title).toBe("Save is 40% of the way to its ₹2,000 target.");
  });

  it("a passed target date is stated without pressure", () => {
    const ins = deriveInsights(facts({ goals: [goal({ deadline: "2026-09-01", deadlineState: "passed", daysLeft: 0 })] }));
    const text = ins.find((i) => i.category === "goals")!.explanation;
    expect(text).toMatch(/has passed/);
    expect(text).toMatch(/own pace/);
  });

  it("savings rate with nothing received reads 'Not enough data yet'", () => {
    const ins = deriveInsights(facts({ current: totals({ movedToSpaces: 200 }) }));
    const setAside = ins.find((i) => i.kind === "set_aside")!;
    expect(setAside.explanation).toMatch(/Not enough data yet/);
    expect(setAside.value?.percent).toBeUndefined();
  });

  it("is capped, has strict categories, stable ids and no score", () => {
    const f = facts({
      goals: [goal(), goal({ name: "X", href: "/money/x" })],
      pendingApprovals: { count: 2, amount: 900 },
      nextPocketMoney: { amount: 500, day: "2026-10-01", cadence: "Every week" },
      current: totals({
        spent: 900, spendingCount: 4, payments: 600, transfers: 300, movedToSpaces: 300,
        received: { pocketMoney: 500, fromPeople: 200, sandbox: 0, total: 0 }, pocketMoneyCount: 1,
      }),
      previous: totals({ spent: 100, spendingCount: 1 }),
    });
    const a = deriveInsights(f);
    const b = deriveInsights(structuredClone(f));
    expect(a).toEqual(b);
    expect(a.length).toBeLessThanOrEqual(MAX_COACH_INSIGHTS);
    for (const i of a) expect(COACH_CATEGORIES).toContain(i.category);
    expect(new Set(a.map((i) => i.id)).size).toBe(a.length);
    const json = JSON.stringify(a).toLowerCase();
    expect(json).not.toMatch(/score|health|grade|rank/);
  });

  it("actions are navigation only, to safe in-app places", () => {
    const f = facts({
      goals: [goal()],
      pendingApprovals: { count: 1, amount: 600 },
      nextPocketMoney: { amount: 500, day: "2026-10-01", cadence: "Every week" },
      current: totals({ spent: 300, spendingCount: 2, movedToSpaces: 100, received: { pocketMoney: 500, fromPeople: 100, sandbox: 0, total: 0 }, pocketMoneyCount: 1 }),
    });
    for (const period of COACH_PERIODS) {
      for (const i of deriveInsights({ ...f, period, windows: coachWindows(period, NOW) })) {
        if (!i.action) continue;
        expect(i.action.href).toMatch(/^(\/money(\/[\w-]+)?|\/activity|\/family|#learn-[a-z-]+)$/);
        expect(Object.keys(i.action).sort()).toEqual(["href", "kind", "label"]);
      }
    }
  });
});

const BANNED =
  /\b(invest\w*|stock|shares?|crypto\w*|bitcoin|loan|borrow\w*|debt|credit card|gambl\w*|bet(ting)?|lottery|should|must|bad|good job|well done|lazy|irresponsible|waste\w*|careless|worr\w*|danger\w*|urgent|hurry|score|health|rank\w*|streak|level up|badge)\b/i;

describe("Coach copy guard", () => {
  it("lessons are short, factual and avoid banned topics and judgmental words", () => {
    expect(COACH_LESSONS.length).toBeGreaterThanOrEqual(5);
    for (const lesson of COACH_LESSONS) {
      expect(`${lesson.title} ${lesson.body}`).not.toMatch(BANNED);
      expect(lesson.body.length).toBeLessThan(320);
      expect(lessonAnchor(lesson.id)).toMatch(/^learn-[a-z-]+$/);
    }
  });

  it("no generated insight uses banned words or emoji, across many situations", () => {
    const variants: Partial<CoachFacts>[] = [
      {},
      { goals: [goal(), goal({ name: "Done", href: "/money/d", reached: true, percent: 100 })] },
      { goals: [goal({ deadline: "2026-09-01", deadlineState: "passed", daysLeft: 0 })] },
      { pendingApprovals: { count: 3, amount: 1500 } },
      { nextPocketMoney: { amount: 500, day: "2026-10-01", cadence: "Every week" } },
      { current: totals({ spent: 900, spendingCount: 3, payments: 900 }), previous: totals({ spent: 100, spendingCount: 1 }) },
      { current: totals({ spent: 100, spendingCount: 1, transfers: 100 }), previous: totals({ spent: 900, spendingCount: 5 }) },
      { current: totals({ movedFromSpaces: 300, received: { pocketMoney: 200, fromPeople: 0, sandbox: 0, total: 0 } }) },
      { current: totals({ received: { pocketMoney: 0, fromPeople: 400, sandbox: 0, total: 0 } }) },
      { canCompare: false, previous: null, current: totals({ spent: 50, spendingCount: 1 }) },
      { available: 0, setAside: 0, total: 0 },
    ];
    for (const period of COACH_PERIODS) {
      for (const v of variants) {
        const report = deriveCoachReport(facts({ ...v, period, windows: coachWindows(period, NOW) }));
        for (const i of report.insights) {
          const text = `${i.title} ${i.explanation} ${i.action?.label ?? ""}`;
          expect(text, text).not.toMatch(BANNED);
          expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
          expect(text).not.toMatch(/usr_|wal_|fam_|undefined|NaN|null/);
        }
        expect(report.headline).not.toMatch(BANNED);
      }
    }
  });
});
