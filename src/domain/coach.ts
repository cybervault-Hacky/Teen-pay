/**
 * Domain: Money Coach (Phase 10).
 *
 * A read-only guidance layer. The Coach turns facts the sandbox has
 * already derived from the ledger (through the existing selectors)
 * into plain-language, deterministic insights. It never moves money,
 * never writes state, never scores the teen and never gives financial
 * product advice.
 *
 * Everything here is pure: the same facts and the same day always
 * produce the same summary, insights and wording. No randomness, no
 * network, no AI, no wall clock (callers pass "now").
 *
 * Dates are calendar days in the product timezone (Asia/Kolkata,
 * `productDay`), so a period never shifts with the device timezone.
 */
import { addDays } from "./allowance";
import { productDay } from "./space";

// ── Periods ──────────────────────────────────────────────────────

export const COACH_PERIODS = ["week", "month", "30d"] as const;
export type CoachPeriod = (typeof COACH_PERIODS)[number];

export function isCoachPeriod(value: unknown): value is CoachPeriod {
  return typeof value === "string" && (COACH_PERIODS as readonly string[]).includes(value);
}

/** Selector labels. */
export const COACH_PERIOD_SHORT_LABEL: Record<CoachPeriod, string> = {
  week: "Week",
  month: "Month",
  "30d": "30 days",
};

/** Heading-style labels. */
export const COACH_PERIOD_LABEL: Record<CoachPeriod, string> = {
  week: "This week",
  month: "This month",
  "30d": "Last 30 days",
};

/** How the period reads inside a sentence ("You spent ₹350 this week."). */
const IN_PERIOD: Record<CoachPeriod, string> = {
  week: "this week",
  month: "this month",
  "30d": "in the last 30 days",
};

/** How the comparison window reads inside a sentence. */
const IN_PREVIOUS: Record<CoachPeriod, string> = {
  week: "the same days last week",
  month: "the same days last month",
  "30d": "the 30 days before",
};

/** An inclusive range of calendar days (YYYY-MM-DD). */
export interface CoachDayRange {
  startDay: string;
  endDay: string;
  days: number;
}

export interface CoachWindows {
  period: CoachPeriod;
  /** Today in the product timezone. */
  today: string;
  current: CoachDayRange;
  /**
   * The window the current one is compared with — like for like, so a
   * part-finished month is never compared with a whole one:
   *  · week  — Monday..today vs the same weekdays last week;
   *  · month — the 1st..today vs the same days of last month (capped at
   *            its last day);
   *  · 30d   — the last 30 days vs the 30 days before.
   */
  previous: CoachDayRange;
}

function dayNumber(day: string): number {
  return Date.parse(`${day}T00:00:00Z`) / 86_400_000;
}

function range(startDay: string, endDay: string): CoachDayRange {
  return { startDay, endDay, days: dayNumber(endDay) - dayNumber(startDay) + 1 };
}

/** 0 = Monday … 6 = Sunday. */
function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The current and comparison windows for a period, as of `now`. */
export function coachWindows(period: CoachPeriod, now: string): CoachWindows {
  const today = productDay(now);
  if (period === "week") {
    const start = addDays(today, -weekdayIndex(today));
    return {
      period,
      today,
      current: range(start, today),
      previous: range(addDays(start, -7), addDays(today, -7)),
    };
  }
  if (period === "month") {
    const [y, m, d] = today.split("-").map(Number) as [number, number, number];
    const prevYear = m === 1 ? y - 1 : y;
    const prevMonth = m === 1 ? 12 : m - 1;
    const prevEnd = Math.min(d, daysInMonth(prevYear, prevMonth));
    return {
      period,
      today,
      current: range(`${y}-${pad(m)}-01`, today),
      previous: range(`${prevYear}-${pad(prevMonth)}-01`, `${prevYear}-${pad(prevMonth)}-${pad(prevEnd)}`),
    };
  }
  return {
    period,
    today,
    current: range(addDays(today, -29), today),
    previous: range(addDays(today, -59), addDays(today, -30)),
  };
}

