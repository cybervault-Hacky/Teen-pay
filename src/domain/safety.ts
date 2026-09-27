/**
 * Domain: guardian controls — spending limits, approval rules,
 * and guardian notification preferences. Recurring pocket money lives
 * in its own records (see `allowance.ts`).
 *
 * Controls are set by a linked guardian and are always visible to
 * the teen. There are no hidden restrictions: every rule enforced
 * by the engine is described by these types and shown in the UI.
 *
 * These are product-level rules. They are separate from the
 * technical sandbox cap (₹10,000 per move) enforced by the engine.
 */

export interface SpendingLimits {
  /**
   * Whole rupees the teen can send per calendar day (Asia/Kolkata)
   * on their own. `null` means no daily limit.
   */
  dailyLimit: number | null;
  /** Largest single payment, whole rupees. `null` means none. */
  perTransactionLimit: number | null;
}

export interface ApprovalRule {
  /**
   * Payments strictly above this many rupees need guardian
   * approval. `null` means approvals are off.
   */
  threshold: number | null;
}

/** What the guardian chooses to be notified about. */
export interface GuardianNotificationSettings {
  /** Every payment the teen sends. */
  payments: boolean;
  /** Money the teen moves into Save or a goal. */
  savings: boolean;
  /** Approval requests are always delivered — shown for transparency. */
  approvals: true;
}

/**
 * The Phase 3 pocket-money *preview* (stored inside controls up to
 * schema v5, never executed). Schema v6 migrates it into a paused
 * `PocketMoneySchedule`; the type remains only so old family-log
 * events stay readable.
 */
export interface LegacyAllowancePreview {
  amount: number;
  frequency: "weekly" | "monthly";
  weekday: number;
  dayOfMonth: number;
}

export interface GuardianControls {
  teenId: string;
  limits: SpendingLimits;
  approval: ApprovalRule;
  notifications: GuardianNotificationSettings;
  /** ISO 8601 timestamp. */
  updatedAt: string;
  /** User id of the guardian who last changed a rule. */
  updatedBy: string;
}

/** Controls that apply right after linking: nothing restricted. */
export function defaultGuardianControls(
  teenId: string,
  guardianId: string,
  at: string,
): GuardianControls {
  return {
    teenId,
    limits: { dailyLimit: null, perTransactionLimit: null },
    approval: { threshold: null },
    notifications: { payments: false, savings: true, approvals: true },
    updatedAt: at,
    updatedBy: guardianId,
  };
}

/** True when any spending rule is switched on. */
export function hasActiveSpendingRules(controls: GuardianControls): boolean {
  return (
    controls.limits.dailyLimit !== null ||
    controls.limits.perTransactionLimit !== null ||
    controls.approval.threshold !== null
  );
}
