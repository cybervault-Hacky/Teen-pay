import {
  effectivePeerRequestStatus,
  formatUsername,
  PEER_NOTE_MAX,
  peerRequestExpiresAt,
  SANDBOX_CURRENCY,
  type ApprovalRequest,
  type AppNotification,
  type DomainEvent,
  type PeerProfile,
  type PeerRequest,
  type User,
  type Wallet,
} from "@/domain";
import { amountError } from "./engine";
import { authorize, authorizeApprovalDecision } from "./authorization";
import { commitEvents, notificationsForEvent } from "./events";
import { postOperation, primaryWalletOf, transferDraft, type Journal } from "./operations";
import { isEligiblePeer, resolvePeer } from "./peer";
import { evaluateTransfer, notEnoughAvailable } from "./rules";
import { findAccount, mergeScope, scopeFor, type Scope } from "./scope";
import { approvalIdFor } from "./transitions";
import type { SandboxDatabase, SandboxError, SandboxResult, SandboxState } from "./types";

/**
 * The peer engine — TeenPay-to-TeenPay money (Phase 8).
 *
 * Why database-level: the two teens are usually in different families,
 * so the recipient's wallet is never in the sender's scope (and must
 * not be — scopes are family-bound). These transitions therefore take
 * the database, authorize the actor explicitly from their own scope,
 * and write through exactly two doors:
 *
 *   · money — `executePeerTransfer`, the single transfer path: it
 *     builds a journal of just the two wallets involved (all
 *     operations, for global idempotency) and posts one `transfer`
 *     operation with `postOperation`. Atomic, idempotent, audited;
 *     nothing else here writes a ledger entry.
 *   · approvals — through the sender's (or approving guardian's) own
 *     scope and `mergeScope`, like every other approval.
 *
 * Money requests (`db.peerRequests`) are written only here. Every
 * transition is pure (db in → db out) and all-or-nothing: on failure
 * the input database is returned untouched, so the store commits
 * nothing and shows no success.
 *
 * Authorization is decided here, never by the UI:
 *   send / pay a request    — the actor's own active teen wallet
 *                             (`payments.initiate`), the guardian
 *                             rules via `evaluateTransfer`
 *   create a request        — `requests.create`
 *   decline                 — the payer only
 *   cancel                  — the requester only
 *   read                    — the two parties only (see scope.ts)
 * A request the actor isn't a party to reads as "not available", so
 * guessing an id reveals nothing.
 *
 * Policies (documented in the README):
 *   · teen-only: both sides are teen accounts.
 *   · frozen or closed sender → can't send or pay. Closed recipient →
 *     not found. Frozen recipient → "can't receive money right now";
 *     nothing moves.
 *   · paying a request re-checks everything; if the money isn't there
 *     (or a rule says no) nothing moves and the request stays pending.
 *   · requests expire 7 days after creation (computed, no timer);
 *     expired requests never move money.
 *   · no refunds: an accepted request is final.
 */

export interface PeerOutput<T> {
  db: SandboxDatabase;
  result: SandboxResult<T>;
}

function fail<T>(db: SandboxDatabase, error: SandboxError): PeerOutput<T> {
  return { db, result: { ok: false, error } };
}

function done<T>(db: SandboxDatabase, value: T): PeerOutput<T> {
  return { db, result: { ok: true, value } };
}

const ACCOUNT_UNAVAILABLE: SandboxError = {
  code: "account_unavailable",
  message: "This account isn't available. Please sign in again.",
};

const REQUEST_NOT_AVAILABLE: SandboxError = {
  code: "unknown_request",
  message: "This request isn't available.",
};

const REQUEST_EXPIRED: SandboxError = {
  code: "request_expired",
  message: "This request has expired. Nothing was sent.",
};

const DUPLICATE: SandboxError = {
  code: "duplicate",
  message: "This action was already submitted with different details. Nothing was changed.",
};

const KEY_PATTERN = /^[A-Za-z0-9_-]{6,100}$/;

function badKey(key: unknown): boolean {
  return typeof key !== "string" || !KEY_PATTERN.test(key);
}

const INVALID_KEY: SandboxError = {
  code: "invalid_transition",
  message: "Something went wrong, so nothing was changed. Please try again.",
};

/** A whole-rupee amount the engine accepts (typed or not). */
function amountProblem(amount: unknown): SandboxError | null {
  if (typeof amount !== "number") {
    return { code: "invalid_amount", message: "Enter an amount above zero.", field: "amount" };
  }
  const error = amountError(amount);
  return error ? { ...error, field: "amount" } : null;
}

