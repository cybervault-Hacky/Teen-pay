import type {
  ApprovalRequest,
  DomainEvent,
  MoneyRequest,
  User,
  Wallet,
  WalletStatus,
} from "@/domain";
import { amountError } from "./engine";
import { commitEvents } from "./events";
import {
  findWallet,
  paymentDraft,
  postOperation,
  primaryWalletOf,
  refundableAmount,
  refundDraft,
  settlementDraft,
  transferDraft,
  type OperationDraft,
} from "./operations";
import type { Permission } from "@/domain";
import { authorize, authorizeApprovalDecision } from "./authorization";
import {
  findUser,
  linkedGuardian,
  primaryTeen,
} from "./identity";
import { evaluatePayment } from "./rules";
import {
  type SandboxError,
  type SandboxResult,
  type SandboxState,
} from "./types";

/**
 * Pure state transitions for sandbox money actions.
 *
 * Each transition is idempotent (safe to replay with the same ids)
 * and returns the next state plus a typed result. Side effects that
 * aren't money — notifications, the family log — are produced by
 * committing domain events, never written ad hoc.
 *
 * Money has exactly one write path: every transition that moves
 * money builds an operation draft and posts it with `postOperation`
 * (atomic, idempotent, audited — see `operations.ts`). Payments go
 * through `executePayment`, used by both direct payments and
 * guardian-approved ones, so there is no second payment engine.
 *
 *   authorize → validate money → rules → approval decision
 *     → post operation (ledger) → balance (derived) → events
 *     → notifications
 */

export interface TransitionOutput<T = undefined> {
  state: SandboxState;
  result: SandboxResult<T>;
}

export function fail<T = undefined>(
  state: SandboxState,
  error: SandboxError,
): TransitionOutput<T> {
  return { state, result: { ok: false, error } };
}

export function ok(state: SandboxState): TransitionOutput;
export function ok<T>(state: SandboxState, value: T): TransitionOutput<T>;
export function ok<T>(state: SandboxState, value?: T): TransitionOutput<T | undefined> {
  return { state, result: { ok: true, value } };
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Common input for every action: who did it, and when. */
export interface ActionContext {
  /** Defaults to the current sandbox session user. */
  actorId?: string;
  /** Defaults to now. Explicit in tests for deterministic "today". */
  at?: string;
}

export function resolveContext(
  state: SandboxState,
  input: ActionContext,
): { actorId: string; at: string } {
  return {
    actorId: input.actorId ?? state.session.currentUserId,
    at: input.at ?? nowIso(),
  };
}

/**
 * The actor must be the teen whose wallet this view holds, with a
 * teen permission for the action. Decided by `authorize`.
 */
export function requireWalletTeen(
  state: SandboxState,
  actorId: string,
  permission: Permission = "payments.initiate",
): User | SandboxError {
  const error = authorize(state, actorId, permission);
  if (error) return error;
  return primaryTeen(state);
}

export function isError(value: unknown): value is SandboxError {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    "message" in value
  );
}

/**
 * Posts an operation into a scoped state. The state is unchanged on
 * failure; `replayed` is true when the operation already existed.
 */
export function post(
  state: SandboxState,
  draft: OperationDraft,
): { ok: true; state: SandboxState; replayed: boolean; reference: string } | { ok: false; error: SandboxError } {
  const result = postOperation(state, draft);
  if (!result.ok) return result;
  return {
    ok: true,
    state: result.journal,
    replayed: result.replayed,
    reference: result.operation.reference,
  };
}

/** A teen's primary wallet in this view, or an error. */
export function teenWallet(state: SandboxState, teenId: string): Wallet | SandboxError {
  return (
    primaryWalletOf(state.wallets, teenId) ?? {
      code: "unknown_wallet",
      message: "This wallet isn't available.",
    }
  );
}

// ── Pay ──────────────────────────────────────────────────────────

export interface PayInput extends ActionContext {
  /** Idempotency key generated once when the user reaches review. */
  entryId: string;
  recipientId: string;
  amount: number;
  note?: string;
}

export type PayOutcome =
  | { status: "completed"; entryId: string }
  | { status: "approval_requested"; approvalId: string };

const DUPLICATE_PAYMENT: SandboxError = {
  code: "duplicate",
  message: "This payment was already submitted with different details. Nothing was changed.",
};

