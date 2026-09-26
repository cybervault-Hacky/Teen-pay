/**
 * Savings goals domain. A goal ring-fences part of the "Goals" space
 * toward a named target (e.g. "Noise Buds — ₹2,999").
 */

import type { MinorUnits } from "./wallet";

export type GoalId = string;

/**
 * Static goal definition. `savedPaise` is NOT stored here — it is derived
 * by folding goal_contribution ledger entries (see `src/sandbox/`).
 */
export interface GoalBlueprint {
  id: GoalId;
  teenId: string;
  name: string;
  tag?: string;
  targetPaise: MinorUnits;
  dueDate?: string;
  /** ISO date the goal was created — lets the sandbox rebuild SavingsGoal. */
  createdAt: string;
}

export interface SavingsGoal {
  id: GoalId;
  teenId: string;
  name: string;
  /** Optional emoji-free short descriptor, e.g. "Audio". */
  tag?: string;
  targetPaise: MinorUnits;
  savedPaise: MinorUnits;
  /** ISO date the teen aims to reach the goal by. */
  dueDate?: string;
  createdAt: string;
  completedAt?: string;
}

export function goalProgress(goal: SavingsGoal): number {
  if (goal.targetPaise <= 0) return 0;
  return Math.min(1, Math.max(0, goal.savedPaise / goal.targetPaise));
}

export function goalRemaining(goal: SavingsGoal): MinorUnits {
  return Math.max(0, goal.targetPaise - goal.savedPaise);
}

export function isGoalComplete(goal: SavingsGoal): boolean {
  return goal.targetPaise > 0 && goal.savedPaise >= goal.targetPaise;
}