function cleanNote(raw: unknown): { note?: string } | SandboxError {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "string") {
    return { code: "invalid_transition", message: "That note isn't valid.", field: "note" };
  }
  const note = raw.replace(/\s+/g, " ").trim();
  if (!note) return {};
  if (note.length > PEER_NOTE_MAX) {
    return { code: "invalid_transition", message: `Keep the note to ${PEER_NOTE_MAX} characters.`, field: "note" };
  }
  // No control characters (the regex covers C0 and DEL).
  if (/[\u0000-\u001f\u007f<>]/.test(note)) {
    return { code: "invalid_transition", message: "Use letters, numbers and simple punctuation in the note.", field: "note" };
  }
  return { note };
}

function isSandboxError(value: unknown): value is SandboxError {
  return typeof value === "object" && value !== null && "code" in value && "message" in value;
}

/** The actor's own scope, authorized for `permission`. */
function actorScope(
  db: SandboxDatabase,
  actorId: string,
  permission: "payments.initiate" | "requests.create" | "money.view_own",
): Scope | SandboxError {
  const scope = scopeFor(db, actorId);
  if (!scope) return ACCOUNT_UNAVAILABLE;
  const denied = authorize(scope.state, actorId, permission);
  return denied ?? scope;
}

function cantReceive(handle: string): SandboxError {
  return {
    code: "wallet_frozen",
    message: `${handle} can't receive money right now. Nothing was sent.`,
  };
}

const SENDER_FROZEN: SandboxError = {
  code: "wallet_frozen",
  message: "Your wallet is frozen, so no money can move. Balance and history are still available.",
};

const SENDER_CLOSED: SandboxError = {
  code: "wallet_closed",
  message: "Your wallet is closed, so no money can move.",
};

// ── Notifications (projected from events, deduplicated by id) ─────

function appendNotifications(db: SandboxDatabase, fresh: AppNotification[]): SandboxDatabase {
  const known = new Set(db.notifications.map((n) => n.id));
  const added = fresh.filter((n) => !known.has(n.id));
  if (added.length === 0) return db;
  return {
    ...db,
    notifications: [...added, ...db.notifications].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  };
}

/** Projects events with the sender's scope (for their guardian settings). */
function notify(db: SandboxDatabase, senderId: string, events: DomainEvent[]): SandboxDatabase {
  const view = scopeFor(db, senderId)?.state;
  if (!view) return db;
  return appendNotifications(
    db,
    events.flatMap((event) => notificationsForEvent(view, event)),
  );
}

// ── The single transfer path ──────────────────────────────────────

interface TransferInput {
  /** Idempotency key = operation id. */
  operationId: string;
  /** Who caused it (the sender, or the approving guardian). */
  actorId: string;
  at: string;
  from: User;
  to: User;
  amount: number;
  note?: string;
  requestId?: string;
  approvalId?: string;
}

/**
 * Posts one peer transfer: `transfer_out` on the sender's wallet and
 * `transfer_in` on the recipient's, in a single `postOperation`. The
 * journal holds only those two wallets (and their Spaces, for the
 * balance rules) plus every operation, so the id can never collide
 * with any operation anywhere. `postOperation` re-validates amount,
 * currency, wallet status and the available balance.
 */
function executePeerTransfer(
  db: SandboxDatabase,
  input: TransferInput,
): { ok: true; db: SandboxDatabase; reference: string; replayed: boolean } | { ok: false; error: SandboxError } {
  const fromWallet = primaryWalletOf(db.wallets, input.from.id);
  const toWallet = primaryWalletOf(db.wallets, input.to.id);
  if (!fromWallet || !toWallet || fromWallet.id === toWallet.id) {
    return { ok: false, error: { code: "unknown_wallet", message: "This wallet isn't available." } };
  }
  const walletIds = new Set([fromWallet.id, toWallet.id]);
  const journal: Journal = {
    wallets: [fromWallet, toWallet],
    ledger: db.ledger.filter((e) => walletIds.has(e.walletId)),
    operations: db.operations,
    spaces: db.spaces.filter((s) => walletIds.has(s.walletId)),
  };
  const draft = {
    ...transferDraft({
      id: input.operationId,
      actorId: input.actorId,
      at: input.at,
      from: { walletId: fromWallet.id, accountId: input.from.id, name: input.from.name, handle: formatUsername(input.from) },
      to: { walletId: toWallet.id, accountId: input.to.id, name: input.to.name, handle: formatUsername(input.to) },
      amount: input.amount,
      note: input.note ?? (input.requestId ? "Money request" : "Money sent"),
      requestId: input.requestId,
    }),
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
  };
  const posted = postOperation(journal, draft);
  if (!posted.ok) {
    const error =
      posted.error.code === "insufficient_balance"
        ? notEnoughAvailable(availableOf(db, fromWallet))
        : posted.error;
    return { ok: false, error };
  }
  if (posted.replayed) {
    return { ok: true, db, reference: posted.operation.reference, replayed: true };
  }
  const entries = posted.journal.ledger.filter((e) => e.operationId === input.operationId);
  const next: SandboxDatabase = {
    ...db,
    ledger: [...db.ledger, ...entries],
    operations: [...db.operations, posted.operation],
  };
  const event: DomainEvent = {
    id: `evt_p2p_${input.operationId}`,
    type: "peer_transfer_completed",
    actorId: input.actorId,
    at: input.at,
    operationId: input.operationId,
    reference: posted.operation.reference,
    senderId: input.from.id,
    recipientId: input.to.id,
    senderHandle: formatUsername(input.from),
    recipientHandle: formatUsername(input.to),
    amount: input.amount,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
  };
  return {
    ok: true,
    db: notify(next, input.from.id, [event]),
    reference: posted.operation.reference,
    replayed: false,
  };
}

