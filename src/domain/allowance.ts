import { checkMoney, MAX_SANDBOX_AMOUNT, SANDBOX_CURRENCY, type CurrencyCode } from "./money";
import { isCalendarDate, productDay } from "./space";

/**
 * Domain: Pocket Money Autopilot — recurring pocket money from a
 * parent's wallet to their linked teen's wallet.
 *
 * A schedule is a *plan*; money only moves when an occurrence is
 * executed (explicitly — there is no background timer in the
 * sandbox), and then only as one atomic `allowance` operation posted
 * through the single money write path. The ledger stays the only
 * financial truth: a schedule never stores a balance, and a run only
 * points at the operation that moved the money.
 *
 * Dates are calendar days in the product timezone (Asia/Kolkata,
 * UTC+5:30, no DST). An occurrence is due from the start of its day
 * there (00:00 IST).
 */

export type PocketMoneyFrequency = "weekly" | "monthly";

export type PocketMoneyScheduleStatus = "active" | "paused" | "completed" | "cancelled";

/** Why a schedule stopped for good (completed or cancelled). */
export type PocketMoneyEndReason =
  /** The parent cancelled it. */
  | "cancelled"
  /** The family link ended (either side disconnected). */
  | "family_disconnected"
  /** The final occurrence on or before the end date was processed. */
  | "end_date_reached";

/** Why one occurrence couldn't be paid. Nothing moved in any case. */
export type PocketMoneyFailureReason =
  | "insufficient_funds"
  | "source_frozen"
  | "source_closed"
  | "destination_frozen"
  | "destination_closed"
  | "wallet_unavailable"
  | "rejected";

/**
 * One processed occurrence. `id` is the execution identity
 * (`scheduleId:YYYY-MM-DD`) and doubles as the operation id, so the
 * same occurrence can never be paid twice. Runs are append-only.
 */
export interface PocketMoneyRun {
  id: string;
  scheduleId: string;
  /** The occurrence's calendar day, YYYY-MM-DD. */
  occurrence: string;
  status: "completed" | "failed";
  amount: number;
  /** When the attempt happened (ISO 8601). */
  at: string;
  /** Completed runs: the operation that moved the money (= `id`). */
  operationId?: string;
  /** Completed runs: the human-facing reference, e.g. ALW-3F9Q2M7K. */
  reference?: string;
  /** Failed runs. Redacted in the teen's view. */
  reason?: PocketMoneyFailureReason;
  message?: string;
  /**
   * Earlier occurrences that were due but not executed in time. Under
   * the missed-schedule policy they are skipped, never paid later.
   */
  missed?: number;
}

export interface PocketMoneySchedule {
  id: string;
  familyId: string;
  parentAccountId: string;
  teenAccountId: string;
  /** Always the parent's own wallet (derived by the engine, never the UI). */
  sourceWalletId: string;
  /** Always the teen's own wallet. */
  destinationWalletId: string;
  /** Whole rupees per occurrence. */
  amount: number;
  currency: CurrencyCode;
  frequency: PocketMoneyFrequency;
  /** 0 = Sunday … 6 = Saturday. Used when weekly. */
  dayOfWeek: number;
  /** 1–28 (every month has one). Used when monthly. */
  dayOfMonth: number;
  /** First day an occurrence may fall on, YYYY-MM-DD. */
  startDate: string;
  /** Last day an occurrence may fall on, YYYY-MM-DD (inclusive). */
  endDate?: string;
  /**
   * When the next occurrence becomes due (00:00 IST on its day).
   * Null while paused, and once completed or cancelled.
   */
  nextRunAt: string | null;
  status: PocketMoneyScheduleStatus;
  endedReason?: PocketMoneyEndReason;
  createdAt: string;
  updatedAt: string;
  /** The latest attempt, successful or not. */
  lastRunAt?: string;
  createdBy: string;
  /** Bumped on every change; stale edits are rejected against it. */
  version: number;
  /**
   * The family link this schedule belongs to (the link's `linkedAt`).
   * A later re-link is a new relationship: old schedules never revive.
   */
  linkedAt: string;
  runs: PocketMoneyRun[];
}

/** The part of a schedule that decides which days are occurrences. */
export interface PocketMoneyCadence {
  frequency: PocketMoneyFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
}

export const POCKET_MONEY_DAY_OF_MONTH_MAX = 28;

