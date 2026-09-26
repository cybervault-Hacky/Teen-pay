/**
 * Safety domain (conceptual in Phase 1).
 *
 * Guardrails are a first-class product surface, not an afterthought:
 * spending limits, merchant categories, and parent approvals. Teens see
 * their own limits transparently; parents manage them. Copy must always
 * feel empowering ("your plan") rather than controlling ("restrictions").
 */

import type { MinorUnits } from "./wallet";

export type LimitPeriod = "daily" | "weekly" | "monthly";

/** A cap on teen spending over a rolling period. */
export interface SpendingLimit {
  id: string;
  period: LimitPeriod;
  maxPaise: MinorUnits;
  /** Spent in the current period (derived server-side later). */
  spentPaise: MinorUnits;
  /** Who set it — shown honestly in the UI. */
  setBy: "parent" | "teen" | "default";
}

/** When a payment needs a parent's approval before executing. */
export interface ApprovalRule {
  id: string;
  /** Payments at/above this amount need approval. */
  abovePaise: MinorUnits;
  /** Categories that always need approval regardless of amount. */
  alwaysApproveCategories: string[];
  enabled: boolean;
}

export interface SafetySettings {
  teenId: string;
  limits: SpendingLimit[];
  approvalRule: ApprovalRule;
  /** Categories the family agreed are off-limits. */
  blockedCategories: string[];
  updatedAt: string;
  updatedBy: "parent" | "teen";
}