/** Approval ids derive from the payment's idempotency key. */
export function approvalIdFor(entryId: string): string {
  return `apr_${entryId}`;
}

/**
 * The single write path for a teen payment. Callers must already
 * have decided the payment may execute; `postOperation` still
 * re-validates everything money-related (amount, currency, wallet
 * status, balance) and makes the payment idempotent by its id.
 */
export function executePayment(
  state: SandboxState,
  input: {
    entryId: string;
    teenId: string;
    /** Who caused the execution (the teen, or the approving guardian). */
    actorId: string;
    recipientId: string;
    amount: number;
    note?: string;
    at: string;
    approvalId?: string;
  },
): TransitionOutput<PayOutcome> {
  const recipient = state.recipients.find((r) => r.id === input.recipientId);
  if (!recipient) {
    return fail(state, {
      code: "unknown_recipient",
      message: "That recipient is no longer available.",
    });
  }
  const wallet = teenWallet(state, input.teenId);
  if (isError(wallet)) return fail(state, wallet);
  const note = input.note?.trim() || undefined;

  const posted = post(
    state,
    paymentDraft({
      id: input.entryId,
      actorId: input.actorId,
      at: input.at,
      walletId: wallet.id,
      recipient,
      amount: input.amount,
      note,
      approvalId: input.approvalId,
    }),
  );
  if (!posted.ok) return fail(state, posted.error);
  const outcome: PayOutcome = { status: "completed", entryId: input.entryId };
  if (posted.replayed) return ok(state, outcome);

  const event: DomainEvent = {
    id: `evt_pay_${input.entryId}`,
    type: "payment_sent",
    actorId: input.actorId,
    at: input.at,
    entryId: input.entryId,
    teenId: input.teenId,
    amount: input.amount,
    recipientName: recipient.name,
    note,
    approvalId: input.approvalId,
  };
  return ok(commitEvents(posted.state, [event]), outcome);
}

/**
 * Pay: validate → spending rules → approval rule → execute or
 * create a pending approval. Nothing moves unless it executes.
 */
export function payTransition(
  state: SandboxState,
  input: PayInput,
): TransitionOutput<PayOutcome> {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId);
  if (isError(teen)) return fail(state, teen);

  // Replays (double click, retry, refresh) are answered from the
  // record: the same payment is a no-op; the same key with different
  // details is rejected. Nothing is re-evaluated or re-posted.
  const prior = state.operations.find((op) => op.id === input.entryId);
  if (prior) {
    return prior.type === "payment" &&
      prior.amount === input.amount &&
      prior.recipientId === input.recipientId
      ? ok(state, { status: "completed", entryId: input.entryId })
      : fail(state, DUPLICATE_PAYMENT);
  }
  const existingApproval = state.approvals.find(
    (a) => a.paymentEntryId === input.entryId,
  );
  if (existingApproval) {
    return existingApproval.amount === input.amount &&
      existingApproval.recipientId === input.recipientId
      ? ok(state, { status: "approval_requested", approvalId: existingApproval.id })
      : fail(state, DUPLICATE_PAYMENT);
  }

  const decision = evaluatePayment(state, {
    teenId: teen.id,
    recipientId: input.recipientId,
    amount: input.amount,
    at,
  });

  if (decision.kind === "rejected") return fail(state, decision.error);

  if (decision.kind === "needs_approval") {
    const recipient = state.recipients.find((r) => r.id === input.recipientId);
    const note = input.note?.trim() || undefined;
    const approval: ApprovalRequest = {
      id: approvalIdFor(input.entryId),
      kind: "payment",
      teenId: teen.id,
      guardianId: decision.guardian.id,
      amount: input.amount,
      currency: "INR",
      recipientId: input.recipientId,
      recipientName: recipient?.name ?? "Recipient",
      note,
      status: "pending",
      paymentEntryId: input.entryId,
      createdAt: at,
    };
    const next: SandboxState = {
      ...state,
      approvals: [approval, ...state.approvals],
    };
    return ok(
      commitEvents(next, [
        {
          id: `evt_apr_req_${approval.id}`,
          type: "approval_requested",
          actorId,
          at,
          approval,
        },
      ]),
      { status: "approval_requested", approvalId: approval.id },
    );
  }

  return executePayment(state, {
    entryId: input.entryId,
    teenId: teen.id,
    actorId,
    recipientId: input.recipientId,
    amount: input.amount,
    note: input.note,
    at,
  });
}