function availableOf(db: SandboxDatabase, wallet: Wallet): number {
  let balance = 0;
  for (const e of db.ledger) {
    if (e.walletId === wallet.id) balance += e.direction === "credit" ? e.amount : -e.amount;
  }
  return balance;
}

/** Pre-checks both wallets so the message names the right side. */
function walletStateError(db: SandboxDatabase, sender: User, recipient: User): SandboxError | null {
  const from = primaryWalletOf(db.wallets, sender.id);
  if (!from) return { code: "unknown_wallet", message: "This wallet isn't available." };
  if (from.status === "frozen") return SENDER_FROZEN;
  if (from.status === "closed") return SENDER_CLOSED;
  const to = primaryWalletOf(db.wallets, recipient.id);
  if (!to || to.status === "closed" || !isEligiblePeer(db, recipient)) {
    return { code: "unknown_recipient", message: "No TeenPay user found." };
  }
  if (to.status !== "active") return cantReceive(formatUsername(recipient));
  return null;
}

// ── Approvals (the existing flow, kind "transfer") ────────────────

/** Creates a pending transfer approval through the sender's own scope. */
function requestApproval(
  db: SandboxDatabase,
  scope: Scope,
  approval: ApprovalRequest,
): SandboxDatabase {
  const next = commitEvents(
    { ...scope.state, approvals: [approval, ...scope.state.approvals] },
    [{ id: `evt_apr_req_${approval.id}`, type: "approval_requested", actorId: approval.teenId, at: approval.createdAt, approval }],
  );
  return mergeScope(db, scope.info, scope.state, next);
}

/**
 * Closes the payer's pending approvals for a request that left
 * `pending` (declined, cancelled, expired). A system cancellation with
 * a reason: nothing moved, so no one is told twice.
 */
function closeRequestApprovals(
  db: SandboxDatabase,
  request: PeerRequest,
  actorId: string,
  at: string,
  reason: string,
): SandboxDatabase {
  const scope = scopeFor(db, request.payerAccountId);
  if (!scope) return db;
  const open = scope.state.approvals.filter(
    (a) => a.requestId === request.requestId && a.status === "pending",
  );
  if (open.length === 0) return db;
  const closed = open.map((a): ApprovalRequest => ({
    ...a,
    status: "cancelled",
    decidedAt: at,
    decidedBy: actorId,
    cancelReason: reason,
  }));
  const byId = new Map(closed.map((a) => [a.id, a]));
  const next = commitEvents(
    { ...scope.state, approvals: scope.state.approvals.map((a) => byId.get(a.id) ?? a) },
    closed.map((approval) => ({
      id: `evt_apr_can_${approval.id}`,
      type: "approval_cancelled" as const,
      actorId,
      at,
      approval,
    })),
  );
  return mergeScope(db, scope.info, scope.state, next);
}

// ── Send ──────────────────────────────────────────────────────────

export interface SendMoneyInput {
  actorId: string;
  at: string;
  /** What the person picked or typed: "@meera", "meera", "sandbox:meera". */
  recipient: string;
  amount: number;
  note?: string;
  /** Generated once per user action (when the review step opens). */
  idempotencyKey: string;
}

