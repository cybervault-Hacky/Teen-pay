import {
  DEFAULT_SHIELD_SETTINGS,
  applyShieldSettings,
  firstPaymentReason,
  formatTeenPayId,
  largeAmountReason,
  notInCircleReason,
  primaryWalletId,
  rapidRepeatReason,
  requesterIdentityUpdatedReason,
  unknownRequesterReason,
  SHIELD_LARGE_SHARE,
  SHIELD_REPEAT_THRESHOLD,
  SHIELD_REPEAT_WINDOW_MS,
  type ShieldAssessment,
  type ShieldReason,
  type ShieldSettings,
  type ShieldSettingsRecord,
} from "@/domain";
import { authorize } from "./authorization";
import { isFavourite } from "./contacts";
import { walletBalance } from "./engine";
import { relationOf } from "./friends";
import { accountByTeenPayId, isEligiblePeer, parseTeenPayId } from "./peer";
import { scopeFor } from "./scope";
import type { SandboxDatabase, SandboxError, SandboxResult } from "./types";

/**
 * The shield's transition shape — structurally the same as other
 * sandbox transitions, declared locally so this module never imports
 * payment machinery, not even as a type.
 */
interface ShieldOutput<T> {
  db: SandboxDatabase;
  result: SandboxResult<T>;
}

/**
 * Teen Safety Shield — the shield engine (Phase 14).
 *
 * Answers one question from sandbox data alone: "should this action
 * pause for a calm extra look, or show context?" It never scores
 * anyone, never labels anyone, never blocks and never writes money:
 *
 *   · read paths return pure assessments derived from the ledger,
 *     Friend Circle, favourites and requests — the same facts every
 *     other screen already uses;
 *   · the one write path stores only the teen's own optional
 *     reminders (`db.shieldSettings`) — nothing else, ever.
 *
 * Required protection is untouched and unreproducible here: guardian
 * approvals, daily limits, balance and freeze checks, authorization
 * and ledger invariants all stay in their own engines, which still
 * decide everything on confirm.
 *
 * Teen-only (`shield.use`), like Friend Circles and TeenPay ID.
 */

const ACCOUNT_UNAVAILABLE: SandboxError = {
  code: "account_unavailable",
  message: "This account isn't available. Please sign in again.",
};

/** Same refusal shape as the directory: never confirms an ineligible account exists. */
const NO_SHIELD_SUBJECT: SandboxError = {
  code: "unknown_recipient",
  message: "No TeenPay user found.",
  field: "recipient",
};

const MALFORMED: SandboxError = {
  code: "unknown_recipient",
  message: "Enter a TeenPay ID like @meera.",
  field: "recipient",
};

const REQUEST_NOT_AVAILABLE: SandboxError = {
  code: "unknown_request",
  message: "This request isn't available.",
};

function fail<T>(db: SandboxDatabase, error: SandboxError): ShieldOutput<T> {
  return { db, result: { ok: false, error } };
}

function done<T>(db: SandboxDatabase, value: T): ShieldOutput<T> {
  return { db, result: { ok: true, value } };
}

const isError = (value: unknown): value is SandboxError =>
  typeof value === "object" && value !== null && "code" in value && "message" in value;

const ALLOW: ShieldAssessment = { outcome: "allow", reasons: [] };

/** Teen-only gate — authorization lives here, never in the UI. */
function shieldScope(db: SandboxDatabase, actorId: string): { ok: true } | SandboxError {
  const scope = scopeFor(db, actorId);
  if (!scope) return ACCOUNT_UNAVAILABLE;
  const denied = authorize(scope.state, actorId, "shield.use");
  if (denied) return denied;
  return { ok: true };
}

/** The viewer's stored reminders, or the defaults (on). */
export function shieldSettingsFor(db: SandboxDatabase, accountId: string): ShieldSettings {
  const record = (db.shieldSettings ?? []).find((s) => s.ownerAccountId === accountId);
  if (!record) return { ...DEFAULT_SHIELD_SETTINGS };
  return {
    firstTimeRecipient: record.firstTimeRecipient,
    largePayments: record.largePayments,
    repeatedPayments: record.repeatedPayments,
  };
}

// ── Derived facts (existing data only) ────────────────────────────

