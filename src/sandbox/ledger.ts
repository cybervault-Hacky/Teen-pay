/**
 * Local ledger engine — pure functions, no React, no storage.
 *
 * Rules enforced here (never only in the UI):
 * - amounts are validated integers within sandbox bounds
 * - balances never go negative (per-space funds checks)
 * - idempotency keys replay instead of double-posting
 * - paired legs (moves, goal funding) always post together, linked
 *
 * The engine never mutates its inputs: it returns new entries for the
 * caller to append. A future backend keeps the same operation shapes.
 */

import type {
  LedgerDirection,
  LedgerEntry,
  LedgerEntryStatus,
  LedgerReason,
  LedgerSpace,
  TransactionCategory,
  TransactionCounterparty,
} from "@/domain";
import { formatINR } from "@/lib/format";
import { validateTransferPaise } from "./amounts";
import { uid } from "./ids";

export type LedgerErrorCode = "invalid_amount" | "insufficient_funds" | "same_space";

export interface LedgerError {
  code: LedgerErrorCode;
  /** Human-readable — safe to render directly. */
  message: string;
}

/** Facts about a successful post, for notifications and follow-ups. */
export type LedgerEvent =
  | {
      type: "payment_sent";
      entryId: string;
      recipientName: string;
      handle?: string;
      amountPaise: number;
      note?: string;
    }
  | {
      type: "allowance_received";
      entryId: string;
      parentName: string;
      amountPaise: number;
      note?: string;
      requestId?: string;
    }
  | {
      type: "space_moved";
      entryIds: [string, string];
      fromSpace: LedgerSpace;
      toSpace: LedgerSpace;
      amountPaise: number;
    }
  | {
      type: "goal_funded";
      entryIds: [string, string];
      goalId: string;
      goalName: string;
      fromSpace: LedgerSpace;
      amountPaise: number;
    };

export type PostOutcome =
  | { ok: true; entries: LedgerEntry[]; replayed: boolean; events: LedgerEvent[] }
  | { ok: false; error: LedgerError };

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

/** Wallet balance = posted credits − posted debits. Pending never counts. */
export function deriveBalance(entries: readonly LedgerEntry[]): number {
  return entries
    .filter((e) => e.status === "posted")
    .reduce(
      (sum, e) => sum + (e.direction === "credit" ? e.amountPaise : -e.amountPaise),
      0,
    );
}

export function deriveSpaceBalances(
  entries: readonly LedgerEntry[],
): Record<LedgerSpace, number> {
  const balances: Record<LedgerSpace, number> = { spend: 0, save: 0, goals: 0 };
  for (const entry of entries) {
    if (entry.status !== "posted") continue;
    const delta = entry.direction === "credit" ? entry.amountPaise : -entry.amountPaise;
    balances[entry.space] += delta;
  }
  return balances;
}

export function hasIdempotencyKey(
  entries: readonly LedgerEntry[],
  key: string,
): boolean {
  return entries.some((e) => e.idempotencyKey === key);
}

/* ------------------------------------------------------------------ */
/* Operation inputs                                                    */
/* ------------------------------------------------------------------ */

interface OperationBase {
  walletId: string;
  amountPaise: number;
  idempotencyKey: string;
  /** ISO timestamp of the operation. */
  now: string;
}

export interface PaymentInput extends OperationBase {
  recipientName: string;
  recipientId: string;
  recipientKind: "parent" | "teen";
  handle?: string;
  note?: string;
}

export interface AllowanceInput extends OperationBase {
  parentName: string;
  note?: string;
  /** When this allowance pays a money request. */
  requestId?: string;
}

export interface SpaceMoveInput extends OperationBase {
  fromSpace: LedgerSpace;
  toSpace: LedgerSpace;
}

export interface GoalContributionInput extends OperationBase {
  goalId: string;
  goalName: string;
  fromSpace: LedgerSpace;
}

/* ------------------------------------------------------------------ */
/* Entry construction                                                  */
/* ------------------------------------------------------------------ */

interface EntryDraft {
  direction: LedgerDirection;
  reason: LedgerReason;
  space: LedgerSpace;
  status?: LedgerEntryStatus;
  title: string;
  counterparty: TransactionCounterparty;
  category: TransactionCategory;
  note?: string;
  idempotencyKey: string;
  counterEntryId?: string;
  groupId?: string;
  metadata?: LedgerEntry["metadata"];
}