export type SendMoneyOutcome =
  | {
      status: "completed";
      reference: string;
      amount: number;
      recipient: PeerProfile;
      completedAt: string;
      /** True when this answered a repeat of an earlier submit. */
      replayed: boolean;
    }
  | {
      status: "approval_requested";
      approvalId: string;
      amount: number;
      recipient: PeerProfile;
      guardianName: string;
    };

export function sendMoneyTransition(
  db: SandboxDatabase,
  input: SendMoneyInput,
): PeerOutput<SendMoneyOutcome> {
  if (badKey(input.idempotencyKey)) return fail(db, INVALID_KEY);
  const scope = actorScope(db, input.actorId, "payments.initiate");
  if (isSandboxError(scope)) return fail(db, scope);
  const sender = findAccount(db, input.actorId)!;

  // Replays (double click, retry, refresh, stale screen) are answered
  // from the record: same key + same details → the original result;
  // same key + anything different → rejected. Nothing re-posts.
  const prior = db.operations.find((op) => op.id === input.idempotencyKey);
  const priorApproval = scope.state.approvals.find((a) => a.paymentEntryId === input.idempotencyKey);
  if (prior || priorApproval) {
    const target = resolvePeer(db, input.recipient, input.actorId);
    const senderWallet = primaryWalletOf(db.wallets, sender.id);
    if (prior) {
      const debit = prior.legs.find((l) => l.direction === "debit");
      const credit = prior.legs.find((l) => l.direction === "credit");
      const same =
        target.ok &&
        prior.type === "transfer" &&
        !prior.requestId &&
        prior.amount === input.amount &&
        debit?.walletId === senderWallet?.id &&
        credit?.walletId === target.wallet.id;
      return same
        ? done(db, {
            status: "completed",
            reference: prior.reference,
            amount: prior.amount,
            recipient: target.profile,
            completedAt: prior.createdAt,
            replayed: true,
          })
        : fail(db, DUPLICATE);
    }
    const same =
      target.ok &&
      priorApproval!.kind === "transfer" &&
      !priorApproval!.requestId &&
      priorApproval!.amount === input.amount &&
      priorApproval!.recipientId === target.account.id;
    return same
      ? done(db, {
          status: "approval_requested",
          approvalId: priorApproval!.id,
          amount: priorApproval!.amount,
          recipient: target.profile,
          guardianName: findAccount(db, priorApproval!.guardianId)?.displayName ?? "Your parent",
        })
      : fail(db, DUPLICATE);
  }

  const bad = amountProblem(input.amount);
  if (bad) return fail(db, bad);
  const note = cleanNote(input.note);
  if (isSandboxError(note)) return fail(db, note);
  const target = resolvePeer(db, input.recipient, input.actorId);
  if (!target.ok) return fail(db, target.error);
  const walletProblem = walletStateError(db, sender, target.account);
  if (walletProblem) return fail(db, walletProblem);

  const decision = evaluateTransfer(scope.state, {
    teenId: sender.id,
    amount: input.amount,
    at: input.at,
  });
  if (decision.kind === "rejected") return fail(db, { ...decision.error, field: "amount" });

  if (decision.kind === "needs_approval") {
    const approval: ApprovalRequest = {
      id: approvalIdFor(input.idempotencyKey),
      kind: "transfer",
      teenId: sender.id,
      guardianId: decision.guardian.id,
      amount: input.amount,
      currency: SANDBOX_CURRENCY,
      recipientId: target.account.id,
      recipientName: target.profile.handle,
      ...note,
      status: "pending",
      paymentEntryId: input.idempotencyKey,
      createdAt: input.at,
    };
    return done(requestApproval(db, scope, approval), {
      status: "approval_requested",
      approvalId: approval.id,
      amount: input.amount,
      recipient: target.profile,
      guardianName: decision.guardian.displayName,
    });
  }

  const posted = executePeerTransfer(db, {
    operationId: input.idempotencyKey,
    actorId: sender.id,
    at: input.at,
    from: sender,
    to: target.account,
    amount: input.amount,
    ...note,
  });
  if (!posted.ok) return fail(db, posted.error);
  return done(posted.db, {
    status: "completed",
    reference: posted.reference,
    amount: input.amount,
    recipient: target.profile,
    completedAt: input.at,
    replayed: posted.replayed,
  });
}

// ── Requests ──────────────────────────────────────────────────────

export interface CreateMoneyRequestInput {
  actorId: string;
  at: string;
  /** The person asked to pay, by TeenPay ID. */
  payer: string;
  amount: number;
  note?: string;
  idempotencyKey: string;
}

export interface MoneyRequestOutcome {
  requestId: string;
  amount: number;
  payer: PeerProfile;
  expiresAt: string;
  replayed: boolean;
}