/** Completed outgoing moves from the viewer to one account. */
function outgoingTo(db: SandboxDatabase, viewerId: string, otherId: string) {
  return db.ledger.filter(
    (e) =>
      e.accountId === viewerId &&
      e.direction === "debit" &&
      e.counterparty.kind === "account" &&
      e.counterparty.id === otherId,
  );
}

/** Any money that ever moved between the two accounts, either way. */
function interacted(db: SandboxDatabase, viewerId: string, otherId: string): boolean {
  return db.ledger.some(
    (e) =>
      (e.accountId === viewerId && e.counterparty.kind === "account" && e.counterparty.id === otherId) ||
      (e.accountId === otherId && e.counterparty.kind === "account" && e.counterparty.id === viewerId),
  );
}

/** Friend (accepted) or favourite — the two explicit "known" signals. */
function inCircle(db: SandboxDatabase, viewerId: string, otherId: string, handle: string): boolean {
  return relationOf(db, viewerId, otherId).kind === "friends" || isFavourite(db, viewerId, handle);
}

/** The money the viewer could send right now (their wallet balance). */
function sendableFor(db: SandboxDatabase, viewerId: string): number {
  return walletBalance(db.ledger, primaryWalletId(viewerId));
}

// ── Send safety ───────────────────────────────────────────────────

/**
 * Safety context for sending to one TeenPay ID. Pure read: the input
 * database comes back untouched. Context only — the payment engine
 * still decides everything (authorization, guardian rules, limits,
 * balance, idempotency) when the teen confirms.
 */
export function assessSendSafety(
  db: SandboxDatabase,
  viewerId: string,
  rawRecipient: unknown,
  amount: number,
  at: string,
): SandboxResult<ShieldAssessment> {
  const gate = shieldScope(db, viewerId);
  if (isError(gate)) return { ok: false, error: gate };

  const username = parseTeenPayId(rawRecipient);
  if (!username) return { ok: false, error: MALFORMED };
  const account = accountByTeenPayId(db, username);
  if (account?.id === viewerId) return { ok: true, value: ALLOW };
  if (!isEligiblePeer(db, account)) return { ok: false, error: NO_SHIELD_SUBJECT };

  const handle = formatTeenPayId(username);
  const settings = shieldSettingsFor(db, viewerId);
  const prior = outgoingTo(db, viewerId, account.id);
  const reasons: ShieldReason[] = [];

  // First payment to this person.
  if (prior.length === 0) {
    reasons.push(firstPaymentReason(handle));
  }

  // Not a friend, not a favourite, and no previous payments between you.
  if (!inCircle(db, viewerId, account.id, username) && !interacted(db, viewerId, account.id)) {
    reasons.push(notInCircleReason(handle));
  }

  // A large share of the money available to send.
  const sendable = sendableFor(db, viewerId);
  if (amount > 0 && sendable > 0 && amount * SHIELD_LARGE_SHARE >= sendable) {
    reasons.push(largeAmountReason(handle));
  }

  // Several payments to the same person inside the fixed window.
  const windowStart = new Date(at).getTime() - SHIELD_REPEAT_WINDOW_MS;
  const recent = prior.filter((e) => new Date(e.createdAt).getTime() >= windowStart);
  if (recent.length >= SHIELD_REPEAT_THRESHOLD) {
    reasons.push(rapidRepeatReason(handle, recent.length));
  }

  return { ok: true, value: applyShieldSettings(reasons, settings) };
}

// ── Incoming request safety ───────────────────────────────────────

/**
 * Safety context for one money request the viewer was asked to pay.
 * Calm notices only — nothing here can pay, decline or move it.
 */