// ── Approvals ────────────────────────────────────────────────────

export interface DecideApprovalInput extends ActionContext {
  approvalId: string;
  decision: "approve" | "decline";
}

function replaceApproval(
  state: SandboxState,
  approval: ApprovalRequest,
): SandboxState {
  return {
    ...state,
    approvals: state.approvals.map((a) => (a.id === approval.id ? approval : a)),
  };
}

/**
 * A guardian's decision. Idempotent: repeating the same decision is
 * a no-op, and an approval's payment can only ever post once (its
 * ledger entry id is fixed at creation).
 */
export function decideApprovalTransition(
  state: SandboxState,
  input: DecideApprovalInput,
): TransitionOutput<{ status: ApprovalRequest["status"] }> {
  const approval = state.approvals.find((a) => a.id === input.approvalId);
  if (!approval) {
    return fail(state, {
      code: "invalid_transition",
      message: "This approval request no longer exists.",
    });
  }
  const { actorId, at } = resolveContext(state, input);
  const denied = authorizeApprovalDecision(state, actorId, approval);
  if (denied) return fail(state, denied);

  const target = input.decision === "approve" ? "approved" : "declined";
  // A TeenPay transfer's recipient wallet is outside any family scope,
  // so approving one executes through the peer engine
  // (`approveTransferTransition`), never here. Declining moves nothing
  // and stays here.
  if (approval.kind === "transfer" && target === "approved" && approval.status === "pending") {
    return fail(state, {
      code: "invalid_transition",
      message: "Something went wrong, so nothing was changed. Please try again.",
    });
  }
  if (approval.status !== "pending") {
    if (approval.status === target) return ok(state, { status: target });
    return fail(state, {
      code: "invalid_transition",
      message: `This request was already ${approval.status}.`,
    });
  }

  const teenName = findUser(state, approval.teenId)?.displayName ?? "Your teen";

  if (input.decision === "decline") {
    const declined: ApprovalRequest = {
      ...approval,
      status: "declined",
      decidedAt: at,
      decidedBy: actorId,
    };
    return ok(
      commitEvents(replaceApproval(state, declined), [
        {
          id: `evt_apr_dec_${approval.id}`,
          type: "approval_declined",
          actorId,
          at,
          approval: declined,
        },
      ]),
      { status: "declined" },
    );
  }

  // Approve: re-check what can change while it waited, then execute
  // through the one payment path — exactly once (the payment's id is
  // fixed at request time, so a replay can't post twice).
  const teen = findUser(state, approval.teenId);
  if (!teen || teen.status !== "active") {
    return fail(state, {
      code: "invalid_transition",
      message: "This teen account is no longer available. Nothing was sent.",
    });
  }
  const check = evaluatePayment(
    state,
    {
      teenId: approval.teenId,
      recipientId: approval.recipientId,
      amount: approval.amount,
      at,
    },
    "approved",
  );
  if (check.kind === "rejected") {
    const message =
      check.error.code === "insufficient_balance"
        ? `${teenName}'s available balance isn't enough for this payment right now. Nothing was sent.`
        : check.error.code === "exceeds_transaction_limit"
          ? "This payment is above the per-payment limit you set. Nothing was sent."
          : check.error.code === "wallet_frozen"
            ? `${teenName}'s wallet is frozen. Unfreeze it to approve this payment. Nothing was sent.`
            : check.error.message;
    return fail(state, { code: check.error.code, message });
  }

  const executed = executePayment(state, {
    entryId: approval.paymentEntryId,
    teenId: approval.teenId,
    actorId,
    recipientId: approval.recipientId,
    amount: approval.amount,
    note: approval.note,
    at,
    approvalId: approval.id,
  });
  if (!executed.result.ok) {
    return fail(state, executed.result.error);
  }
  const approved: ApprovalRequest = {
    ...approval,
    status: "approved",
    decidedAt: at,
    decidedBy: actorId,
  };
  return ok(
    commitEvents(replaceApproval(executed.state, approved), [
      {
        id: `evt_apr_ok_${approval.id}`,
        type: "approval_approved",
        actorId,
        at,
        approval: approved,
        entryId: approval.paymentEntryId,
      },
    ]),
    { status: "approved" },
  );
}