/** Exact copy required for an insufficient-funds occurrence. */
export const INSUFFICIENT_FUNDS_MESSAGE =
  "Pocket money couldn't be sent because the parent's available balance was too low.";

/** What a teen sees for any failed occurrence (reasons stay private). */
export const TEEN_FAILED_RUN_MESSAGE = "This pocket money wasn't sent.";

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// ── Calendar arithmetic (pure, on YYYY-MM-DD keys) ───────────────

const DAY_MS = 24 * 60 * 60 * 1000;
/** Upper bound on day-stepping loops (a monthly cadence repeats within 62). */
const SEARCH_DAYS = 62;

function toUtcNoon(day: string): Date {
  return new Date(`${day}T12:00:00Z`);
}

export function addDays(day: string, days: number): string {
  return new Date(toUtcNoon(day).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Is `day` one of the cadence's occurrence days? */
export function isOccurrenceDay(cadence: PocketMoneyCadence, day: string): boolean {
  const date = toUtcNoon(day);
  return cadence.frequency === "weekly"
    ? date.getUTCDay() === cadence.dayOfWeek
    : date.getUTCDate() === cadence.dayOfMonth;
}

/** The first occurrence on or after `day`. */
export function firstOccurrenceOnOrAfter(cadence: PocketMoneyCadence, day: string): string {
  let cursor = day;
  for (let i = 0; i < SEARCH_DAYS; i += 1) {
    if (isOccurrenceDay(cadence, cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return cursor;
}

/** The first occurrence strictly after `day`. */
export function nextOccurrenceAfter(cadence: PocketMoneyCadence, day: string): string {
  return firstOccurrenceOnOrAfter(cadence, addDays(day, 1));
}

/** The latest occurrence on or before `day`, not before `floor`, or null. */
export function latestOccurrenceBetween(
  cadence: PocketMoneyCadence,
  floor: string,
  day: string,
): string | null {
  let cursor = day;
  for (let i = 0; i < SEARCH_DAYS && cursor >= floor; i += 1) {
    if (isOccurrenceDay(cadence, cursor)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return null;
}

/** How many occurrences fall in [from, before). Bounded work. */
export function countOccurrences(cadence: PocketMoneyCadence, from: string, before: string): number {
  if (from >= before) return 0;
  const days = Math.round((toUtcNoon(before).getTime() - toUtcNoon(from).getTime()) / DAY_MS);
  if (cadence.frequency === "weekly") {
    const first = firstOccurrenceOnOrAfter(cadence, from);
    if (first >= before) return 0;
    const span = Math.round((toUtcNoon(before).getTime() - toUtcNoon(first).getTime()) / DAY_MS);
    return Math.ceil(span / 7);
  }
  let count = 0;
  let cursor = firstOccurrenceOnOrAfter(cadence, from);
  // At most one per month: days/28 + 1 iterations.
  for (let i = 0; i <= Math.ceil(days / 28) + 1 && cursor < before; i += 1) {
    count += 1;
    cursor = nextOccurrenceAfter(cadence, cursor);
  }
  return count;
}

/** 00:00 IST on `day`, as an ISO instant — when that occurrence is due. */
export function dueInstant(day: string): string {
  return new Date(`${day}T00:00:00+05:30`).toISOString();
}

/** The calendar day of a due instant (inverse of `dueInstant`). */
export function occurrenceDayOf(instant: string): string {
  return productDay(instant);
}

/** The execution identity — and operation id — for one occurrence. */
export function pocketMoneyExecutionId(scheduleId: string, occurrence: string): string {
  return `${scheduleId}:${occurrence}`;
}

// ── Copy ─────────────────────────────────────────────────────────

function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "Every Monday" / "On the 1st of every month". */
export function describePocketMoneyCadence(cadence: PocketMoneyCadence): string {
  return cadence.frequency === "weekly"
    ? `Every ${WEEKDAY_NAMES[cadence.dayOfWeek] ?? "week"}`
    : `On the ${ordinal(cadence.dayOfMonth)} of every month`;
}

export const SCHEDULE_STATUS_LABEL: Record<PocketMoneyScheduleStatus, string> = {
  active: "Active",
  paused: "Paused",
  completed: "Completed",
  cancelled: "Cancelled",
};

// ── Validation (one place, used by the engine and the form) ──────

export type PocketMoneyField = "amount" | "frequency" | "day" | "startDate" | "endDate";

export interface PocketMoneyScheduleInput {
  amount: number;
  frequency: PocketMoneyFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  startDate: string;
  endDate?: string;
}

export interface PocketMoneyFieldError {
  field: PocketMoneyField;
  message: string;
}

/**
 * Validates a schedule's plan against `today` (product timezone).
 * `allowPastStart` is for edits of a schedule that already started.
 * Returns the first problem, or null.
 */
export function validatePocketMoneyInput(
  input: PocketMoneyScheduleInput,
  today: string,
  options: { allowPastStart?: boolean } = {},
): PocketMoneyFieldError | null {
  const money = checkMoney(input.amount);
  if (money) {
    return {
      field: "amount",
      message:
        money === "above_maximum"
          ? `Pocket money can be up to ₹${MAX_SANDBOX_AMOUNT.toLocaleString("en-IN")} per transfer in the sandbox.`
          : money === "not_integer"
            ? "Use whole rupees."
            : "Enter an amount above ₹0.",
    };
  }
  if (input.frequency !== "weekly" && input.frequency !== "monthly") {
    return { field: "frequency", message: "Choose weekly or monthly." };
  }
  if (input.frequency === "weekly") {
    if (!Number.isInteger(input.dayOfWeek) || input.dayOfWeek < 0 || input.dayOfWeek > 6) {
      return { field: "day", message: "Choose a day of the week." };
    }
  } else if (
    !Number.isInteger(input.dayOfMonth) ||
    input.dayOfMonth < 1 ||
    input.dayOfMonth > POCKET_MONEY_DAY_OF_MONTH_MAX
  ) {
    return { field: "day", message: "Choose a day between 1 and 28." };
  }
  if (!isCalendarDate(input.startDate)) {
    return { field: "startDate", message: "Choose a start date." };
  }
  if (!options.allowPastStart && input.startDate < today) {
    return { field: "startDate", message: "The start date can't be in the past." };
  }
  if (input.endDate !== undefined) {
    if (!isCalendarDate(input.endDate)) {
      return { field: "endDate", message: "Choose a valid end date, or leave it empty." };
    }
    if (input.endDate < input.startDate) {
      return { field: "endDate", message: "The end date can't be before the start date." };
    }
    const first = firstOccurrenceOnOrAfter(
      input,
      input.startDate < today && options.allowPastStart ? today : input.startDate,
    );
    if (first > input.endDate) {
      return {
        field: "endDate",
        message: "No transfer day falls between the start and end dates.",
      };
    }
  }
  return null;
}

/** Normalises the unused day so equal plans compare equal. */
export function normalizeCadence<T extends PocketMoneyCadence>(input: T): T {
  return input.frequency === "weekly"
    ? { ...input, dayOfMonth: 1 }
    : { ...input, dayOfWeek: 1 };
}

// ── Derived schedule facts ───────────────────────────────────────

/** The next occurrence's day, or null when nothing more will run. */
export function nextOccurrenceOf(schedule: PocketMoneySchedule): string | null {
  return schedule.nextRunAt ? occurrenceDayOf(schedule.nextRunAt) : null;
}

/** The last processed occurrence's day, if any. */
export function lastOccurrenceOf(schedule: PocketMoneySchedule): string | null {
  return schedule.runs.reduce<string | null>(
    (latest, run) => (latest === null || run.occurrence > latest ? run.occurrence : latest),
    null,
  );
}

/**
 * The first occurrence a schedule may run on from `today`: not before
 * its start date, not on or before an already-processed occurrence.
 * Null when that would be past the end date.
 */
export function upcomingOccurrence(
  schedule: Pick<PocketMoneySchedule, "startDate" | "endDate" | "runs"> & PocketMoneyCadence,
  today: string,
): string | null {
  const last = schedule.runs.reduce<string | null>(
    (latest, run) => (latest === null || run.occurrence > latest ? run.occurrence : latest),
    null,
  );
  let floor = today > schedule.startDate ? today : schedule.startDate;
  if (last !== null && last >= floor) floor = addDays(last, 1);
  const next = firstOccurrenceOnOrAfter(schedule, floor);
  return schedule.endDate !== undefined && next > schedule.endDate ? null : next;
}

export function isOpenSchedule(schedule: PocketMoneySchedule): boolean {
  return schedule.status === "active" || schedule.status === "paused";
}

export { SANDBOX_CURRENCY as POCKET_MONEY_CURRENCY };
