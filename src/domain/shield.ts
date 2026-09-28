/**
 * Domain: Teen Safety Shield (Phase 14).
 *
 * One question, answered deterministically from sandbox data:
 *
 *   "Is this action something the teen should pause, review or see
 *    context for before money moves?"
 *
 * What the shield is NOT: it never scores anyone (no risk, trust,
 * safety or danger numbers — Money Coach deliberately avoids
 * financial-health scoring, and so does this), never labels people,
 * never blocks on its own, never watches anything in the background
 * and never reports to parents. Hard protection stays where it
 * already lives: guardian approvals, daily limits, balance and
 * freeze checks, authorization and ledger invariants. The shield only
 * adds calm, explainable context around an action the teen chose.
 *
 * Everything here is pure — no clock, no network, no randomness.
 */

export type ShieldReasonCode =
  /** No completed outgoing transfer to this account before now. */
  | "first_payment"
  /** Recipient is neither a friend nor a favourite. */
  | "not_in_circle"
  /** This payment uses a large share of the money you can send. */
  | "large_amount"
  /** Several payments to the same person within the repeat window. */
  | "rapid_repeat"
  /** Incoming request from someone you've never interacted with. */
  | "unknown_requester"
  /** The requester's TeenPay ID changed after they made the request. */
  | "requester_identity_updated";

/**
 * `notice` — shown inline where the action happens; nothing to press.
 * `confirm` — one extra calm step naming what to check before review.
 * There is deliberately no `block`: only existing product rules
 * (authorization, limits, balance, freezes) ever stop an action.
 */
export type ShieldLevel = "notice" | "confirm";

/**
 * One stored reminder set per account (Phase 14). Additive and
 * optional — absent means the defaults (everything on). Convenience
 * preferences only; they can never relax a required protection.
 */
export interface ShieldSettingsRecord {
  ownerAccountId: string;
  firstTimeRecipient: boolean;
  largePayments: boolean;
  repeatedPayments: boolean;
  /** ISO 8601 timestamp of the last change. */
  updatedAt: string;
}

export interface ShieldReason {
  code: ShieldReasonCode;
  level: ShieldLevel;
  /** User-safe, one line. */
  title: string;
  /** User-safe explanation — concrete, calm, no labels. */
  explanation: string;
}

export type ShieldOutcome = "allow" | "notice" | "confirm";

export interface ShieldAssessment {
  outcome: ShieldOutcome;
  reasons: ShieldReason[];
}

/**
 * Optional reminders the teen can switch off. They only soften
 * `confirm` steps into inline notices — they can never touch the
 * required protections (guardian rules, limits, balance, freezes,
 * authorization), which aren't shield settings at all.
 */
export interface ShieldSettings {
  firstTimeRecipient: boolean;
  largePayments: boolean;
  repeatedPayments: boolean;
}

export const DEFAULT_SHIELD_SETTINGS: ShieldSettings = {
  firstTimeRecipient: true,
  largePayments: true,
  repeatedPayments: true,
};

/**
 * The repeat window and count are fixed product constants — never
 * tuned per user, never randomized. Three or more payments to the
 * same person within 24 hours earns a calm review prompt.
 */
export const SHIELD_REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
export const SHIELD_REPEAT_THRESHOLD = 2;

/**
 * A payment is "large" when it uses this share or more of the money
 * available to send. Derived from the teen's own balance — no
 * invented absolute number.
 */
export const SHIELD_LARGE_SHARE = 2; // amount × 2 ≥ available

// ── Reason builders (pure, deterministic) ─────────────────────────

export function firstPaymentReason(handle: string): ShieldReason {
  return {
    code: "first_payment",
    level: "confirm",
    title: `First payment to ${handle}`,
    explanation:
      "You haven't sent money to this person before. Check the TeenPay ID, the name and the amount.",
  };
}

export function notInCircleReason(handle: string): ShieldReason {
  return {
    code: "not_in_circle",
    level: "notice",
    title: `${handle} isn't in your Friend Circle`,
    explanation: "You can still send — or add them as a friend first if you know them.",
  };
}

export function largeAmountReason(handle: string): ShieldReason {
  return {
    code: "large_amount",
    level: "confirm",
    title: "A large part of your money",
    explanation: `This payment uses half or more of the money you can send to ${handle}.`,
  };
}

export function rapidRepeatReason(handle: string, recentCount: number): ShieldReason {
  return {
    code: "rapid_repeat",
    level: "confirm",
    title: "Several payments in a short time",
    explanation: `You've sent ${recentCount} payments to ${handle} in the last 24 hours. Take a moment to review.`,
  };
}

export function unknownRequesterReason(handle: string): ShieldReason {
  return {
    code: "unknown_requester",
    level: "notice",
    title: `A request from ${handle}`,
    explanation: "You don't need to accept requests from people you don't know. Decline or leave it pending.",
  };
}

export function requesterIdentityUpdatedReason(oldHandle: string, newHandle: string): ShieldReason {
  return {
    code: "requester_identity_updated",
    level: "notice",
    title: `${newHandle} used to be ${oldHandle}`,
    explanation: "This request was made under their previous TeenPay ID. It's the same account.",
  };
}

/**
 * Applies the teen's optional reminders: a switched-off reminder
 * downgrades its `confirm` step to an inline `notice`. Nothing is
 * ever hidden silently, and nothing required is affected.
 */
export function applyShieldSettings(
  reasons: ShieldReason[],
  settings: ShieldSettings,
): ShieldAssessment {
  const adjusted = reasons.map((reason) => {
    if (reason.level !== "confirm") return reason;
    const off =
      (reason.code === "first_payment" && !settings.firstTimeRecipient) ||
      (reason.code === "large_amount" && !settings.largePayments) ||
      (reason.code === "rapid_repeat" && !settings.repeatedPayments);
    return off ? { ...reason, level: "notice" as ShieldLevel } : reason;
  });
  const outcome: ShieldOutcome =
    adjusted.length === 0
      ? "allow"
      : adjusted.some((reason) => reason.level === "confirm")
        ? "confirm"
        : "notice";
  return { outcome, reasons: adjusted };
}