export function requestIdFor(idempotencyKey: string): string {
  return `prq_${idempotencyKey}`;
}

/** The transfer id that pays a request — fixed, so it can post once. */
export function requestPaymentId(requestId: string): string {
  return `p2p_${requestId}`;
}

export function createMoneyRequestTransition(
  db: SandboxDatabase,
  input: CreateMoneyRequestInput,
): PeerOutput<MoneyRequestOutcome> {
  if (badKey(input.idempotencyKey)) return fail(db, INVALID_KEY);
  const scope = actorScope(db, input.actorId, "requests.create");
  if (isSandboxError(scope)) return fail(db, scope);
  const requester = findAccount(db, input.actorId)!;
  const note = cleanNote(input.note);

  const existing = db.peerRequests.find((r) => r.idempotencyKey === input.idempotencyKey);
  if (existing) {
    const target = resolvePeer(db, input.payer, input.actorId);
    const same =
      existing.requesterAccountId === requester.id &&
      target.ok &&
      existing.payerAccountId === target.account.id &&
      existing.amount === input.amount &&
      !isSandboxError(note) &&
      existing.note === note.note;
    return same
      ? done(db, {
          requestId: existing.requestId,
          amount: existing.amount,
          payer: target.profile,
          expiresAt: existing.expiresAt,
          replayed: true,
        })
      : fail(db, DUPLICATE);
  }

  const bad = amountProblem(input.amount);
  if (bad) return fail(db, bad);
  if (isSandboxError(note)) return fail(db, note);
  const target = resolvePeer(db, input.payer, input.actorId, "You can't request money from yourself.");
  if (!target.ok) return fail(db, target.error);
  const own = primaryWalletOf(db.wallets, requester.id);
  if (!own || own.status === "closed") return fail(db, SENDER_CLOSED);
  if (own.status === "frozen") {
    return fail(db, {
      code: "wallet_frozen",
      message: "Your wallet is frozen, so you can't request money right now.",
    });
  }

  const request: PeerRequest = {
    requestId: requestIdFor(input.idempotencyKey),
    requesterAccountId: requester.id,
    requesterWalletId: own.id,
    payerAccountId: target.account.id,
    payerWalletId: target.wallet.id,
    requesterHandle: formatUsername(requester),
    requesterName: requester.name,
    payerHandle: target.profile.handle,
    payerName: target.profile.name,
    amount: input.amount,
    currency: SANDBOX_CURRENCY,
    ...note,
    status: "pending",
    idempotencyKey: input.idempotencyKey,
    createdAt: input.at,
    updatedAt: input.at,
    expiresAt: peerRequestExpiresAt(input.at),
  };
  const next = notify({ ...db, peerRequests: [request, ...db.peerRequests] }, requester.id, [
    {
      id: `evt_prq_${request.requestId}`,
      type: "peer_request_created",
      actorId: requester.id,
      at: input.at,
      requestId: request.requestId,
      requesterId: requester.id,
      payerId: target.account.id,
      requesterHandle: request.requesterHandle,
      payerHandle: request.payerHandle,
      amount: request.amount,
      ...note,
    },
  ]);
  return done(next, {
    requestId: request.requestId,
    amount: request.amount,
    payer: target.profile,
    expiresAt: request.expiresAt,
    replayed: false,
  });
}

function replaceRequest(db: SandboxDatabase, request: PeerRequest): SandboxDatabase {
  return {
    ...db,
    peerRequests: db.peerRequests.map((r) => (r.requestId === request.requestId ? request : r)),
  };
}

/** The request, if `actorId` is the given party to it. */
function partyRequest(
  db: SandboxDatabase,
  requestId: unknown,
  actorId: string,
  side: "payer" | "requester",
): PeerRequest | null {
  if (typeof requestId !== "string") return null;
  const request = db.peerRequests.find((r) => r.requestId === requestId);
  if (!request) return null;
  const party = side === "payer" ? request.payerAccountId : request.requesterAccountId;
  return party === actorId ? request : null;
}

export type AcceptMoneyRequestOutcome =
  | { status: "completed"; reference: string; amount: number; requester: PeerProfile; completedAt: string; replayed: boolean }
  | { status: "approval_requested"; approvalId: string; amount: number; requester: PeerProfile; guardianName: string };

function requesterProfile(request: PeerRequest): PeerProfile {
  return {
    handle: request.requesterHandle,
    name: request.requesterName,
    initials: request.requesterName
      .split(" ")
      .filter(Boolean)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase(),
  };
}