/** The teen withdraws a pending request. Moves nothing. */
export function cancelApprovalTransition(
  state: SandboxState,
  input: ActionContext & { approvalId: string },
): TransitionOutput {
  const approval = state.approvals.find((a) => a.id === input.approvalId);
  if (!approval) {
    return fail(state, {
      code: "invalid_transition",
      message: "This approval request no longer exists.",
    });
  }
  const { actorId, at } = resolveContext(state, input);
  const denied = authorize(state, actorId, "approvals.cancel_own", {
    teenId: approval.teenId,
  });
  if (denied) return fail(state, denied);
  if (approval.status === "cancelled") return ok(state);
  if (approval.status !== "pending") {
    return fail(state, {
      code: "invalid_transition",
      message: `This request was already ${approval.status}.`,
    });
  }
  const cancelled: ApprovalRequest = {
    ...approval,
    status: "cancelled",
    decidedAt: at,
    decidedBy: actorId,
  };
  return ok(
    commitEvents(replaceApproval(state, cancelled), [
      {
        id: `evt_apr_can_${approval.id}`,
        type: "approval_cancelled",
        actorId,
        at,
        approval: cancelled,
      },
    ]),
  );
}

// ── Request ──────────────────────────────────────────────────────

export interface CreateRequestInput extends ActionContext {
  requestId: string;
  recipientId: string;
  amount: number;
  note?: string;
}

export function createRequestTransition(
  state: SandboxState,
  input: CreateRequestInput,
): TransitionOutput {
  if (state.requests.some((request) => request.id === input.requestId)) {
    return ok(state);
  }
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "requests.create");
  if (isError(teen)) return fail(state, teen);

  const recipient = state.recipients.find((r) => r.id === input.recipientId);
  if (!recipient) {
    return fail(state, {
      code: "unknown_recipient",
      message: "That person is no longer available.",
    });
  }
  const error = amountError(input.amount);
  if (error) return fail(state, error);

  const note = input.note?.trim() || undefined;
  const request: MoneyRequest = {
    id: input.requestId,
    amount: input.amount,
    currency: "INR",
    recipientId: recipient.id,
    note,
    status: "pending",
    createdAt: at,
  };

  const next: SandboxState = {
    ...state,
    requests: [request, ...state.requests],
  };
  return ok(
    commitEvents(next, [
      {
        id: `evt_req_${input.requestId}`,
        type: "request_created",
        actorId,
        at,
        requestId: request.id,
        amount: request.amount,
        recipientName: recipient.name,
        note,
      },
    ]),
  );
}

export function respondRequestTransition(
  state: SandboxState,
  input: ActionContext & { requestId: string; response: "paid" | "cancelled" },
): TransitionOutput {
  const request = state.requests.find((r) => r.id === input.requestId);
  if (!request) {
    return fail(state, {
      code: "invalid_transition",
      message: "This request no longer exists.",
    });
  }
  if (request.status !== "pending") {
    return fail(state, {
      code: "invalid_transition",
      message: "This request is already settled.",
    });
  }
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "requests.create");
  if (isError(teen)) return fail(state, teen);

  if (input.response === "cancelled") {
    return ok({
      ...state,
      requests: state.requests.map((r) =>
        r.id === request.id
          ? { ...r, status: "cancelled" as const, cancelledAt: at }
          : r,
      ),
    });
  }

  // "paid" — the one request transition that touches the ledger.
  const wallet = teenWallet(state, teen.id);
  if (isError(wallet)) return fail(state, wallet);
  const recipient = state.recipients.find((r) => r.id === request.recipientId);
  const entryId = `lgl_${request.id}`;
  const posted = post(
    state,
    settlementDraft({
      id: entryId,
      actorId,
      at,
      walletId: wallet.id,
      requestId: request.id,
      amount: request.amount,
      from: { kind: "person", id: request.recipientId, name: recipient?.name ?? "Recipient" },
      description: request.note ?? "Request settled",
    }),
  );
  if (!posted.ok) return fail(state, posted.error);

  const next: SandboxState = {
    ...posted.state,
    requests: state.requests.map((r) =>
      r.id === request.id ? { ...r, status: "paid" as const, paidAt: at } : r,
    ),
  };
  return ok(
    commitEvents(next, [
      {
        id: `evt_reqpaid_${request.id}`,
        type: "request_paid",
        actorId,
        at,
        requestId: request.id,
        entryId,
        amount: request.amount,
        recipientName: recipient?.name ?? "Someone",
      },
    ]),
  );
}