function buildEntry(
  walletId: string,
  amountPaise: number,
  balanceAfterPaise: number,
  postedAt: string,
  draft: EntryDraft,
): LedgerEntry {
  return {
    id: uid("le"),
    walletId,
    direction: draft.direction,
    amountPaise,
    balanceAfterPaise,
    reason: draft.reason,
    space: draft.space,
    status: draft.status ?? "posted",
    idempotencyKey: draft.idempotencyKey,
    counterEntryId: draft.counterEntryId,
    groupId: draft.groupId,
    title: draft.title,
    counterparty: draft.counterparty,
    category: draft.category,
    note: draft.note,
    metadata: draft.metadata ?? {},
    postedAt,
  };
}

const SPACE_LABELS: Record<LedgerSpace, string> = {
  spend: "Spend",
  save: "Save",
  goals: "Goals",
};

function replay(): PostOutcome {
  return { ok: true, entries: [], replayed: true, events: [] };
}

function fail(code: LedgerErrorCode, message: string): PostOutcome {
  return { ok: false, error: { code, message } };
}

function checkAmount(paise: number): LedgerError | null {
  const result = validateTransferPaise(paise);
  if (!result.ok) {
    return { code: "invalid_amount", message: result.error };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Operations                                                          */
/* ------------------------------------------------------------------ */

/** Teen pays a trusted recipient from Spend. */
export function postPayment(
  entries: readonly LedgerEntry[],
  input: PaymentInput,
): PostOutcome {
  const amountError = checkAmount(input.amountPaise);
  if (amountError) return fail(amountError.code, amountError.message);
  if (hasIdempotencyKey(entries, input.idempotencyKey)) return replay();

  const spend = deriveSpaceBalances(entries).spend;
  if (spend < input.amountPaise) {
    return fail(
      "insufficient_funds",
      `Only ${formatINR(spend)} in Spend. Move money from Save first — your balance hasn't changed.`,
    );
  }

  const firstName = input.recipientName.split(" ")[0];
  const entry = buildEntry(
    input.walletId,
    input.amountPaise,
    deriveBalance(entries) - input.amountPaise,
    input.now,
    {
      direction: "debit",
      reason: "peer_transfer",
      space: "spend",
      title: `Sent to ${firstName}`,
      counterparty: { name: input.recipientName, kind: input.recipientKind },
      category: "transfer",
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      metadata: { recipientId: input.recipientId, handle: input.handle },
    },
  );

  return {
    ok: true,
    entries: [entry],
    replayed: false,
    events: [
      {
        type: "payment_sent",
        entryId: entry.id,
        recipientName: input.recipientName,
        handle: input.handle,
        amountPaise: input.amountPaise,
        note: input.note,
      },
    ],
  };
}

/** Parent sends pocket money — always lands in Spend. */
export function postAllowance(
  entries: readonly LedgerEntry[],
  input: AllowanceInput,
): PostOutcome {
  const amountError = checkAmount(input.amountPaise);
  if (amountError) return fail(amountError.code, amountError.message);
  if (hasIdempotencyKey(entries, input.idempotencyKey)) return replay();

  const entry = buildEntry(
    input.walletId,
    input.amountPaise,
    deriveBalance(entries) + input.amountPaise,
    input.now,
    {
      direction: "credit",
      reason: "allowance",
      space: "spend",
      title: "Pocket money",
      counterparty: { name: input.parentName, kind: "parent" },
      category: "family",
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      metadata: input.requestId ? { requestId: input.requestId } : {},
    },
  );

  return {
    ok: true,
    entries: [entry],
    replayed: false,
    events: [
      {
        type: "allowance_received",
        entryId: entry.id,
        parentName: input.parentName,
        amountPaise: input.amountPaise,
        note: input.note,
        requestId: input.requestId,
      },
    ],
  };
}

/** Shift money between Spaces — posts linked debit + credit legs. */
export function postSpaceMove(
  entries: readonly LedgerEntry[],
  input: SpaceMoveInput,
): PostOutcome {
  const amountError = checkAmount(input.amountPaise);
  if (amountError) return fail(amountError.code, amountError.message);
  if (hasIdempotencyKey(entries, input.idempotencyKey)) return replay();
  if (input.fromSpace === input.toSpace) {
    return fail("same_space", "Choose two different Spaces to move between.");
  }

  const fromBalance = deriveSpaceBalances(entries)[input.fromSpace];
  if (fromBalance < input.amountPaise) {
    return fail(
      "insufficient_funds",
      `Only ${formatINR(fromBalance)} in ${SPACE_LABELS[input.fromSpace]} — your balance hasn't changed.`,
    );
  }

  const groupId = uid("grp");
  const running = deriveBalance(entries);
  const title = `Moved to ${SPACE_LABELS[input.toSpace]}`;
  const debit = buildEntry(input.walletId, input.amountPaise, running - input.amountPaise, input.now, {
    direction: "debit",
    reason: "space_move",
    space: input.fromSpace,
    title,
    counterparty: { name: "Money Spaces", kind: "system" },
    category: "transfer",
    idempotencyKey: input.idempotencyKey,
    groupId,
    metadata: { fromSpace: input.fromSpace, toSpace: input.toSpace, leg: "debit" },
  });
  const credit = buildEntry(input.walletId, input.amountPaise, running, input.now, {
    direction: "credit",
    reason: "space_move",
    space: input.toSpace,
    title,
    counterparty: { name: "Money Spaces", kind: "system" },
    category: "transfer",
    idempotencyKey: input.idempotencyKey,
    groupId,
    metadata: { fromSpace: input.fromSpace, toSpace: input.toSpace, leg: "credit" },
  });
  debit.counterEntryId = credit.id;
  credit.counterEntryId = debit.id;

  return {
    ok: true,
    entries: [debit, credit],
    replayed: false,
    events: [
      {
        type: "space_moved",
        entryIds: [debit.id, credit.id],
        fromSpace: input.fromSpace,
        toSpace: input.toSpace,
        amountPaise: input.amountPaise,
      },
    ],
  };
}

/** Fund a goal from a Space — posts linked debit + Goals-credit legs. */
export function postGoalContribution(
  entries: readonly LedgerEntry[],
  input: GoalContributionInput,
): PostOutcome {
  const amountError = checkAmount(input.amountPaise);
  if (amountError) return fail(amountError.code, amountError.message);
  if (hasIdempotencyKey(entries, input.idempotencyKey)) return replay();
  if (input.fromSpace === "goals") {
    return fail("same_space", "This money is already in Goals.");
  }

  const fromBalance = deriveSpaceBalances(entries)[input.fromSpace];
  if (fromBalance < input.amountPaise) {
    return fail(
      "insufficient_funds",
      `Only ${formatINR(fromBalance)} in ${SPACE_LABELS[input.fromSpace]} — your balance hasn't changed.`,
    );
  }

  const groupId = uid("grp");
  const running = deriveBalance(entries);
  const debit = buildEntry(input.walletId, input.amountPaise, running - input.amountPaise, input.now, {
    direction: "debit",
    reason: "goal_contribution",
    space: input.fromSpace,
    title: input.goalName,
    counterparty: { name: input.goalName, kind: "system" },
    category: "goals",
    idempotencyKey: input.idempotencyKey,
    groupId,
    metadata: { goalId: input.goalId, fromSpace: input.fromSpace, toSpace: "goals", leg: "debit" },
  });
  const credit = buildEntry(input.walletId, input.amountPaise, running, input.now, {
    direction: "credit",
    reason: "goal_contribution",
    space: "goals",
    title: input.goalName,
    counterparty: { name: input.goalName, kind: "system" },
    category: "goals",
    idempotencyKey: input.idempotencyKey,
    groupId,
    metadata: { goalId: input.goalId, fromSpace: input.fromSpace, toSpace: "goals", leg: "credit" },
  });
  debit.counterEntryId = credit.id;
  credit.counterEntryId = debit.id;

  return {
    ok: true,
    entries: [debit, credit],
    replayed: false,
    events: [
      {
        type: "goal_funded",
        entryIds: [debit.id, credit.id],
        goalId: input.goalId,
        goalName: input.goalName,
        fromSpace: input.fromSpace,
        amountPaise: input.amountPaise,
      },
    ],
  };
}