function alreadyClosed(status: PeerRequest["status"]): SandboxError {
  return { code: "invalid_transition", message: `This request was already ${status}. Nothing was sent.` };
}

/**
 * The payer pays a request. Re-validates the request (pending, not
 * expired), both accounts and wallets, the amount, the available
 * balance and the guardian rules; then one transfer moves the money
 * and the request becomes accepted with the transfer's reference — in
 * the same step. A repeat (double click, stale screen) returns the
 * original reference. Not enough available money → nothing moves and
 * the request stays pending.
 */
export function acceptMoneyRequestTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string; requestId: string },
): PeerOutput<AcceptMoneyRequestOutcome> {
  const request = partyRequest(db, input.requestId, input.actorId, "payer");
  if (!request) return fail(db, REQUEST_NOT_AVAILABLE);
  const scope = actorScope(db, input.actorId, "payments.initiate");
  if (isSandboxError(scope)) return fail(db, scope);
  const payer = findAccount(db, input.actorId)!;
  const profile = requesterProfile(request);

  if (request.status === "accepted" && request.resultingPaymentReference) {
    return done(db, {
      status: "completed",
      reference: request.resultingPaymentReference,
      amount: request.amount,
      requester: profile,
      completedAt: request.respondedAt ?? request.updatedAt,
      replayed: true,
    });
  }
  const status = effectivePeerRequestStatus(request, input.at);
  if (status === "expired") return fail(db, REQUEST_EXPIRED);
  if (status !== "pending") return fail(db, alreadyClosed(status));

  const paymentId = requestPaymentId(request.requestId);
  const approvals = scope.state.approvals.filter((a) => a.paymentEntryId === paymentId);
  const waiting = approvals.find((a) => a.status === "pending");
  if (waiting) {
    return done(db, {
      status: "approval_requested",
      approvalId: waiting.id,
      amount: request.amount,
      requester: profile,
      guardianName: findAccount(db, waiting.guardianId)?.displayName ?? "Your parent",
    });
  }
  const latest = [...approvals].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (latest?.status === "declined") {
    return fail(db, {
      code: "not_permitted",
      message: `${findAccount(db, latest.guardianId)?.displayName ?? "Your parent"} didn't approve paying this request. Nothing was sent.`,
    });
  }

  const requester = findAccount(db, request.requesterAccountId);
  if (!requester || !isEligiblePeer(db, requester)) {
    return fail(db, { code: "unknown_recipient", message: "This request can't be paid any more. Nothing was sent." });
  }
  const walletProblem = walletStateError(db, payer, requester);
  if (walletProblem) return fail(db, walletProblem);
  const bad = amountProblem(request.amount);
  if (bad) return fail(db, bad);

  const decision = evaluateTransfer(scope.state, { teenId: payer.id, amount: request.amount, at: input.at });
  if (decision.kind === "rejected") return fail(db, decision.error);

  if (decision.kind === "needs_approval") {
    const approval: ApprovalRequest = {
      id: `${approvalIdFor(paymentId)}${approvals.length > 0 ? `_${approvals.length + 1}` : ""}`,
      kind: "transfer",
      teenId: payer.id,
      guardianId: decision.guardian.id,
      amount: request.amount,
      currency: SANDBOX_CURRENCY,
      recipientId: requester.id,
      recipientName: request.requesterHandle,
      ...(request.note ? { note: request.note } : {}),
      requestId: request.requestId,
      status: "pending",
      paymentEntryId: paymentId,
      createdAt: input.at,
    };
    return done(requestApproval(db, scope, approval), {
      status: "approval_requested",
      approvalId: approval.id,
      amount: request.amount,
      requester: profile,
      guardianName: decision.guardian.displayName,
    });
  }

  return settleRequest(db, request, {
    actorId: payer.id,
    at: input.at,
    payer,
    requester,
  });
}

/** Transfer + accepted, as one result (shared by accept and approval). */
function settleRequest(
  db: SandboxDatabase,
  request: PeerRequest,
  input: { actorId: string; at: string; payer: User; requester: User; approvalId?: string },
): PeerOutput<AcceptMoneyRequestOutcome> {
  const posted = executePeerTransfer(db, {
    operationId: requestPaymentId(request.requestId),
    actorId: input.actorId,
    at: input.at,
    from: input.payer,
    to: input.requester,
    amount: request.amount,
    note: request.note,
    requestId: request.requestId,
    ...(input.approvalId ? { approvalId: input.approvalId } : {}),
  });
  if (!posted.ok) return fail(db, posted.error);
  const accepted: PeerRequest = {
    ...request,
    status: "accepted",
    updatedAt: input.at,
    respondedAt: input.at,
    resultingPaymentReference: posted.reference,
  };
  return done(replaceRequest(posted.db, accepted), {
    status: "completed",
    reference: posted.reference,
    amount: request.amount,
    requester: requesterProfile(request),
    completedAt: input.at,
    replayed: posted.replayed,
  });
}