// ── Allowance (guardian action) ──────────────────────────────────

/**
 * Pocket money: one atomic transfer from the guardian's wallet to the
 * teen's. Idempotent by `operationId`.
 */
export function sendAllowanceTransition(
  state: SandboxState,
  input: ActionContext & { operationId: string; amount: number; note?: string },
): TransitionOutput {
  const { actorId, at } = resolveContext(state, input);
  const denied = authorize(state, actorId, "allowance.send");
  if (denied) return fail(state, denied);
  const teen = primaryTeen(state);
  const guardian = linkedGuardian(state, teen.id);
  if (!guardian) return fail(state, { code: "not_linked", message: "Connect with your teen first." });
  const error = amountError(input.amount);
  if (error) return fail(state, error);

  const from = primaryWalletOf(state.wallets, guardian.id);
  const to = teenWallet(state, teen.id);
  if (!from || isError(to)) {
    return fail(state, { code: "unknown_wallet", message: "This wallet isn't available." });
  }
  if (to.status !== "active") {
    return fail(state, {
      code: to.status === "frozen" ? "wallet_frozen" : "wallet_closed",
      message: `${teen.displayName}'s wallet is ${to.status}, so pocket money can't be sent right now. Nothing was sent.`,
    });
  }
  const posted = post(
    state,
    transferDraft({
      id: input.operationId,
      actorId,
      at,
      from: { walletId: from.id, accountId: guardian.id, name: guardian.displayName },
      to: { walletId: to.id, accountId: teen.id, name: teen.displayName },
      amount: input.amount,
      note: input.note?.trim() || undefined,
      purpose: "allowance",
    }),
  );
  if (!posted.ok) {
    return fail(
      state,
      posted.error.code === "insufficient_balance"
        ? {
            code: "insufficient_balance",
            message: "Your sandbox wallet doesn't have enough for this. Nothing was sent.",
          }
        : posted.error,
    );
  }
  if (posted.replayed) return ok(state);

  return ok(
    commitEvents(posted.state, [
      {
        id: `evt_allow_${input.operationId}`,
        type: "allowance_sent",
        actorId,
        at,
        entryId: `${input.operationId}-cr`,
        teenId: teen.id,
        guardianId: guardian.id,
        amount: input.amount,
      },
    ]),
  );
}

// ── Refunds (sandbox simulation) ─────────────────────────────────

/** The idempotency key for a full refund of an entry. */
export function fullRefundId(entryId: string): string {
  return `ref_${entryId}_full`;
}

/**
 * Simulates a recipient refunding a payment — a compensating credit
 * that points at the original, which stays untouched. Partial refunds
 * are allowed up to what's left; refunds never restore today's
 * spending limit. Idempotent by `operationId` (default: full refund).
 */
export function refundTransition(
  state: SandboxState,
  input: ActionContext & { entryId: string; amount?: number; operationId?: string },
): TransitionOutput<{ reference: string }> {
  const { actorId, at } = resolveContext(state, input);
  const teen = requireWalletTeen(state, actorId, "payments.simulate_refund");
  if (isError(teen)) return fail(state, teen);
  const wallet = teenWallet(state, teen.id);
  if (isError(wallet)) return fail(state, wallet);

  const operationId = input.operationId ?? fullRefundId(input.entryId);
  const prior = state.operations.find((op) => op.id === operationId);
  if (prior) {
    return prior.type === "refund"
      ? ok(state, { reference: prior.reference })
      : fail(state, { code: "duplicate", message: "This action was already recorded. Nothing was changed." });
  }

  const original = state.ledger.find(
    (e) => e.id === input.entryId && e.walletId === wallet.id,
  );
  if (!original || original.type !== "payment_sent") {
    return fail(state, { code: "not_refundable", message: "Only payments you sent can be refunded." });
  }
  const amount = input.amount ?? refundableAmount(state.ledger, original);
  if (amount <= 0) {
    return fail(state, { code: "not_refundable", message: "This payment has already been fully refunded." });
  }
  const posted = post(state, refundDraft({ id: operationId, actorId, at, original, amount }));
  if (!posted.ok) return fail(state, posted.error);

  return ok(
    commitEvents(posted.state, [
      {
        id: `evt_refund_${operationId}`,
        type: "refund_received",
        actorId,
        at,
        entryId: operationId,
        relatedEntryId: original.id,
        teenId: teen.id,
        amount,
        fromName: original.counterparty.name,
        reference: posted.reference,
      },
    ]),
    { reference: posted.reference },
  );
}

