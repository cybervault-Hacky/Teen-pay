import type {
  AllowanceSchedule,
  ApprovalRule,
  LedgerEntry,
  SpendingLimits,
  User,
} from "@/domain";
import { formatINR } from "@/lib/currency";
import { dayKey } from "@/lib/format";
import { amountError, SPENDING_TYPES, walletBalance } from "./engine";
import { activeControls, findUser, linkedGuardian } from "./identity";
import { primaryWalletOf, walletMutationError } from "./operations";
import {
  MAX_DAILY_LIMIT,
  MAX_SANDBOX_AMOUNT,
  type SandboxError,
  type SandboxState,
} from "./types";

/**
 * Guardian rules engine — pure and deterministic.
 *
 * Every payment decision in the app goes through `evaluatePayment`:
 * the pay flow uses it for live guidance, and the payment and
 * approval transitions use it again before anything is written.
 * The UI never re-implements a rule.
 *
 *   amount → wallet status → recipient → balance → per-payment limit
 *          → approval rule ──(above threshold)──▶ needs approval
 *          → daily limit   ──(within)──────────▶ execute
 *
 * The daily limit governs payments the teen makes on their own.
 * A payment above the approval threshold is decided by the
 * guardian instead; once approved it executes (and counts toward
 * today's total). The per-payment limit is a hard ceiling for both.
 */

// ── Spending status ──────────────────────────────────────────────

/**
 * Rupees spent on `at`'s calendar day (Asia/Kolkata), from completed
 * ledger entries only — pending approvals never count, and refunds
 * don't give limit back. Pass `walletId` to count one wallet (the
 * daily limit is per account); without it, every entry given counts.
 */
export function spentOnDay(
  ledger: readonly LedgerEntry[],
  at: string,
  walletId?: string,
): number {
  const today = dayKey(at);
  return ledger
    .filter(
      (entry) =>
        SPENDING_TYPES.has(entry.type) &&
        entry.status === "completed" &&
        (walletId === undefined || entry.walletId === walletId) &&
        dayKey(entry.createdAt) === today,
    )
    .reduce((sum, entry) => sum + entry.amount, 0);
}

/** The teen's primary wallet id in this view ("" when not visible). */
function teenWalletId(state: SandboxState, teenId: string): string {
  return primaryWalletOf(state.wallets, teenId)?.id ?? "";
}

export interface SpendingStatus {
  /** True when a guardian is linked and rules can apply. */
  controlsActive: boolean;
  guardian: User | null;
  todaySpent: number;
  dailyLimit: number | null;
  /** `null` when there is no daily limit. Never negative. */
  remainingToday: number | null;
  perTransactionLimit: number | null;
  approvalThreshold: number | null;
}

export function spendingStatus(
  state: SandboxState,
  teenId: string,
  at: string,
): SpendingStatus {
  const controls = activeControls(state, teenId);
  const todaySpent = spentOnDay(state.ledger, at, teenWalletId(state, teenId));
  const dailyLimit = controls?.limits.dailyLimit ?? null;
  return {
    controlsActive: controls !== null,
    guardian: linkedGuardian(state, teenId),
    todaySpent,
    dailyLimit,
    remainingToday:
      dailyLimit === null ? null : Math.max(0, dailyLimit - todaySpent),
    perTransactionLimit: controls?.limits.perTransactionLimit ?? null,
    approvalThreshold: controls?.approval.threshold ?? null,
  };
}

// ── Payment decision ─────────────────────────────────────────────

export interface PaymentCheckInput {
  teenId: string;
  recipientId: string;
  amount: number;
  /** ISO timestamp the decision is made at (drives "today"). */
  at: string;
}

export type PaymentDecision =
  | { kind: "execute" }
  | { kind: "needs_approval"; guardian: User; threshold: number }
  | { kind: "rejected"; error: SandboxError };

function reject(error: SandboxError): PaymentDecision {
  return { kind: "rejected", error };
}

/**
 * Decides what should happen to a payment. `mode: "approved"` is
 * used when a guardian has approved it: the approval rule and the
 * daily limit are then satisfied by that decision, but amount,
 * balance, and the per-payment ceiling are re-checked.
 */
