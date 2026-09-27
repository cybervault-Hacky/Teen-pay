import {
  describePocketMoneyCadence,
  firstOccurrenceOnOrAfter,
  type ApprovalRule,
  type LedgerEntry,
  type PocketMoneyCadence,
  type SpendingLimits,
  type User,
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
 * Every spending decision in the app goes through one core
 * (`decideSpend`), exposed as `evaluatePayment` (sandbox contacts) and
 * `evaluateTransfer` (TeenPay-to-TeenPay: sending money and paying a
 * money request). The flows use it for live guidance, and the
 * transitions use it again before anything is written. The UI never
 * re-implements a rule.
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

/** A TeenPay-to-TeenPay transfer (the recipient is checked by the peer engine). */
export interface TransferCheckInput {
  teenId: string;
  amount: number;
  at: string;
}

export type PaymentDecision =
  | { kind: "execute" }
  | { kind: "needs_approval"; guardian: User; threshold: number }
  | { kind: "rejected"; error: SandboxError };

function reject(error: SandboxError): PaymentDecision {
  return { kind: "rejected", error };
}

/** The one message for spending more than the available balance. */
export function notEnoughAvailable(available: number): SandboxError {
  return {
    code: "insufficient_balance",
    message: `Not enough available money. You have ${formatINR(available)} available.`,
  };
}

/**
 * The single spending decision. Contact payments and TeenPay
 * transfers differ only in how the payee is checked (`payeeProblem`)
 * and in the insufficient-balance wording; the order, the balance
 * (available only — Money Spaces are never spendable), the limits and
 * the approval threshold are shared, so there is exactly one set of
 * guardian rules.
 */
function decideSpend(
  state: SandboxState,
  input: { teenId: string; amount: number; at: string },
  mode: "teen" | "approved",
  payeeProblem: () => SandboxError | null,
  insufficient: (available: number) => SandboxError,
): PaymentDecision {
  if (typeof input.amount !== "number") {
    return reject({ code: "invalid_amount", message: "Enter an amount above zero." });
  }
  const amountProblem = amountError(input.amount);
  if (amountProblem) return reject(amountProblem);

  const wallet = primaryWalletOf(state.wallets, input.teenId);
  if (!wallet) {
    return reject({ code: "unknown_wallet", message: "This wallet isn't available." });
  }
  const blocked = walletMutationError(wallet);
  if (blocked) return reject(blocked);

  const payee = payeeProblem();
  if (payee) return reject(payee);

  const available = walletBalance(state.ledger, wallet.id);
  if (input.amount > available) return reject(insufficient(available));

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

/**
 * Decides what should happen to a payment to a sandbox contact.
 * `mode: "approved"` is used when a guardian has approved it: the
 * approval rule and the daily limit are then satisfied by that
 * decision, but amount, balance, and the per-payment ceiling are
 * re-checked.
 */
export function evaluatePayment(
  state: SandboxState,
  input: PaymentCheckInput,
  mode: "teen" | "approved" = "teen",
): PaymentDecision {
  return decideSpend(
    state,
    input,
    mode,
    () =>
      state.recipients.some((r) => r.id === input.recipientId)
        ? null
        : { code: "unknown_recipient", message: "That recipient is no longer available." },
    (available) => ({
      code: "insufficient_balance",
      message: `You have ${formatINR(available)} available.`,
    }),
  );
}

/**
 * Decides a TeenPay-to-TeenPay transfer from `teenId`'s wallet — the
 * same rules as a payment (see `decideSpend`). The recipient account
 * is resolved and checked by the peer engine before this runs; this
 * is only ever called with the sender's own scope (or, on approval,
 * the approving guardian's).
 */
export function evaluateTransfer(
  state: SandboxState,
  input: TransferCheckInput,
  mode: "teen" | "approved" = "teen",
): PaymentDecision {
  return decideSpend(state, input, mode, () => null, notEnoughAvailable);
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

// ── Pocket money cadence (the domain owns the calendar maths) ────

export { WEEKDAY_NAMES } from "@/domain";

/** "Every Monday" / "On the 1st of every month". */
export function describeScheduleCadence(cadence: PocketMoneyCadence): string {
  return describePocketMoneyCadence(cadence);
}

/**
 * The first occurrence on or after `at`'s calendar day (Asia/Kolkata),
 * as "YYYY-MM-DD". A preview: nothing moves until an occurrence runs.
 */
export function nextAllowanceDate(cadence: PocketMoneyCadence, at: string): string {
  return firstOccurrenceOnOrAfter(cadence, dayKey(at));
}

/** Resolves a user's short name, tolerating unknown ids. */
export function shortName(state: SandboxState, userId: string): string {
  return findUser(state, userId)?.displayName ?? "Someone";
}
