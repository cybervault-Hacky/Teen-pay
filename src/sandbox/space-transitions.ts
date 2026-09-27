import {
  MAX_ACTIVE_SPACES,
  productDay,
  validateSpaceDraft,
  type DomainEvent,
  type MoneySpace,
  type SpaceFieldErrors,
  type SpaceIcon,
} from "@/domain";
import { formatINR } from "@/lib/currency";
import { amountError, spaceBalance, walletBalance } from "./engine";
import { commitEvents } from "./events";
import { findWallet, spaceMoveDraft } from "./operations";
import {
  fail,
  isError,
  ok,
  post,
  requireWalletTeen,
  resolveContext,
  type ActionContext,
  type TransitionOutput,
} from "./transitions";
import type { SandboxError, SandboxState } from "./types";

/**
 * Money Space transitions — pure, idempotent, authorized.
 *
 * Space *settings* (name, icon, target, date, status) are records in
 * the viewer's scope. Space *money* only moves through
 * `postOperation` (a `space` operation: a wallet leg plus the Space
 * as the other side), so the ledger stays the one source of truth and
 * every move is atomic, idempotent and referenced (SPC-XXXXXXXX).
 *
 * Authorization: `spaces.manage` for create/edit/archive and
 * `savings.move` for moving money — both teen-self permissions, so
 * only the Space's owner can act. A Space outside the viewer's scope
 * is simply "not available" (no hint that it exists).
 */

const NOT_AVAILABLE: SandboxError = {
  code: "unknown_space",
  message: "This Money Space isn't available.",
};

const DUPLICATE_SPACE: SandboxError = {
  code: "duplicate",
  message: "This space was already created with different details. Nothing was changed.",
};

/** The op id used for a Space's starting amount. */
export function startingOperationId(spaceId: string): string {
  return `${spaceId}_start`;
}

/** The viewer's own Space, or null. Scope already hides others'. */
export function ownSpace(state: SandboxState, actorId: string, spaceId: string): MoneySpace | null {
  return (
    state.spaces.find((s) => s.id === spaceId && s.ownerAccountId === actorId) ?? null
  );
}

function otherActiveNames(state: SandboxState, ownerId: string, exceptId?: string): string[] {
  return state.spaces
    .filter((s) => s.ownerAccountId === ownerId && s.status === "active" && s.id !== exceptId)
    .map((s) => s.name);
}

/** The first field problem as a typed error (the form shows all). */
export function fieldErrorToSandboxError(errors: SpaceFieldErrors): SandboxError | null {
  if (errors.name) return { code: "invalid_space", message: errors.name, field: "name" };
  if (errors.type) return { code: "invalid_space", message: errors.type, field: "type" };
  if (errors.icon) return { code: "invalid_space", message: errors.icon, field: "icon" };
  if (errors.targetAmount) {
    return { code: "invalid_target", message: errors.targetAmount, field: "targetAmount" };
  }
  if (errors.deadline) {
    return { code: "invalid_deadline", message: errors.deadline, field: "deadline" };
  }
  return null;
}

/** Makes engine money errors specific to the Space move. */
function moveError(error: SandboxError, available: number): SandboxError {
  if (error.code === "insufficient_space_balance") return { ...error, field: "amount" };
  if (error.code === "insufficient_balance") {
    return {
      code: "insufficient_balance",
      field: "amount",
      message: `You have ${formatINR(available)} available, so you can add up to that. Nothing was moved.`,
    };
  }
  if (error.code === "invalid_amount" || error.code === "exceeds_sandbox_limit") {
    return { ...error, field: "amount" };
  }
  return error;
}

/**
 * How much more a goal may take (goals stop at their target; Save and
 * custom Spaces may go past an optional target).
 */
export function addCapacity(space: MoneySpace, balance: number): number | null {
  if (space.type !== "goal" || !space.targetAmount) return null;
  return Math.max(0, space.targetAmount - balance);
}

