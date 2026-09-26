/**
 * Ledger projections — derive every read-model from entries.
 *
 * The UI never stores balances, space totals or goal progress: it folds
 * the ledger through these functions (memoized in the store). The same
 * projections will run against backend entries in later phases.
 */

import type {
  Currency,
  GoalBlueprint,
  LedgerEntry,
  LedgerReason,
  LedgerSpace,
  MoneyRequest,
  MoneySpace,
  SavingsGoal,
  TeenWallet,
  Transaction,
  TransactionStatus,
} from "@/domain";
import type { UserId } from "@/domain";
import { deriveBalance, deriveSpaceBalances } from "./ledger";

export const SPACE_LABELS: Record<LedgerSpace, string> = {
  spend: "Spend",
  save: "Save",
  goals: "Goals",
};

const SPACE_DESCRIPTIONS: Record<LedgerSpace, string> = {
  spend: "Everyday money — food, travel, fun.",
  save: "Set aside. Out of sight, growing.",
  goals: "Ring-fenced for things you're saving for.",
};

const REASON_LABELS: Record<LedgerReason, string> = {
  allowance: "Pocket money",
  top_up: "Top-up",
  peer_transfer: "Payment",
  merchant_payment: "Purchase",
  goal_contribution: "Goal contribution",
  goal_withdrawal: "Goal withdrawal",
  space_move: "Space transfer",
  refund: "Refund",
  fee: "Fee",
  adjustment: "Adjustment",
};

/** Human label for a ledger reason (transaction detail "Type" row). */
export function reasonLabel(reason: LedgerReason): string {
  return REASON_LABELS[reason];
}

function entryStatus(status: LedgerEntry["status"]): TransactionStatus {
  if (status === "pending") return "pending";
  if (status === "reversed") return "failed";
  return "settled";
}

/**
 * Project the Activity feed: one row per ledger event (paired credit legs
 * collapse into their debit leg) plus one row per pending request.
 * Newest-first, stable for equal timestamps.
 */
export function projectTransactions(
  entries: readonly LedgerEntry[],
  requests: readonly MoneyRequest[],
): Transaction[] {
  const rows: Transaction[] = [];

  for (const entry of entries) {
    // Paired credit legs are the same event as their debit leg — the
    // debit leg alone tells the story ("Moved to Save", goal name, …).
    if (entry.counterEntryId && entry.metadata.leg === "credit") continue;
    rows.push({
      id: entry.id,
      title: entry.title,
      counterparty: entry.counterparty,
      amountPaise: entry.amountPaise,
      direction: entry.direction === "credit" ? "in" : "out",
      category: entry.category,
      status: entryStatus(entry.status),
      occurredAt: entry.postedAt,
      note: entry.note,
      source: "ledger",
      reason: entry.reason,
    });
  }

  for (const request of requests) {
    if (request.status !== "pending") continue;
    rows.push({
      id: request.id,
      title: "Money request",
      counterparty: { name: request.targetName, kind: request.targetKind },
      amountPaise: request.amountPaise,
      direction: "in",
      category: "transfer",
      status: "pending",
      occurredAt: request.createdAt,
      note: request.note,
      source: "request",
      requestId: request.id,
    });
  }

  rows.sort((a, b) => {
    const byTime = b.occurredAt.localeCompare(a.occurredAt);
    return byTime !== 0 ? byTime : a.id.localeCompare(b.id);
  });
  return rows;
}

export interface WalletDerivationInput {
  teenId: UserId;
  currency?: Currency;
}

/** Fold entries into the wallet view, including derived Upcoming. */
export function deriveWallet(
  entries: readonly LedgerEntry[],
  requests: readonly MoneyRequest[],
  input: WalletDerivationInput,
): TeenWallet {
  const spaces = deriveSpaceBalances(entries);
  const currency = input.currency ?? "INR";

  const toMoneySpace = (type: LedgerSpace): MoneySpace => ({
    type,
    label: SPACE_LABELS[type],
    description: SPACE_DESCRIPTIONS[type],
    balancePaise: spaces[type],
    currency,
  });

  // Upcoming = everything expected but not yet posted: pending inbound
  // entries plus pending money requests.
  const pendingInbound = entries
    .filter((e) => e.status === "pending" && e.direction === "credit")
    .reduce((sum, e) => sum + e.amountPaise, 0);
  const pendingRequests = requests
    .filter((r) => r.status === "pending")
    .reduce((sum, r) => sum + r.amountPaise, 0);

  return {
    teenId: input.teenId,
    currency,
    availablePaise: deriveBalance(entries),
    spaces: {
      spend: toMoneySpace("spend"),
      save: toMoneySpace("save"),
      goals: toMoneySpace("goals"),
    },
    upcomingPaise: pendingInbound + pendingRequests,
  };
}

/** Fold goal_contribution entries into per-goal progress. */
export function deriveGoals(
  entries: readonly LedgerEntry[],
  blueprints: readonly GoalBlueprint[],
): SavingsGoal[] {
  return blueprints.map((blueprint) => {
    const savedPaise = entries
      .filter(
        (e) =>
          e.status === "posted" &&
          e.reason === "goal_contribution" &&
          e.space === "goals" &&
          e.metadata.goalId === blueprint.id,
      )
      .reduce(
        (sum, e) => sum + (e.direction === "credit" ? e.amountPaise : -e.amountPaise),
        0,
      );
    return {
      id: blueprint.id,
      teenId: blueprint.teenId,
      name: blueprint.name,
      tag: blueprint.tag,
      targetPaise: blueprint.targetPaise,
      savedPaise: Math.max(0, savedPaise),
      dueDate: blueprint.dueDate,
      createdAt: blueprint.createdAt,
    };
  });
}