export function assessRequestSafety(
  db: SandboxDatabase,
  viewerId: string,
  requestId: string,
): SandboxResult<ShieldAssessment> {
  const gate = shieldScope(db, viewerId);
  if (isError(gate)) return { ok: false, error: gate };

  const request = db.peerRequests.find((r) => r.requestId === requestId);
  if (!request || request.payerAccountId !== viewerId) {
    return { ok: false, error: REQUEST_NOT_AVAILABLE };
  }

  const requester = db.accounts.find((a) => a.id === request.requesterAccountId);
  if (!requester) return { ok: true, value: ALLOW };

  const settings = shieldSettingsFor(db, viewerId);
  const username = requester.username;
  const reasons: ShieldReason[] = [];

  // Any earlier request between this pair, either way — but never the
  // request being assessed, so a first request still gets its notice.
  const hasPriorRequests = db.peerRequests.some(
    (r) =>
      r.requestId !== requestId &&
      ((r.requesterAccountId === viewerId && r.payerAccountId === request.requesterAccountId) ||
        (r.requesterAccountId === request.requesterAccountId && r.payerAccountId === viewerId)),
  );
  if (
    !inCircle(db, viewerId, request.requesterAccountId, username) &&
    !interacted(db, viewerId, request.requesterAccountId) &&
    !hasPriorRequests
  ) {
    reasons.push(unknownRequesterReason(request.requesterHandle));
  }

  // Historical snapshot vs current identity — same account, renamed.
  if (request.requesterHandle !== `@${username}`) {
    reasons.push(requesterIdentityUpdatedReason(request.requesterHandle, `@${username}`));
  }

  return { ok: true, value: applyShieldSettings(reasons, settings) };
}

// ── Creating a request: light context only ────────────────────────

/**
 * Safety context when asking someone for money: a quiet notice when
 * the person isn't in the viewer's circle and nothing connects you
 * yet. The request lifecycle itself is unchanged.
 */
export function assessRequestCreateSafety(
  db: SandboxDatabase,
  viewerId: string,
  rawPayer: unknown,
): SandboxResult<ShieldAssessment> {
  const gate = shieldScope(db, viewerId);
  if (isError(gate)) return { ok: false, error: gate };

  const username = parseTeenPayId(rawPayer);
  if (!username) return { ok: false, error: MALFORMED };
  const account = accountByTeenPayId(db, username);
  if (account?.id === viewerId) return { ok: true, value: ALLOW };
  if (!isEligiblePeer(db, account)) return { ok: false, error: NO_SHIELD_SUBJECT };

  const settings = shieldSettingsFor(db, viewerId);
  if (inCircle(db, viewerId, account.id, username) || interacted(db, viewerId, account.id)) {
    return { ok: true, value: applyShieldSettings([], settings) };
  }
  return {
    ok: true,
    value: applyShieldSettings([notInCircleReason(formatTeenPayId(username))], settings),
  };
}

// ── The one write path: the teen's own optional reminders ─────────

export interface UpdateShieldSettingsInput {
  actorId: string;
  at: string;
  patch: Partial<ShieldSettings>;
}

/** Stored timestamps never go backwards, even if the device clock does. */
function laterAt(at: string, previous: string): string {
  return at > previous ? at : previous;
}

/**
 * Updates the actor's own optional reminders. Writes only
 * `db.shieldSettings` — never accounts, money, friends or history.
 * These reminders soften confirm steps into notices; they cannot
 * touch any required protection.
 */
export function updateShieldSettingsTransition(
  db: SandboxDatabase,
  input: UpdateShieldSettingsInput,
): ShieldOutput<{ settings: ShieldSettings }> {
  const gate = shieldScope(db, input.actorId);
  if (isError(gate)) return fail(db, gate);

  const patch = input.patch;
  for (const value of Object.values(patch)) {
    if (typeof value !== "boolean") {
      return fail(db, { code: "invalid_transition", message: "Safety settings are on or off." });
    }
  }

  const existing = (db.shieldSettings ?? []).find((s) => s.ownerAccountId === input.actorId);
  const current = existing ? shieldSettingsFor(db, input.actorId) : { ...DEFAULT_SHIELD_SETTINGS };
  const next: ShieldSettings = {
    firstTimeRecipient: patch.firstTimeRecipient ?? current.firstTimeRecipient,
    largePayments: patch.largePayments ?? current.largePayments,
    repeatedPayments: patch.repeatedPayments ?? current.repeatedPayments,
  };
  const record: ShieldSettingsRecord = {
    ownerAccountId: input.actorId,
    ...next,
    updatedAt: existing ? laterAt(input.at, existing.updatedAt) : input.at,
  };
  const others = (db.shieldSettings ?? []).filter((s) => s.ownerAccountId !== input.actorId);
  return done({ ...db, shieldSettings: [...others, record] }, { settings: next });
}