/** The payer declines. Moves nothing; the requester is told. */
export function declineMoneyRequestTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string; requestId: string },
): PeerOutput<{ status: "declined" }> {
  const request = partyRequest(db, input.requestId, input.actorId, "payer");
  if (!request) return fail(db, REQUEST_NOT_AVAILABLE);
  const scope = actorScope(db, input.actorId, "money.view_own");
  if (isSandboxError(scope)) return fail(db, scope);
  if (request.status === "declined") return done(db, { status: "declined" });
  const status = effectivePeerRequestStatus(request, input.at);
  if (status === "expired") return fail(db, { ...REQUEST_EXPIRED, message: "This request has already expired." });
  if (status !== "pending") {
    return fail(db, { code: "invalid_transition", message: `This request was already ${status}.` });
  }
  const declined: PeerRequest = { ...request, status: "declined", updatedAt: input.at, respondedAt: input.at };
  let next = replaceRequest(db, declined);
  next = closeRequestApprovals(next, request, input.actorId, input.at, "Money request declined");
  next = notify(next, request.payerAccountId, [
    {
      id: `evt_prq_dec_${request.requestId}`,
      type: "peer_request_declined",
      actorId: input.actorId,
      at: input.at,
      requestId: request.requestId,
      requesterId: request.requesterAccountId,
      payerId: request.payerAccountId,
      requesterHandle: request.requesterHandle,
      payerHandle: request.payerHandle,
      amount: request.amount,
    },
  ]);
  return done(next, { status: "declined" });
}

/**
 * The requester withdraws a pending request. Moves nothing; the payer
 * is told. Accepted, declined and expired requests can't be cancelled
 * (and nothing is ever refunded here).
 */
export function cancelMoneyRequestTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string; requestId: string },
): PeerOutput<{ status: "cancelled" }> {
  const request = partyRequest(db, input.requestId, input.actorId, "requester");
  if (!request) return fail(db, REQUEST_NOT_AVAILABLE);
  const scope = actorScope(db, input.actorId, "requests.create");
  if (isSandboxError(scope)) return fail(db, scope);
  if (request.status === "cancelled") return done(db, { status: "cancelled" });
  const status = effectivePeerRequestStatus(request, input.at);
  if (status !== "pending") {
    return fail(db, {
      code: status === "expired" ? "request_expired" : "invalid_transition",
      message: `This request was already ${status}, so it can't be cancelled.`,
    });
  }
  const cancelled: PeerRequest = { ...request, status: "cancelled", updatedAt: input.at, respondedAt: input.at };
  let next = replaceRequest(db, cancelled);
  next = closeRequestApprovals(next, request, input.actorId, input.at, "Money request cancelled");
  next = notify(next, request.requesterAccountId, [
    {
      id: `evt_prq_can_${request.requestId}`,
      type: "peer_request_cancelled",
      actorId: input.actorId,
      at: input.at,
      requestId: request.requestId,
      requesterId: request.requesterAccountId,
      payerId: request.payerAccountId,
      requesterHandle: request.requesterHandle,
      payerHandle: request.payerHandle,
      amount: request.amount,
    },
  ]);
  return done(next, { status: "cancelled" });
}

/**
 * Writes down expiry for the actor's own requests whose 7 days are up
 * (they already read as expired — this only records it and closes any
 * approval waiting on them). Idempotent; moves nothing; no timer —
 * called when the Requests screen opens.
 */
export function expireMoneyRequestsTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string },
): PeerOutput<{ expired: number }> {
  const scope = scopeFor(db, input.actorId);
  if (!scope) return fail(db, ACCOUNT_UNAVAILABLE);
  const due = db.peerRequests.filter(
    (r) =>
      (r.requesterAccountId === input.actorId || r.payerAccountId === input.actorId) &&
      r.status === "pending" &&
      effectivePeerRequestStatus(r, input.at) === "expired",
  );
  if (due.length === 0) return done(db, { expired: 0 });
  let next = db;
  for (const request of due) {
    next = replaceRequest(next, {
      ...request,
      status: "expired",
      updatedAt: input.at,
      respondedAt: request.expiresAt,
    });
    next = closeRequestApprovals(next, request, input.actorId, input.at, "Money request expired");
  }
  return done(next, { expired: due.length });
}