function targetError(space: MoneySpace, balance: number, amount: number): SandboxError | null {
  const capacity = addCapacity(space, balance);
  if (capacity === null || amount <= capacity) return null;
  return {
    code: "exceeds_space_target",
    field: "amount",
    message:
      capacity === 0
        ? `${space.name} has already reached its target.`
        : `${space.name} needs ${formatINR(capacity)} more to reach its target, so you can add up to that.`,
  };
}

function reachedEvent(
  space: MoneySpace,
  before: number,
  after: number,
  base: { id: string; actorId: string; at: string },
): DomainEvent[] {
  if (space.type !== "goal" || !space.targetAmount) return [];
  if (before >= space.targetAmount || after < space.targetAmount) return [];
  return [
    {
      id: `evt_goal_reached_${base.id}`,
      type: "space_goal_reached",
      actorId: base.actorId,
      at: base.at,
      teenId: space.ownerAccountId,
      spaceId: space.id,
      spaceName: space.name,
      target: space.targetAmount,
    },
  ];
}

// ── Create ───────────────────────────────────────────────────────

export interface CreateSpaceInput extends ActionContext {
  /** Idempotency key, generated once per create intent; the Space id. */
  spaceId: string;
  name: string;
  type: "goal" | "custom";
  icon: SpaceIcon;
  targetAmount?: number | null;
  deadline?: string | null;
  /** Optional money to move in right away (from available). */
  startingAmount?: number;
}

export interface SpaceMoveResult {
  spaceId: string;
  /** SPC-XXXXXXXX, when money moved. */
  reference?: string;
  replayed: boolean;
}

export function createSpaceTransition(
  state: SandboxState,
  input: CreateSpaceInput,
): TransitionOutput<SpaceMoveResult> {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "spaces.manage");
  if (isError(teen)) return fail(state, teen);

  // Idempotency: the same create replayed returns the same Space.
  const existing = state.spaces.find((s) => s.id === input.spaceId);
  if (existing) {
    const same =
      existing.ownerAccountId === actorId &&
      existing.name === input.name.trim() &&
      existing.type === input.type;
    return same
      ? ok(state, { spaceId: existing.id, replayed: true })
      : fail(state, DUPLICATE_SPACE);
  }

  const wallet = state.wallets.find((w) => w.ownerAccountId === actorId && w.kind === "primary");
  if (!wallet) return fail(state, { code: "unknown_wallet", message: "This wallet isn't available." });

  const mine = state.spaces.filter((s) => s.ownerAccountId === actorId);
  if (mine.filter((s) => s.status === "active").length >= MAX_ACTIVE_SPACES) {
    return fail(state, {
      code: "space_limit_reached",
      message: `You can have up to ${MAX_ACTIVE_SPACES} active spaces. Archive one to make room.`,
    });
  }

  const problem = fieldErrorToSandboxError(
    validateSpaceDraft(
      {
        name: input.name,
        type: input.type,
        icon: input.icon,
        targetAmount: input.targetAmount,
        deadline: input.deadline,
      },
      { otherActiveNames: otherActiveNames(state, actorId), today: productDay(at) },
    ),
  );
  if (problem) return fail(state, problem);
  if (input.type !== "goal" && input.type !== "custom") {
    return fail(state, { code: "invalid_space", message: "Choose a goal or a space.", field: "type" });
  }

  const space: MoneySpace = {
    id: input.spaceId,
    ownerAccountId: actorId,
    walletId: wallet.id,
    name: input.name.trim(),
    type: input.type,
    icon: input.icon,
    ...(input.targetAmount ? { targetAmount: input.targetAmount } : {}),
    ...(input.type === "goal" && input.deadline ? { deadline: input.deadline } : {}),
    status: "active",
    displayOrder: mine.reduce((max, s) => Math.max(max, s.displayOrder), -1) + 1,
    createdAt: at,
    updatedAt: at,
  };
  let next: SandboxState = { ...state, spaces: [...state.spaces, space] };

  const starting = input.startingAmount ?? 0;
  if (starting === 0) return ok(next, { spaceId: space.id, replayed: false });

  const invalid = amountError(starting);
  if (invalid) return fail(state, { ...invalid, field: "amount" });
  const tooMuch = targetError(space, 0, starting);
  if (tooMuch) return fail(state, tooMuch);
  const operationId = startingOperationId(space.id);
  const posted = post(
    next,
    spaceMoveDraft({ id: operationId, actorId, at, walletId: wallet.id, space, amount: starting, direction: "add" }),
  );
  // Atomic: if the money can't move, the Space isn't created either.
  if (!posted.ok) return fail(state, moveError(posted.error, walletBalance(state.ledger, wallet.id)));
  next = commitEvents(posted.state, [
    {
      id: `evt_space_${operationId}`,
      type: "savings_moved",
      actorId,
      at,
      entryId: operationId,
      teenId: actorId,
      amount: starting,
      spaceId: space.id,
      direction: "in",
    },
    ...reachedEvent(space, 0, starting, { id: operationId, actorId, at }),
  ]);
  return ok(next, { spaceId: space.id, reference: posted.reference, replayed: false });
}

