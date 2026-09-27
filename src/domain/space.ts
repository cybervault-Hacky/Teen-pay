import { checkMoney } from "./money";

/**
 * Domain: Money Spaces — purpose-based money inside a wallet.
 *
 * A Space is a named allocation of a wallet's money (Save, a goal,
 * a custom pot). It holds no balance of its own: its balance is
 * derived from the wallet's ledger — money moved in (space_allocation
 * entries, which leave the available balance) minus money moved back
 * (space_release entries, which return to it). So
 *
 *   wallet total = available balance + Σ active Space balances
 *
 * always holds, and nothing can be spent twice.
 *
 * Progress, remaining amount and deadline state are derived here
 * from the balance and the Space's settings — never stored.
 */
export type SpaceType = "save" | "goal" | "custom";
export type SpaceStatus = "active" | "archived";

/** The icons a Space may use (Lucide names, resolved in the UI). */
export const SPACE_ICONS = [
  "piggy-bank",
  "target",
  "shield",
  "shopping-bag",
  "graduation-cap",
  "plane",
  "headphones",
  "bike",
  "gift",
  "laptop",
  "music",
  "heart",
] as const;
export type SpaceIcon = (typeof SPACE_ICONS)[number];

export interface MoneySpace {
  id: string;
  ownerAccountId: string;
  /** The wallet whose money this Space holds. */
  walletId: string;
  name: string;
  type: SpaceType;
  icon: SpaceIcon;
  /** Whole rupees. Required for goals, optional otherwise. */
  targetAmount?: number;
  /** Target date (YYYY-MM-DD, product timezone). Goals only. */
  deadline?: string;
  status: SpaceStatus;
  /** Ordering among the owner's Spaces (ascending). */
  displayOrder: number;
  /** The account's default Save Space — always present, never archived. */
  isDefault?: boolean;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

export const SPACE_NAME_MAX = 30;
/** Largest target a Space may have (sandbox planning aid). */
export const MAX_SPACE_TARGET = 100_000;
/** Active Spaces per account. */
export const MAX_ACTIVE_SPACES = 12;
/** How far ahead a target date may be. */
export const MAX_DEADLINE_YEARS = 10;

export const SPACE_TYPE_LABELS: Record<SpaceType, string> = {
  save: "Save",
  goal: "Goal",
  custom: "Space",
};

export function defaultSaveSpaceId(accountId: string): string {
  return `spc_save_${accountId}`;
}

export function isSpaceIcon(value: unknown): value is SpaceIcon {
  return typeof value === "string" && (SPACE_ICONS as readonly string[]).includes(value);
}

// ── Dates (product timezone: Asia/Kolkata, UTC+5:30, no DST) ─────

const IST_OFFSET_MS = 330 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** The calendar day of an instant in the product timezone. */
export function productDay(iso: string): string {
  return new Date(Date.parse(iso) + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Is `value` a real calendar date written YYYY-MM-DD? */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function daysBetween(fromDay: string, toDay: string): number {
  return Math.round(
    (Date.parse(`${toDay}T00:00:00Z`) - Date.parse(`${fromDay}T00:00:00Z`)) / DAY_MS,
  );
}

// ── Validation (one place, used by the engine and the forms) ─────

export interface SpaceFieldErrors {
  name?: string;
  targetAmount?: string;
  deadline?: string;
  icon?: string;
  type?: string;
}

export function spaceNameError(name: string, otherActiveNames: readonly string[]): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return "Give this space a name.";
  if (trimmed.length > SPACE_NAME_MAX) return `Keep the name under ${SPACE_NAME_MAX + 1} characters.`;
  const key = trimmed.toLocaleLowerCase("en-IN");
  if (otherActiveNames.some((n) => n.trim().toLocaleLowerCase("en-IN") === key)) {
    return "You already have a space with this name.";
  }
  return null;
}

/**
 * A target, if given, is whole rupees from ₹1 to the cap. Goals need
 * one, and a goal's target can't be below what's already in it.
 */
export function spaceTargetError(
  type: SpaceType,
  target: number | null | undefined,
  currentBalance = 0,
): string | null {
  if (target === null || target === undefined) {
    return type === "goal" ? "Goals need a target amount." : null;
  }
  switch (checkMoney(target, { max: MAX_SPACE_TARGET })) {
    case null:
      break;
    case "above_maximum":
      return "Targets are capped at ₹1,00,000 in the sandbox.";
    case "not_positive":
      return "A target must be above ₹0.";
    default:
      return "Enter a whole-rupee target.";
  }
  if (type === "goal" && target < currentBalance) {
    return "The target can't be less than what's already saved.";
  }
  return null;
}

/** A target date is a real date, today or later, within 10 years. Goals only. */
export function spaceDeadlineError(
  type: SpaceType,
  deadline: string | null | undefined,
  today: string,
): string | null {
  if (deadline === null || deadline === undefined || deadline === "") return null;
  if (type !== "goal") return "Only goals have a target date.";
  if (!isCalendarDate(deadline)) return "Enter a valid date.";
  if (deadline < today) return "Pick today or a later date.";
  const [y, m, d] = today.split("-");
  if (deadline > `${Number(y) + MAX_DEADLINE_YEARS}-${m}-${d}`) {
    return `Pick a date within ${MAX_DEADLINE_YEARS} years.`;
  }
  return null;
}

export interface SpaceDraft {
  name: string;
  type: SpaceType;
  icon: SpaceIcon;
  targetAmount?: number | null;
  deadline?: string | null;
}

/** All field problems of a draft (empty object = valid). */
export function validateSpaceDraft(
  draft: SpaceDraft,
  context: {
    otherActiveNames: readonly string[];
    today: string;
    currentBalance?: number;
    /** An unchanged, already-passed date may be kept when editing. */
    previousDeadline?: string;
  },
): SpaceFieldErrors {
  const errors: SpaceFieldErrors = {};
  if (draft.type !== "save" && draft.type !== "goal" && draft.type !== "custom") {
    errors.type = "Choose a type.";
  }
  if (!isSpaceIcon(draft.icon)) errors.icon = "Choose an icon.";
  const name = spaceNameError(draft.name, context.otherActiveNames);
  if (name) errors.name = name;
  const target = spaceTargetError(draft.type, draft.targetAmount, context.currentBalance ?? 0);
  if (target) errors.targetAmount = target;
  const keepsOldDate =
    context.previousDeadline !== undefined && draft.deadline === context.previousDeadline;
  const deadline = keepsOldDate ? null : spaceDeadlineError(draft.type, draft.deadline, context.today);
  if (deadline) errors.deadline = deadline;
  return errors;
}

// ── Derived progress ─────────────────────────────────────────────

export interface SpaceProgress {
  balance: number;
  target?: number;
  /** Rupees still to go (0 once reached). */
  remaining?: number;
  /** 0–100 with one decimal, rounded down (never "100%" early). */
  percent?: number;
  reached: boolean;
}

export function spaceProgress(balance: number, target?: number): SpaceProgress {
  if (!target) return { balance, reached: false };
  const percent = Math.min(100, Math.floor((balance * 1000) / target) / 10);
  return {
    balance,
    target,
    remaining: Math.max(0, target - balance),
    percent,
    reached: balance >= target,
  };
}

export interface DeadlineInfo {
  date: string;
  /** Whole days from today (negative once passed). */
  daysLeft: number;
  state: "upcoming" | "today" | "passed";
}

export function deadlineInfo(deadline: string, today: string): DeadlineInfo {
  const daysLeft = daysBetween(today, deadline);
  return {
    date: deadline,
    daysLeft,
    state: daysLeft > 0 ? "upcoming" : daysLeft === 0 ? "today" : "passed",
  };
}

/** Neutral, non-promissory wording for a target date. */
export function deadlineLabel(info: DeadlineInfo): string {
  if (info.state === "passed") return "Target date passed";
  if (info.state === "today") return "Target date is today";
  if (info.daysLeft === 1) return "1 day left";
  if (info.daysLeft < 60) return `${info.daysLeft} days left`;
  const months = Math.floor(info.daysLeft / 30);
  return `About ${months} months left`;
}