export function evaluatePayment(
  state: SandboxState,
  input: PaymentCheckInput,
  mode: "teen" | "approved" = "teen",
): PaymentDecision {
  const amountProblem = amountError(input.amount);
  if (amountProblem) return reject(amountProblem);

  const wallet = primaryWalletOf(state.wallets, input.teenId);
  if (!wallet) {
    return reject({ code: "unknown_wallet", message: "This wallet isn't available." });
  }
  const blocked = walletMutationError(wallet);
  if (blocked) return reject(blocked);

  if (!state.recipients.some((r) => r.id === input.recipientId)) {
    return reject({
      code: "unknown_recipient",
      message: "That recipient is no longer available.",
    });
  }

  const available = walletBalance(state.ledger, wallet.id);
  if (input.amount > available) {
    return reject({
      code: "insufficient_balance",
      message: `You have ${formatINR(available)} available.`,
    });
  }

  const controls = activeControls(state, input.teenId);
  if (!controls) return { kind: "execute" };

  const { perTransactionLimit, dailyLimit } = controls.limits;
  if (perTransactionLimit !== null && input.amount > perTransactionLimit) {
    return reject({
      code: "exceeds_transaction_limit",
      message: `This payment is outside your current spending rules — the most you can send at once is ${formatINR(perTransactionLimit)}.`,
    });
  }

  if (mode === "approved") return { kind: "execute" };

  const threshold = controls.approval.threshold;
  const guardian = linkedGuardian(state, input.teenId);
  if (threshold !== null && guardian && input.amount > threshold) {
    return { kind: "needs_approval", guardian, threshold };
  }

  if (dailyLimit !== null) {
    const spent = spentOnDay(state.ledger, input.at, wallet.id);
    if (spent + input.amount > dailyLimit) {
      const left = Math.max(0, dailyLimit - spent);
      return reject({
        code: "exceeds_daily_limit",
        message:
          left > 0
            ? `This payment would exceed today's spending limit. You have ${formatINR(left)} left today.`
            : "This payment would exceed today's spending limit. Your limit resets tomorrow.",
      });
    }
  }

  return { kind: "execute" };
}

// ── Rule validation (guardian inputs) ────────────────────────────

function wholeRupeesInRange(value: number, max: number): boolean {
  return Number.isInteger(value) && value >= 1 && value <= max;
}

export function validateSpendingRules(
  limits: SpendingLimits,
  approval: ApprovalRule,
): SandboxError | null {
  if (
    limits.dailyLimit !== null &&
    !wholeRupeesInRange(limits.dailyLimit, MAX_DAILY_LIMIT)
  ) {
    return {
      code: "invalid_rule",
      message: `Set a daily limit between ₹1 and ${formatINR(MAX_DAILY_LIMIT)}.`,
    };
  }
  if (
    limits.perTransactionLimit !== null &&
    !wholeRupeesInRange(limits.perTransactionLimit, MAX_SANDBOX_AMOUNT)
  ) {
    return {
      code: "invalid_rule",
      message: `Set a per-payment limit between ₹1 and ${formatINR(MAX_SANDBOX_AMOUNT)}.`,
    };
  }
  if (
    approval.threshold !== null &&
    !wholeRupeesInRange(approval.threshold, MAX_SANDBOX_AMOUNT)
  ) {
    return {
      code: "invalid_rule",
      message: `Set an approval amount between ₹1 and ${formatINR(MAX_SANDBOX_AMOUNT)}.`,
    };
  }
  return null;
}

export function validateAllowanceSchedule(
  schedule: AllowanceSchedule,
): SandboxError | null {
  const amountProblem = amountError(schedule.amount);
  if (amountProblem) return amountProblem;
  if (schedule.frequency !== "weekly" && schedule.frequency !== "monthly") {
    return { code: "invalid_rule", message: "Choose weekly or monthly." };
  }
  if (!Number.isInteger(schedule.weekday) || schedule.weekday < 0 || schedule.weekday > 6) {
    return { code: "invalid_rule", message: "Choose a day of the week." };
  }
  if (
    !Number.isInteger(schedule.dayOfMonth) ||
    schedule.dayOfMonth < 1 ||
    schedule.dayOfMonth > 28
  ) {
    return { code: "invalid_rule", message: "Choose a day between 1 and 28." };
  }
  return null;
}

// ── Allowance schedule preview ───────────────────────────────────

export const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

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
export function describeScheduleCadence(schedule: AllowanceSchedule): string {
  return schedule.frequency === "weekly"
    ? `Every ${WEEKDAY_NAMES[schedule.weekday] ?? "week"}`
    : `On the ${ordinal(schedule.dayOfMonth)} of every month`;
}

/**
 * The next payout date on or after `at`'s calendar day (Asia/
 * Kolkata), as "YYYY-MM-DD". Preview only — nothing auto-sends.
 */
export function nextAllowanceDate(
  schedule: AllowanceSchedule,
  at: string,
): string {
  const [y, m, d] = dayKey(at).split("-").map(Number);
  // Noon UTC keeps the calendar date stable while stepping days.
  const cursor = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 12));
  for (let i = 0; i < 62; i += 1) {
    const matches =
      schedule.frequency === "weekly"
        ? cursor.getUTCDay() === schedule.weekday
        : cursor.getUTCDate() === schedule.dayOfMonth;
    if (matches) return cursor.toISOString().slice(0, 10);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return cursor.toISOString().slice(0, 10);
}

/** Resolves a user's short name, tolerating unknown ids. */
export function shortName(state: SandboxState, userId: string): string {
  return findUser(state, userId)?.displayName ?? "Someone";
}