// ── Update ───────────────────────────────────────────────────────

export interface UpdateSpaceInput extends ActionContext {
  spaceId: string;
  name?: string;
  icon?: SpaceIcon;
  /** null clears an optional target (not allowed for goals). */
  targetAmount?: number | null;
  /** null clears the target date. */
  deadline?: string | null;
}

export function updateSpaceTransition(
  state: SandboxState,
  input: UpdateSpaceInput,
): TransitionOutput<{ spaceId: string }> {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "spaces.manage");
  if (isError(teen)) return fail(state, teen);
  const space = ownSpace(state, actorId, input.spaceId);
  if (!space) return fail(state, NOT_AVAILABLE);
  if (space.status === "archived") {
    return fail(state, { code: "space_archived", message: `${space.name} is archived and can't be edited.` });
  }

  const draft = {
    name: input.name ?? space.name,
    type: space.type,
    icon: input.icon ?? space.icon,
    targetAmount: input.targetAmount === undefined ? space.targetAmount : input.targetAmount,
    deadline: input.deadline === undefined ? space.deadline : input.deadline,
  };
  const problem = fieldErrorToSandboxError(
    validateSpaceDraft(draft, {
      otherActiveNames: otherActiveNames(state, actorId, space.id),
      today: productDay(at),
      currentBalance: spaceBalance(state.ledger, space.id),
      previousDeadline: space.deadline,
    }),
  );
  if (problem) return fail(state, problem);

  const updated: MoneySpace = {
    ...space,
    name: draft.name.trim(),
    icon: draft.icon,
    updatedAt: at,
  };
  delete updated.targetAmount;
  delete updated.deadline;
  if (draft.targetAmount) updated.targetAmount = draft.targetAmount;
  if (draft.deadline && space.type === "goal") updated.deadline = draft.deadline;

  const unchanged =
    updated.name === space.name &&
    updated.icon === space.icon &&
    updated.targetAmount === space.targetAmount &&
    updated.deadline === space.deadline;
  if (unchanged) return ok(state, { spaceId: space.id });
  return ok(
    { ...state, spaces: state.spaces.map((s) => (s.id === space.id ? updated : s)) },
    { spaceId: space.id },
  );
}

// ── Move money (add / move back) ─────────────────────────────────

export interface MoveSpaceMoneyInput extends ActionContext {
  /** Idempotency key, generated once per add/move-back intent. */
  operationId: string;
  spaceId: string;
  amount: number;
  direction: "add" | "withdraw";
}