// ── Wallet status (sandbox freeze) ───────────────────────────────

/**
 * Freezes or unfreezes a wallet — a sandbox safety switch, not a card
 * or bank control. A frozen wallet can still be viewed (balance,
 * activity, history) but no money can move in or out of it.
 *
 * The teen may freeze their own wallet and undo their own freeze; a
 * linked guardian may do both for the teen. A guardian's freeze can
 * only be lifted by a guardian.
 */
export function setWalletStatusTransition(
  state: SandboxState,
  input: ActionContext & { walletId: string; status: Extract<WalletStatus, "active" | "frozen"> },
): TransitionOutput<{ status: WalletStatus }> {
  const { actorId, at } = resolveContext(state, input);
  const wallet = findWallet(state.wallets, input.walletId);
  if (!wallet) {
    return fail(state, { code: "unknown_wallet", message: "This wallet isn't available." });
  }
  const owner = findUser(state, wallet.ownerAccountId);
  if (!owner || owner.role !== "teen") {
    return fail(state, { code: "not_permitted", message: "Only teen wallets can be frozen in the sandbox." });
  }
  const denied =
    actorId === owner.id
      ? authorize(state, actorId, "wallet.freeze_own")
      : authorize(state, actorId, "wallet.manage_teen", { teenId: owner.id });
  if (denied) return fail(state, denied);

  if (wallet.status === "closed") {
    return fail(state, { code: "wallet_closed", message: "This wallet is closed." });
  }
  if (wallet.status === input.status) return ok(state, { status: wallet.status });
  if (
    input.status === "active" &&
    actorId === owner.id &&
    wallet.statusChangedBy !== undefined &&
    wallet.statusChangedBy !== owner.id
  ) {
    const by = findUser(state, wallet.statusChangedBy)?.displayName ?? "Your guardian";
    return fail(state, {
      code: "not_permitted",
      message: `${by} froze this wallet, so only they can unfreeze it.`,
    });
  }

  const updated: Wallet = {
    ...wallet,
    status: input.status,
    updatedAt: at,
    statusChangedAt: at,
    statusChangedBy: actorId,
  };
  const next: SandboxState = {
    ...state,
    wallets: state.wallets.map((w) => (w.id === wallet.id ? updated : w)),
  };
  return ok(
    commitEvents(next, [
      {
        id: `evt_wal_${input.status}_${wallet.id}_${at}`,
        type: input.status === "frozen" ? "wallet_frozen" : "wallet_unfrozen",
        actorId,
        at,
        walletId: wallet.id,
        teenId: owner.id,
      },
    ]),
    { status: input.status },
  );
}

// ── Notifications & reset ────────────────────────────────────────
/** Marks every notification for `recipientId` as read. */
export function markAllNotificationsRead(
  state: SandboxState,
  recipientId?: string,
): SandboxState {
  const applies = (n: SandboxState["notifications"][number]) =>
    !n.read && (recipientId === undefined || n.recipientId === recipientId);
  if (!state.notifications.some(applies)) return state;
  return {
    ...state,
    notifications: state.notifications.map((n) =>
      applies(n) ? { ...n, read: true } : n,
    ),
  };
}

export function markNotificationRead(
  state: SandboxState,
  id: string,
): SandboxState {
  if (!state.notifications.some((n) => n.id === id && !n.read)) return state;
  return {
    ...state,
    notifications: state.notifications.map((n) =>
      n.id === id && !n.read ? { ...n, read: true } : n,
    ),
  };
}