/** Is an instant inside a day range (product timezone)? */
export function isInRange(iso: string, dayRange: CoachDayRange): boolean {
  // An unreadable timestamp is never "in" a period (and never throws).
  if (!Number.isFinite(Date.parse(iso))) return false;
  const day = productDay(iso);
  return day >= dayRange.startDay && day <= dayRange.endDay;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function parts(day: string) {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return { y, month: MONTHS[m - 1]!, d };
}

/** "Sep 1–27", "Aug 29 – Sep 27", "Dec 29, 2025 – Jan 4, 2026", "Sep 27". */
export function formatDayRange(dayRange: CoachDayRange): string {
  const a = parts(dayRange.startDay);
  const b = parts(dayRange.endDay);
  if (dayRange.startDay === dayRange.endDay) return `${a.month} ${a.d}`;
  if (a.y !== b.y) return `${a.month} ${a.d}, ${a.y} – ${b.month} ${b.d}, ${b.y}`;
  if (a.month === b.month) return `${a.month} ${a.d}–${b.d}`;
  return `${a.month} ${a.d} – ${b.month} ${b.d}`;
}

/** "Mon, Sep 28". */
export function formatCoachDay(day: string): string {
  const p = parts(day);
  return `${WEEKDAYS[weekdayIndex(day)]}, ${p.month} ${p.d}`;
}

/** "Nov 30, 2026". */
export function formatCoachDate(day: string): string {
  const p = parts(day);
  return `${p.month} ${p.d}, ${p.y}`;
}

/** "₹1,850" — whole rupees, en-IN grouping, no decimals. */
export function coachINR(amount: number): string {
  const digits = Math.abs(Math.round(amount)).toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return `${amount < 0 ? "−" : ""}₹${digits}`;
}

// ── Enums ────────────────────────────────────────────────────────

export const COACH_CATEGORIES = [
  "balance",
  "spending",
  "saving",
  "goals",
  "pocket_money",
  "habit",
  "education",
] as const;
export type CoachCategory = (typeof COACH_CATEGORIES)[number];

export const COACH_CATEGORY_LABEL: Record<CoachCategory, string> = {
  balance: "Balance",
  spending: "Spending",
  saving: "Saving",
  goals: "Goals",
  pocket_money: "Pocket money",
  habit: "Habits",
  education: "Learn",
};

/**
 * How an insight is presented. There is no "bad" tone: the Coach states
 * facts. "positive" marks a milestone (a goal reached); everything else
 * is neutral.
 */
export const COACH_TONES = ["neutral", "positive"] as const;
export type CoachTone = (typeof COACH_TONES)[number];

export const COACH_INSIGHT_KINDS = [
  "pending_approval",
  "balance_split",
  "goal_reached",
  "goal_progress",
  "spending_change",
  "spending_total",
  "no_spending",
  "spending_split",
  "set_aside",
  "moved_from_spaces",
  "pocket_money_received",
  "pocket_money_next",
  "received_from_people",
  "spending_frequency",
  "lesson",
] as const;
export type CoachInsightKind = (typeof COACH_INSIGHT_KINDS)[number];

export const COACH_ACTION_KINDS = ["view_spaces", "view_goal", "view_activity", "view_pocket_money", "learn"] as const;
export type CoachActionKind = (typeof COACH_ACTION_KINDS)[number];

/** A safe, navigation-only next step. The Coach never executes anything. */
export interface CoachAction {
  kind: CoachActionKind;
  label: string;
  href: string;
}

// ── Lessons ──────────────────────────────────────────────────────

export const COACH_LESSON_IDS = [
  "available_vs_saved",
  "why_space",
  "emergency_fund",
  "spending_limit",
  "pending_payments",
  "how_spending_counts",
] as const;
export type CoachLessonId = (typeof COACH_LESSON_IDS)[number];

export interface CoachLesson {
  id: CoachLessonId;
  title: string;
  body: string;
}

/**
 * Short, factual, age-appropriate explainers. No investing, trading,
 * crypto, gambling, loans or debt — and no "you should".
 */
export const COACH_LESSONS: readonly CoachLesson[] = [
  {
    id: "available_vs_saved",
    title: "What's the difference between available and saved money?",
    body: "Available money is what you can spend or send right now. Money in a Space is still yours, just set aside for something. You can move it back to available whenever you like.",
  },
  {
    id: "why_space",
    title: "Why keep money in a Space?",
    body: "A Space gives money a job, like a goal. It makes it easier to see what the money is for, and moving it there isn't spending — it stays in your wallet.",
  },
  {
    id: "emergency_fund",
    title: "What's an emergency fund?",
    body: "It's money kept aside for surprises, like replacing a lost charger or a last-minute school trip. Even a small amount can make a surprise less stressful. Many people keep it separate so it's easy to leave alone.",
  },
  {
    id: "spending_limit",
    title: "What is a spending limit?",
    body: "A spending limit caps how much can be spent in one payment or in one day. If a parent is connected on TeenPay, they may set limits. A limit is a guide for a plan, not a judgement.",
  },
  {
    id: "pending_payments",
    title: "Why doesn't a pending payment reduce my balance?",
    body: "A payment waiting for approval hasn't happened yet. Money only leaves your balance once it's approved and sent. If it's declined, nothing moves.",
  },
  {
    id: "how_spending_counts",
    title: "How does the Coach count spending?",
    body: "Spending is money that left your available balance as a completed payment or a transfer to a friend. Money moved into your Spaces, pending or declined payments and money you receive are never counted as spending.",
  },
];

export function lessonById(id: CoachLessonId): CoachLesson {
  return COACH_LESSONS.find((lesson) => lesson.id === id)!;
}

export function lessonAnchor(id: CoachLessonId): string {
  return `learn-${id.replace(/_/g, "-")}`;
}

// ── Facts (what the sandbox derives) ─────────────────────────────

/** Money in and out of the wallet during one window. Whole rupees. */
export interface CoachPeriodTotals {
  /** Completed outgoing payments + transfers to friends. */
  spent: number;
  spendingCount: number;
  /** Of `spent`: payments to (sandbox) contacts. */
  payments: number;
  /** Of `spent`: TeenPay transfers to friends (sends and paid requests). */
  transfers: number;
  /** Refunds credited back against earlier payments — not income, not negative spending. */
  refunded: number;
  received: {
    /** Pocket money (scheduled and one-off). */
    pocketMoney: number;
    /** From friends (TeenPay transfers in) and settled requests. */
    fromPeople: number;
    /** Sandbox top-ups (fictional funding). */
    sandbox: number;
    total: number;
  };
  pocketMoneyCount: number;
  /** Moved into Spaces (space allocations). */
  movedToSpaces: number;
  /** Moved back out of Spaces (space releases). */
  movedFromSpaces: number;
}

export interface CoachGoal {
  name: string;
  /** "goal" reads as "your New Bike goal"; Save/custom Spaces with a target read by name. */
  type: "save" | "goal" | "custom";
  href: string;
  balance: number;
  target: number;
  /** 0–100, one decimal, rounded down (from the existing Space progress). */
  percent: number;
  remaining: number;
  reached: boolean;
  /** YYYY-MM-DD, when the goal has a target date. */
  deadline?: string;
  daysLeft?: number;
  deadlineState?: "upcoming" | "today" | "passed";
}

export interface CoachFacts {
  period: CoachPeriod;
  windows: CoachWindows;
  /** Any money has ever moved in this wallet. */
  hasHistory: boolean;
  /** The wallet existed for the whole comparison window. */
  canCompare: boolean;
  available: number;
  setAside: number;
  total: number;
  current: CoachPeriodTotals;
  /** Null when there isn't enough history to compare. */
  previous: CoachPeriodTotals | null;
  goals: CoachGoal[];
  pendingApprovals: { count: number; amount: number };
  nextPocketMoney: { amount: number; day: string; cadence: string } | null;
}

// ── Summary ──────────────────────────────────────────────────────

/**
 * Savings rate = net money moved into Spaces ÷ money received, in the
 * same window. Only a real percentage when that makes sense.
 */
export type CoachSavingRate =
  | { kind: "rate"; percent: number }
  /** Nothing received in the window: no denominator. */
  | { kind: "not_enough_data" }
  /** More moved back out of Spaces than in. */
  | { kind: "moved_out"; amount: number }
  /** More set aside than received (money they already had). */
  | { kind: "above_received" };

export type CoachComparison =
  | { kind: "not_enough_data" }
  | {
      kind: "compared";
      previous: number;
      change: "up" | "down" | "similar";
      /** Whole percent change; null when the previous amount was ₹0. */
      percent: number | null;
    };

export interface CoachSummary {
  period: CoachPeriod;
  range: CoachDayRange;
  previousRange: CoachDayRange;
  availableBalance: number;
  /** In Money Spaces now. */
  setAside: number;
  totalBalance: number;
  totalSpent: number;
  totalReceived: number;
  pocketMoneyReceived: number;
  /** Net moved into Spaces during the period (negative = moved back out). */
  netSetAside: number;
  spendingTransactionCount: number;
  refunded: number;
  received: CoachPeriodTotals["received"];
  savingRate: CoachSavingRate;
  spendingComparison: CoachComparison;
  /** The day (product timezone) the summary is for. */
  generatedAt: string;
}

/** Changes within ±10% of the previous amount read as "similar". */
export const SIMILAR_SPENDING_BAND = 0.1;

export function savingRateOf(netSetAside: number, received: number): CoachSavingRate {
  if (!Number.isFinite(netSetAside) || !Number.isFinite(received) || received <= 0) {
    return { kind: "not_enough_data" };
  }
  if (netSetAside < 0) return { kind: "moved_out", amount: -netSetAside };
  if (netSetAside > received) return { kind: "above_received" };
  return { kind: "rate", percent: Math.floor((netSetAside * 100) / received) };
}

export function compareSpending(current: number, previous: number | null): CoachComparison {
  if (previous === null || !Number.isFinite(previous) || !Number.isFinite(current)) {
    return { kind: "not_enough_data" };
  }
  const diff = current - previous;
  const similar = previous === 0 ? diff === 0 : Math.abs(diff) <= previous * SIMILAR_SPENDING_BAND;
  return {
    kind: "compared",
    previous,
    change: similar ? "similar" : diff > 0 ? "up" : "down",
    percent: previous === 0 ? null : Math.round((Math.abs(diff) * 100) / previous),
  };
}

export function summarize(facts: CoachFacts): CoachSummary {
  const c = facts.current;
  const netSetAside = c.movedToSpaces - c.movedFromSpaces;
  return {
    period: facts.period,
    range: facts.windows.current,
    previousRange: facts.windows.previous,
    availableBalance: facts.available,
    setAside: facts.setAside,
    totalBalance: facts.total,
    totalSpent: c.spent,
    totalReceived: c.received.total,
    pocketMoneyReceived: c.received.pocketMoney,
    netSetAside,
    spendingTransactionCount: c.spendingCount,
    refunded: c.refunded,
    received: c.received,
    savingRate: savingRateOf(netSetAside, c.received.total),
    spendingComparison: facts.canCompare
      ? compareSpending(c.spent, facts.previous?.spent ?? null)
      : { kind: "not_enough_data" },
    generatedAt: facts.windows.today,
  };
}

// ── Insights ─────────────────────────────────────────────────────

export interface CoachInsight {
  /** Stable within a report (React key); never an account or wallet id. */
  id: string;
  kind: CoachInsightKind;
  category: CoachCategory;
  tone: CoachTone;
  title: string;
  /** What the number means, which period it covers and where it came from. */
  explanation: string;
  /** The headline number, when there is one. */
  value?: { amount?: number; percent?: number };
  /** What it's compared with, when it's a comparison. */
  comparison?: { amount: number; label: string };
  action?: CoachAction;
  /** Internal ordering only (lower first). Never shown, never a score. */
  priority: number;
  period: CoachPeriod;
  /** The day the insight is for. */
  createdAt: string;
}

/** At most this many insights, so the screen stays calm. */
export const MAX_COACH_INSIGHTS = 8;
/** At most this many goal insights (the Goals section lists them all). */
const MAX_GOAL_INSIGHTS = 2;

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function goalInsight(goal: CoachGoal, index: number, base: Pick<CoachInsight, "period" | "createdAt">): CoachInsight {
  const action: CoachAction = { kind: "view_goal", label: `View ${goal.name}`, href: goal.href };
  if (goal.reached) {
    return {
      ...base,
      id: `goal_reached:${index}`,
      kind: "goal_reached",
      category: "goals",
      tone: "positive",
      title: goal.type === "goal" ? `You reached your ${goal.name} goal.` : `${goal.name} reached its ${coachINR(goal.target)} target.`,
      explanation: `${coachINR(goal.balance)} of ${coachINR(goal.target)} is set aside. The money stays in the Space until you decide to move it.`,
      value: { amount: goal.balance, percent: 100 },
      action,
      priority: 30 + index,
    };
  }
  let date = "";
  if (goal.deadline) {
    if (goal.deadlineState === "passed") {
      date = ` The target date (${formatCoachDate(goal.deadline)}) has passed — you can keep going at your own pace or change the date.`;
    } else if (goal.deadlineState === "today") {
      date = " The target date is today.";
    } else {
      date = ` Target date ${formatCoachDate(goal.deadline)} (${goal.daysLeft} ${plural(goal.daysLeft ?? 0, "day", "days")} left).`;
    }
  }
  return {
    ...base,
    id: `goal_progress:${index}`,
    kind: "goal_progress",
    category: "goals",
    tone: "neutral",
    title:
      goal.type === "goal"
        ? `Your ${goal.name} goal is ${goal.percent}% complete.`
        : `${goal.name} is ${goal.percent}% of the way to its ${coachINR(goal.target)} target.`,
    explanation: `${coachINR(goal.balance)} of ${coachINR(goal.target)} set aside — ${coachINR(goal.remaining)} to go.${date}`,
    value: { amount: goal.balance, percent: goal.percent },
    action,
    priority: 32 + index,
  };
}

function lessonFor(facts: CoachFacts): CoachLessonId {
  if (facts.pendingApprovals.count > 0) return "pending_payments";
  if (facts.setAside > 0) return "available_vs_saved";
  if (facts.goals.length === 0) return "why_space";
  return "how_spending_counts";
}

/**
 * Facts → insights, in a fixed priority order:
 * balance explanations → goals → spending → saving → pocket money →
 * money received → habits → one lesson.
 */
export function deriveInsights(facts: CoachFacts): CoachInsight[] {
  if (!facts.hasHistory) return [];
  const base = { period: facts.period, createdAt: facts.windows.today };
  const c = facts.current;
  const p = facts.previous;
  const R = formatDayRange(facts.windows.current);
  const PR = formatDayRange(facts.windows.previous);
  const inP = IN_PERIOD[facts.period];
  const inQ = IN_PREVIOUS[facts.period];
  const out: CoachInsight[] = [];

  // 1. Balance explanations.
  if (facts.pendingApprovals.count > 0) {
    const { count, amount } = facts.pendingApprovals;
    out.push({
      ...base,
      id: "pending_approval",
      kind: "pending_approval",
      category: "balance",
      tone: "neutral",
      title:
        count === 1
          ? `${coachINR(amount)} is waiting for approval.`
          : `${count} payments (${coachINR(amount)}) are waiting for approval.`,
      explanation:
        "It hasn't left your balance, so it isn't counted as spending. If it's approved, it will show in Activity; if it's declined, nothing moves.",
      value: { amount },
      action: { kind: "learn", label: "Learn about pending payments", href: `#${lessonAnchor("pending_payments")}` },
      priority: 10,
    });
  }
  out.push({
    ...base,
    id: "balance_split",
    kind: "balance_split",
    category: "balance",
    tone: "neutral",
    title:
      facts.setAside > 0
        ? `You have ${coachINR(facts.available)} available and ${coachINR(facts.setAside)} set aside.`
        : `You have ${coachINR(facts.available)} available.`,
    explanation:
      facts.setAside > 0
        ? `Available money is what you can spend or send right now. Money in Spaces is still yours — set aside, not spent. Together that's ${coachINR(facts.total)}.`
        : "Available money is what you can spend or send right now. Nothing is set aside in Spaces at the moment.",
    value: { amount: facts.available },
    action: { kind: "view_spaces", label: "View Money Spaces", href: "/money" },
    priority: 20,
  });

  // 2. Goals: reached first, then the closest to complete.
  const reached = facts.goals.filter((g) => g.reached);
  const inProgress = facts.goals.filter((g) => !g.reached).sort((a, b) => b.percent - a.percent || a.name.localeCompare(b.name));
  [...reached, ...inProgress].slice(0, MAX_GOAL_INSIGHTS).forEach((goal, index) => out.push(goalInsight(goal, index, base)));

  // 3. Spending.
  const count = `${c.spendingCount} ${plural(c.spendingCount, "payment or transfer", "payments and transfers")}`;
  if (facts.canCompare && p) {
    const cmp = compareSpending(c.spent, p.spent);
    if (cmp.kind === "compared") {
      let title: string;
      let explanation: string;
      if (c.spent === 0 && p.spent === 0) {
        title = `You haven't spent anything ${inP} or in ${inQ}.`;
        explanation = `No payments or transfers left your available balance from ${R} or ${PR}.`;
      } else if (p.spent === 0) {
        title = `You spent ${coachINR(c.spent)} ${inP}.`;
        explanation = `${count} from ${R}. You didn't spend anything from ${PR}.`;
      } else {
        const change = cmp.change;
        const pct = cmp.percent !== null ? `${cmp.percent}% ` : "";
        title =
          change === "similar"
            ? `Your spending ${inP} is similar to ${inQ}.`
            : `You spent ${pct}${change === "up" ? "more" : "less"} ${inP} than in ${inQ}.`;
        explanation = `${coachINR(c.spent)} from ${R}, compared with ${coachINR(p.spent)} from ${PR}.`;
      }
      out.push({
        ...base,
        id: "spending_change",
        kind: "spending_change",
        category: "spending",
        tone: "neutral",
        title,
        explanation,
        value: { amount: c.spent, ...(cmp.percent !== null ? { percent: cmp.percent } : {}) },
        comparison: { amount: p.spent, label: inQ },
        action: { kind: "view_activity", label: "See where your money went", href: "/activity" },
        priority: 40,
      });
    }
  } else if (c.spent > 0) {
    out.push({
      ...base,
      id: "spending_total",
      kind: "spending_total",
      category: "spending",
      tone: "neutral",
      title: `You spent ${coachINR(c.spent)} ${inP}.`,
      explanation: `${count} from ${R}. Not enough data yet to compare with ${inQ}.`,
      value: { amount: c.spent },
      action: { kind: "view_activity", label: "See where your money went", href: "/activity" },
      priority: 41,
    });
  } else {
    out.push({
      ...base,
      id: "no_spending",
      kind: "no_spending",
      category: "spending",
      tone: "neutral",
      title: `No spending ${inP}.`,
      explanation: `No payments or transfers left your available balance from ${R}.`,
      value: { amount: 0 },
      priority: 42,
    });
  }
  if (c.spendingCount >= 2 && c.payments > 0 && c.transfers > 0) {
    const title =
      c.transfers > c.payments
        ? "Most of your spending went to TeenPay friends."
        : c.payments > c.transfers
          ? "Most of your spending was payments."
          : "Your spending was split evenly between payments and transfers.";
    out.push({
      ...base,
      id: "spending_split",
      kind: "spending_split",
      category: "spending",
      tone: "neutral",
      title,
      explanation: `${coachINR(c.transfers)} in transfers to friends and ${coachINR(c.payments)} in payments, from ${R}.`,
      value: { amount: Math.max(c.transfers, c.payments) },
      priority: 45,
    });
  }

  // 4. Saving.
  const net = c.movedToSpaces - c.movedFromSpaces;
  if (net > 0) {
    const rate = savingRateOf(net, c.received.total);
    const detail =
      rate.kind === "rate"
        ? `That's ${rate.percent}% of the ${coachINR(c.received.total)} you received from ${R} (savings rate = money moved into Spaces ÷ money received).`
        : rate.kind === "above_received"
          ? `That's more than the ${coachINR(c.received.total)} you received from ${R} — some of it was money you already had.`
          : `Not enough data yet for a savings rate — you didn't receive money from ${R}.`;
    out.push({
      ...base,
      id: "set_aside",
      kind: "set_aside",
      category: "saving",
      tone: "neutral",
      title: `You set aside ${coachINR(net)} ${inP}.`,
      explanation: `Moved into your Spaces, after anything moved back. ${detail}`,
      value: { amount: net, ...(rate.kind === "rate" ? { percent: rate.percent } : {}) },
      action: { kind: "view_spaces", label: "View Money Spaces", href: "/money" },
      priority: 50,
    });
  } else if (net < 0) {
    out.push({
      ...base,
      id: "moved_from_spaces",
      kind: "moved_from_spaces",
      category: "saving",
      tone: "neutral",
      title: `You moved ${coachINR(-net)} from Spaces back to available ${inP}.`,
      explanation: `From ${R}, after anything you added. It's your money either way — it's now available to spend or send.`,
      value: { amount: -net },
      action: { kind: "view_spaces", label: "View Money Spaces", href: "/money" },
      priority: 51,
    });
  }

  // 5. Pocket money.
  if (c.pocketMoneyCount > 0) {
    out.push({
      ...base,
      id: "pocket_money_received",
      kind: "pocket_money_received",
      category: "pocket_money",
      tone: "neutral",
      title:
        c.pocketMoneyCount === 1
          ? `${coachINR(c.received.pocketMoney)} pocket money arrived ${inP}.`
          : `Pocket money arrived ${c.pocketMoneyCount} times ${inP}.`,
      explanation: `${coachINR(c.received.pocketMoney)} in total from ${R}. It's part of your available balance.`,
      value: { amount: c.received.pocketMoney },
      priority: 60,
    });
  }
  if (facts.nextPocketMoney) {
    const next = facts.nextPocketMoney;
    out.push({
      ...base,
      id: "pocket_money_next",
      kind: "pocket_money_next",
      category: "pocket_money",
      tone: "neutral",
      title: `Your next pocket money is ${coachINR(next.amount)} on ${formatCoachDay(next.day)}.`,
      explanation: `Scheduled: ${next.cadence}. The Coach only shows it — it doesn't send or change it.`,
      value: { amount: next.amount },
      action: { kind: "view_pocket_money", label: "View pocket money", href: "/family" },
      priority: 62,
    });
  }

  // 6. Money received from people.
  if (c.received.fromPeople > 0) {
    out.push({
      ...base,
      id: "received_from_people",
      kind: "received_from_people",
      category: "balance",
      tone: "neutral",
      title: `You received ${coachINR(c.received.fromPeople)} from friends ${inP}.`,
      explanation: `Money sent to you or paid for your requests, from ${R}. It's counted as money received — never as negative spending.`,
      value: { amount: c.received.fromPeople },
      priority: 65,
    });
  }

  // 7. Habits: how often (facts only).
  if (facts.canCompare && p && c.spendingCount > 0 && p.spendingCount > 0 && c.spendingCount !== p.spendingCount) {
    out.push({
      ...base,
      id: "spending_frequency",
      kind: "spending_frequency",
      category: "habit",
      tone: "neutral",
      title: `You made ${count} ${inP}, compared with ${p.spendingCount} in ${inQ}.`,
      explanation: "Only completed payments and transfers are counted — pending or declined ones aren't.",
      value: { amount: c.spendingCount },
      comparison: { amount: p.spendingCount, label: inQ },
      priority: 70,
    });
  }

  // 8. One relevant lesson.
  const lesson = lessonById(lessonFor(facts));
  out.push({
    ...base,
    id: `lesson:${lesson.id}`,
    kind: "lesson",
    category: "education",
    tone: "neutral",
    title: lesson.title,
    explanation: lesson.body,
    action: { kind: "learn", label: "Read more in Learn", href: `#${lessonAnchor(lesson.id)}` },
    priority: 90,
  });

  return out.sort((a, b) => a.priority - b.priority).slice(0, MAX_COACH_INSIGHTS);
}

// ── Report ───────────────────────────────────────────────────────

export interface CoachReport {
  summary: CoachSummary;
  insights: CoachInsight[];
  goals: CoachGoal[];
  lessons: readonly CoachLesson[];
  /** No money has moved in this wallet yet: show the welcome state. */
  empty: boolean;
  /** Not enough history to compare with the previous window. */
  lowData: boolean;
  /** The Home card's one-line summary (always "this month"-style for the period given). */
  headline: string;
}

export function coachHeadline(facts: CoachFacts): string {
  if (!facts.hasHistory) return "Your Money Coach is getting to know your money.";
  const c = facts.current;
  const inP = IN_PERIOD[facts.period];
  const net = c.movedToSpaces - c.movedFromSpaces;
  if (net > 0) return `You set aside ${coachINR(net)} ${inP}.`;
  if (c.spent > 0) return `You spent ${coachINR(c.spent)} ${inP}.`;
  if (c.received.total > 0) return `You received ${coachINR(c.received.total)} ${inP}.`;
  return `No money moved ${inP}.`;
}

export function deriveCoachReport(facts: CoachFacts): CoachReport {
  return {
    summary: summarize(facts),
    insights: deriveInsights(facts),
    goals: facts.goals,
    lessons: COACH_LESSONS,
    empty: !facts.hasHistory,
    lowData: facts.hasHistory && !facts.canCompare,
    headline: coachHeadline(facts),
  };
}

/** Sentence-case period text for UI captions ("this week"). */
export function inPeriodText(period: CoachPeriod): string {
  return IN_PERIOD[period];
}

/** Comparison window text ("the same days last week"). */
export function previousPeriodText(period: CoachPeriod): string {
  return IN_PREVIOUS[period];
}