// ── Guardian approval of a transfer ───────────────────────────────

/**
 * A guardian approves a pending transfer. Re-checks what can change
 * while it waited (teen, recipient, wallets, the request if it pays
 * one, the per-payment limit, the available balance), then executes
 * through the single transfer path with the id fixed at request time —
 * so approving twice can never move money twice.
 */
export function approveTransferTransition(
  db: SandboxDatabase,
  input: { actorId: string; at: string; approvalId: string },
): PeerOutput<{ status: ApprovalRequest["status"] }> {
  const scope = scopeFor(db, input.actorId);
  if (!scope) return fail(db, ACCOUNT_UNAVAILABLE);
  const approval = scope.state.approvals.find((a) => a.id === input.approvalId);
  if (!approval || approval.kind !== "transfer") {
    return fail(db, { code: "invalid_transition", message: "This approval request no longer exists." });
  }
  const denied = authorizeApprovalDecision(scope.state, input.actorId, approval);
  if (denied) return fail(db, denied);
  if (approval.status === "approved") return done(db, { status: "approved" });
  if (approval.status !== "pending") {
    return fail(db, { code: "invalid_transition", message: `This request was already ${approval.status}.` });
  }

  const teen = findAccount(db, approval.teenId);
  const recipient = findAccount(db, approval.recipientId);
  const teenName = teen?.displayName ?? "Your teen";
  if (!teen || teen.status !== "active") {
    return fail(db, { code: "invalid_transition", message: "This teen account is no longer available. Nothing was sent." });
  }
  if (!recipient || !isEligiblePeer(db, recipient)) {
    return fail(db, { code: "unknown_recipient", message: `${approval.recipientName} can't receive money any more. Nothing was sent.` });
  }
  const request = approval.requestId
    ? db.peerRequests.find((r) => r.requestId === approval.requestId)
    : undefined;
  if (approval.requestId) {
    if (
      !request ||
      request.payerAccountId !== teen.id ||
      request.requesterAccountId !== recipient.id ||
      request.amount !== approval.amount ||
      effectivePeerRequestStatus(request, input.at) !== "pending"
    ) {
      return fail(db, { code: "invalid_transition", message: "This money request is no longer open. Nothing was sent." });
    }
  }
  const walletProblem = walletStateError(db, teen, recipient);
  if (walletProblem) {
    return fail(db, {
      code: walletProblem.code,
      message:
        walletProblem === SENDER_FROZEN
          ? `${teenName}'s wallet is frozen. Unfreeze it to approve this payment. Nothing was sent.`
          : walletProblem.message,
    });
  }
  const check = evaluateTransfer(scope.state, { teenId: teen.id, amount: approval.amount, at: input.at }, "approved");
  if (check.kind === "rejected") {
    const message =
      check.error.code === "insufficient_balance"
        ? `${teenName}'s available balance isn't enough for this payment right now. Nothing was sent.`
        : check.error.code === "exceeds_transaction_limit"
          ? "This payment is above the per-payment limit you set. Nothing was sent."
          : check.error.message;
    return fail(db, { code: check.error.code, message });
  }

  let next: SandboxDatabase;
  if (request) {
    const settled = settleRequest(db, request, {
      actorId: input.actorId,
      at: input.at,
      payer: teen,
      requester: recipient,
      approvalId: approval.id,
    });
    if (!settled.result.ok) return fail(db, settled.result.error);
    next = settled.db;
  } else {
    const posted = executePeerTransfer(db, {
      operationId: approval.paymentEntryId,
      actorId: input.actorId,
      at: input.at,
      from: teen,
      to: recipient,
      amount: approval.amount,
      note: approval.note,
      approvalId: approval.id,
    });
    if (!posted.ok) return fail(db, posted.error);
    next = posted.db;
  }

  // Record the decision through the guardian's own scope.
  const after = scopeFor(next, input.actorId);
  if (!after) return fail(db, ACCOUNT_UNAVAILABLE);
  const approved: ApprovalRequest = { ...approval, status: "approved", decidedAt: input.at, decidedBy: input.actorId };
  const state: SandboxState = commitEvents(
    { ...after.state, approvals: after.state.approvals.map((a) => (a.id === approval.id ? approved : a)) },
    [
      {
        id: `evt_apr_ok_${approval.id}`,
        type: "approval_approved",
        actorId: input.actorId,
        at: input.at,
        approval: approved,
        entryId: `${approval.paymentEntryId}-dr`,
      },
    ],
  );
  return done(mergeScope(next, after.info, after.state, state), { status: "approved" });
}