export function moveSpaceMoneyTransition(
  state: SandboxState,
  input: MoveSpaceMoneyInput,
): TransitionOutput<SpaceMoveResult> {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "savings.move");
  if (isError(teen)) return fail(state, teen);
  const space = ownSpace(state, actorId, input.spaceId);
  if (!space) return fail(state, NOT_AVAILABLE);
  const wallet = findWallet(state.wallets, space.walletId);
  if (!wallet || wallet.ownerAccountId !== actorId) return fail(state, NOT_AVAILABLE);

  const draft = spaceMoveDraft({
    id: input.operationId,
    actorId,
    at,
    walletId: wallet.id,
    space,
    amount: input.amount,
    direction: input.direction,
  });

  // A replay is answered from the operation record, before any check
  // that depends on balances that the original move already changed.
  if (state.operations.some((op) => op.id === input.operationId)) {
    const replay = post(state, draft);
    if (!replay.ok) return fail(state, replay.error);
    return ok(state, { spaceId: space.id, reference: replay.reference, replayed: true });
  }

  const invalid = amountError(input.amount);
  if (invalid) return fail(state, { ...invalid, field: "amount" });
  const before = spaceBalance(state.ledger, space.id);
  if (input.direction === "add") {
    const tooMuch = space.status === "active" ? targetError(space, before, input.amount) : null;
    if (tooMuch) return fail(state, tooMuch);
  }

  const posted = post(state, draft);
  if (!posted.ok) return fail(state, moveError(posted.error, walletBalance(state.ledger, wallet.id)));

  const after = input.direction === "add" ? before + input.amount : before - input.amount;
  const next = commitEvents(posted.state, [
    {
      id: `evt_space_${input.operationId}`,
      type: "savings_moved",
      actorId,
      at,
      entryId: input.operationId,
      teenId: actorId,
      amount: input.amount,
      spaceId: space.id,
      direction: input.direction === "add" ? "in" : "out",
    },
    ...(input.direction === "add"
      ? reachedEvent(space, before, after, { id: input.operationId, actorId, at })
      : []),
  ]);
  return ok(next, { spaceId: space.id, reference: posted.reference, replayed: false });
}

// ── Archive ──────────────────────────────────────────────────────

export interface ArchiveSpaceInput extends ActionContext {
  spaceId: string;
  /** Idempotency key for moving any remaining balance back. */
  operationId: string;
}

export interface ArchiveResult {
  spaceId: string;
  /** Rupees moved back to available as part of archiving. */
  returned: number;
  reference?: string;
  replayed: boolean;
}

/**
 * Archiving never deletes or hides money: any balance is first moved
 * back to available in the same atomic step (a normal, referenced
 * `space` operation), then the Space is marked archived. Its history
 * stays in the ledger and in Activity. The default Save can't be
 * archived. On a frozen wallet a Space holding money can't be
 * archived (that would move money); an empty one can.
 */
export function archiveSpaceTransition(
  state: SandboxState,
  input: ArchiveSpaceInput,
): TransitionOutput<ArchiveResult> {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "spaces.manage");
  if (isError(teen)) return fail(state, teen);
  const space = ownSpace(state, actorId, input.spaceId);
  if (!space) return fail(state, NOT_AVAILABLE);
  if (space.status === "archived") {
    return ok(state, { spaceId: space.id, returned: 0, replayed: true });
  }
  if (space.isDefault) {
    return fail(state, {
      code: "not_permitted",
      message: `${space.name} is your default space, so it can't be archived.`,
    });
  }

  let next = state;
  const balance = spaceBalance(state.ledger, space.id);
  let reference: string | undefined;
  if (balance > 0) {
    const posted = post(
      state,
      spaceMoveDraft({
        id: input.operationId,
        actorId,
        at,
        walletId: space.walletId,
        space,
        amount: balance,
        direction: "withdraw",
      }),
    );
    if (!posted.ok) return fail(state, posted.error);
    next = posted.state;
    reference = posted.reference;
  }
  const archived: MoneySpace = { ...space, status: "archived", archivedAt: at, updatedAt: at };
  next = { ...next, spaces: next.spaces.map((s) => (s.id === space.id ? archived : s)) };
  next = commitEvents(next, [
    {
      id: `evt_space_archived_${space.id}`,
      type: "space_archived",
      actorId,
      at,
      teenId: actorId,
      spaceId: space.id,
      spaceName: space.name,
      returned: balance,
    },
  ]);
  return ok(next, { spaceId: space.id, returned: balance, reference, replayed: false });
}
