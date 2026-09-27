import {
  INSUFFICIENT_FUNDS_MESSAGE,
  SANDBOX_CURRENCY,
  countOccurrences,
  dueInstant,
  isOpenSchedule,
  latestOccurrenceBetween,
  nextOccurrenceAfter,
  normalizeCadence,
  occurrenceDayOf,
  pocketMoneyExecutionId,
  productDay,
  upcomingOccurrence,
  validatePocketMoneyInput,
  type DomainEvent,
  type PocketMoneyFailureReason,
  type PocketMoneyFrequency,
  type PocketMoneyRun,
  type PocketMoneySchedule,
  type PocketMoneyScheduleInput,
  type Wallet,
} from "@/domain";
import { authorize } from "./authorization";
import { walletBalance } from "./engine";
import { commitEvents } from "./events";
import { findUser, linkFor } from "./identity";
import { allowanceRunDraft, findWallet, primaryWalletOf } from "./operations";
import {
  fail,
  ok,
  post,
  resolveContext,
  type ActionContext,
  type TransitionOutput,
} from "./transitions";
import type { SandboxError, SandboxState } from "./types";

/**
 * Pocket Money Autopilot — pure transitions for recurring pocket money.
 *
 *   create / update / pause / resume / cancel   (the plan; no money)
 *   executeDue(asOf)                            (the money, explicitly)
 *
 * There is no timer: `executeDuePocketMoneyTransition` runs only when
 * called (a sandbox control, or a test) with an explicit `asOf` instant.
 * Per due schedule it:
 *   1. re-authorizes the parent (role → active membership → linked to
 *      this teen → the same link the schedule was created under);
 *   2. picks the one occurrence to process (missed-schedule policy:
 *      only the latest due occurrence; earlier missed ones are counted,
 *      never paid retroactively);
 *   3. derives the execution id `scheduleId:YYYY-MM-DD` — the
 *      idempotency key and the operation id — and stops if that
 *      occurrence was already processed;
 *   4. checks both wallets (owned by the right accounts, not frozen or
 *      closed) and the parent's available balance;
 *   5. posts one two-leg `allowance` operation through `postOperation`
 *      (the only money write path — atomic, so both legs or neither);
 *   6. appends the run (completed or failed) and advances the schedule;
 *   7. emits events → notifications.
 * A failed occurrence moves nothing, is recorded once, and is never
 * retried automatically; the schedule stays intact for the next one.
 */

// ── Errors ───────────────────────────────────────────────────────

const UNKNOWN_SCHEDULE: SandboxError = {
  code: "unknown_schedule",
  message: "This pocket money schedule isn't available.",
};

const NOT_YOUR_SCHEDULE: SandboxError = {
  code: "not_permitted",
  message: "Only the parent who set up this pocket money can change it.",
};

const TAMPERED: SandboxError = {
  code: "not_permitted",
  message: "Pocket money can only go from your own wallet to your connected teen's wallet.",
};

const PREVIOUS_LINK: SandboxError = {
  code: "not_linked",
  message: "This schedule belongs to an earlier family connection, so it can't run or change.",
};

const STALE: SandboxError = {
  code: "stale_schedule",
  message:
    "This schedule changed since you opened it. Review the latest details and try again. Nothing was changed.",
};

const ENDED: SandboxError = {
  code: "invalid_transition",
  message: "This schedule has ended, so it can't be changed. Its history stays available.",
};

// ── Helpers ──────────────────────────────────────────────────────

function findSchedule(state: SandboxState, scheduleId: string): PocketMoneySchedule | null {
  return state.schedules.find((s) => s.id === scheduleId) ?? null;
}

function replaceSchedule(state: SandboxState, schedule: PocketMoneySchedule): SandboxState {
  return {
    ...state,
    schedules: state.schedules.map((s) => (s.id === schedule.id ? schedule : s)),
  };
}

function nameOf(state: SandboxState, userId: string): string {
  return findUser(state, userId)?.displayName ?? "your teen";
}

/**
 * The actor may manage (and run) this schedule: a parent, active in
 * the family, actively linked to the schedule's teen, the schedule's
 * own payer, under the same link it was created with.
 */
function authorizeOwner(
  state: SandboxState,
  actorId: string,
  schedule: PocketMoneySchedule,
): SandboxError | null {
  const denied = authorize(state, actorId, "allowance.schedule", {
    teenId: schedule.teenAccountId,
  });
  if (denied) return denied;
  if (schedule.parentAccountId !== actorId || schedule.familyId !== state.family.id) {
    return NOT_YOUR_SCHEDULE;
  }
  const link = linkFor(state, schedule.teenAccountId);
  if (!link || link.guardianId !== actorId || link.linkedAt !== schedule.linkedAt) {
    return PREVIOUS_LINK;
  }
  return null;
}

function scheduleEvent(
  schedule: PocketMoneySchedule,
  change: Extract<DomainEvent, { type: "pocket_money_schedule_changed" }>["change"],
  actorId: string,
  at: string,
): DomainEvent {
  return {
    // Deterministic per version: a replay can't notify twice.
    id: `evt_pms_${change}_${schedule.id}_v${schedule.version}`,
    type: "pocket_money_schedule_changed",
    actorId,
    at,
    scheduleId: schedule.id,
    teenId: schedule.teenAccountId,
    guardianId: schedule.parentAccountId,
    change,
    amount: schedule.amount,
    frequency: schedule.frequency,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    ...(schedule.endedReason ? { endedReason: schedule.endedReason } : {}),
  };
}

function toSandboxError(problem: { field: SandboxError["field"]; message: string }): SandboxError {
  return { code: "invalid_schedule", message: problem.message, field: problem.field };
}

function samePlan(a: PocketMoneyScheduleInput, b: PocketMoneyScheduleInput): boolean {
  return (
    a.amount === b.amount &&
    a.frequency === b.frequency &&
    a.dayOfWeek === b.dayOfWeek &&
    a.dayOfMonth === b.dayOfMonth &&
    a.startDate === b.startDate &&
    (a.endDate ?? null) === (b.endDate ?? null)
  );
}

function planOf(schedule: PocketMoneySchedule): PocketMoneyScheduleInput {
  return {
    amount: schedule.amount,
    frequency: schedule.frequency,
    dayOfWeek: schedule.dayOfWeek,
    dayOfMonth: schedule.dayOfMonth,
    startDate: schedule.startDate,
    ...(schedule.endDate !== undefined ? { endDate: schedule.endDate } : {}),
  };
}

// ── Create ───────────────────────────────────────────────────────

export interface CreatePocketMoneyInput extends ActionContext {
  /** Idempotency key generated once per form; becomes the schedule id. */
  scheduleId: string;
  teenId: string;
  amount: number;
  frequency: PocketMoneyFrequency;
  dayOfWeek: number;
  dayOfMonth: number;
  startDate: string;
  endDate?: string;
  /**
   * Optional echoes from a client. Never trusted: the engine derives
   * the payer (the session) and both wallets itself, and rejects any
   * echo that doesn't match.
   */
  parentAccountId?: string;
  sourceWalletId?: string;
  destinationWalletId?: string;
}

export interface PocketMoneyScheduleResult {
  scheduleId: string;
  /** The next occurrence (YYYY-MM-DD), or null when none remains. */
  nextOccurrence: string | null;
}

export function createPocketMoneyScheduleTransition(
  state: SandboxState,
  input: CreatePocketMoneyInput,
): TransitionOutput<PocketMoneyScheduleResult> {
  const { actorId, at } = resolveContext(state, input);
  const denied = authorize(state, actorId, "allowance.schedule", { teenId: input.teenId });
  if (denied) return fail(state, denied);
  const teen = findUser(state, input.teenId);
  if (!teen || teen.role !== "teen") return fail(state, TAMPERED);
  if (input.parentAccountId !== undefined && input.parentAccountId !== actorId) {
    return fail(state, TAMPERED);
  }

  // Wallets come from the data, never from the client.
  const source = primaryWalletOf(state.wallets, actorId);
  const destination = primaryWalletOf(state.wallets, teen.id);
  if (!source || !destination) {
    return fail(state, { code: "unknown_wallet", message: "This wallet isn't available." });
  }
  if (
    (input.sourceWalletId !== undefined && input.sourceWalletId !== source.id) ||
    (input.destinationWalletId !== undefined && input.destinationWalletId !== destination.id)
  ) {
    return fail(state, TAMPERED);
  }
  if (source.status === "closed") {
    return fail(state, { code: "wallet_closed", message: "Your wallet is closed, so pocket money can't be scheduled." });
  }
  if (destination.status === "closed") {
    return fail(state, {
      code: "wallet_closed",
      message: `${teen.displayName}'s wallet is closed, so pocket money can't be scheduled.`,
    });
  }

  const plan = normalizeCadence<PocketMoneyScheduleInput>({
    amount: input.amount,
    frequency: input.frequency,
    dayOfWeek: input.dayOfWeek,
    dayOfMonth: input.dayOfMonth,
    startDate: input.startDate,
    ...(input.endDate ? { endDate: input.endDate } : {}),
  });
  const today = productDay(at);

  // Idempotency: the same form submitted twice creates one schedule.
  const existing = findSchedule(state, input.scheduleId);
  if (existing) {
    return existing.parentAccountId === actorId &&
      existing.teenAccountId === teen.id &&
      samePlan(planOf(existing), plan)
      ? ok(state, { scheduleId: existing.id, nextOccurrence: existing.nextRunAt ? occurrenceDayOf(existing.nextRunAt) : null })
      : fail(state, {
          code: "duplicate",
          message: "This schedule was already submitted with different details. Nothing was changed.",
        });
  }

  const invalid = validatePocketMoneyInput(plan, today);
  if (invalid) return fail(state, toSandboxError(invalid));

  if (
    state.schedules.some(
      (s) => s.parentAccountId === actorId && s.teenAccountId === teen.id && isOpenSchedule(s),
    )
  ) {
    return fail(state, {
      code: "duplicate",
      message: `${teen.displayName} already has pocket money set up. Edit, pause or cancel it instead.`,
    });
  }

  const link = linkFor(state, teen.id);
  const first = upcomingOccurrence({ ...plan, runs: [] }, today);
  if (!link?.linkedAt || !first) return fail(state, toSandboxError({ field: "endDate", message: "No transfer day falls between the start and end dates." }));

  const schedule: PocketMoneySchedule = {
    id: input.scheduleId,
    familyId: state.family.id,
    parentAccountId: actorId,
    teenAccountId: teen.id,
    sourceWalletId: source.id,
    destinationWalletId: destination.id,
    amount: plan.amount,
    currency: SANDBOX_CURRENCY,
    frequency: plan.frequency,
    dayOfWeek: plan.dayOfWeek,
    dayOfMonth: plan.dayOfMonth,
    startDate: plan.startDate,
    ...(plan.endDate ? { endDate: plan.endDate } : {}),
    nextRunAt: dueInstant(first),
    status: "active",
    createdAt: at,
    updatedAt: at,
    createdBy: actorId,
    version: 1,
    linkedAt: link.linkedAt,
    runs: [],
  };
  const next: SandboxState = { ...state, schedules: [...state.schedules, schedule] };
  return ok(commitEvents(next, [scheduleEvent(schedule, "created", actorId, at)]), {
    scheduleId: schedule.id,
    nextOccurrence: first,
  });
}

// ── Update ───────────────────────────────────────────────────────

export interface UpdatePocketMoneyInput extends ActionContext {
  scheduleId: string;
  /** The version the form was opened with (stale edits are refused). */
  expectedVersion: number;
  amount?: number;
  frequency?: PocketMoneyFrequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  startDate?: string;
  /** `null` removes the end date. */
  endDate?: string | null;
}

export function updatePocketMoneyScheduleTransition(
  state: SandboxState,
  input: UpdatePocketMoneyInput,
): TransitionOutput<PocketMoneyScheduleResult> {
  const { actorId, at } = resolveContext(state, input);
  const schedule = findSchedule(state, input.scheduleId);
  if (!schedule) return fail(state, UNKNOWN_SCHEDULE);
  const denied = authorizeOwner(state, actorId, schedule);
  if (denied) return fail(state, denied);
  if (!isOpenSchedule(schedule)) return fail(state, ENDED);

  const current = planOf(schedule);
  const endDate = input.endDate === null ? undefined : (input.endDate ?? current.endDate);
  const plan = normalizeCadence<PocketMoneyScheduleInput>({
    amount: input.amount ?? current.amount,
    frequency: input.frequency ?? current.frequency,
    dayOfWeek: input.dayOfWeek ?? current.dayOfWeek,
    dayOfMonth: input.dayOfMonth ?? current.dayOfMonth,
    startDate: input.startDate ?? current.startDate,
    ...(endDate ? { endDate } : {}),
  });
  const result = (s: PocketMoneySchedule) => ({
    scheduleId: s.id,
    nextOccurrence: s.nextRunAt ? occurrenceDayOf(s.nextRunAt) : null,
  });
  // Re-submitting the same values (double click, retry) is a no-op.
  if (samePlan(plan, current)) return ok(state, result(schedule));
  if (input.expectedVersion !== schedule.version) return fail(state, STALE);

  const today = productDay(at);
  const startChanged = plan.startDate !== current.startDate;
  if (startChanged && schedule.runs.length > 0) {
    return fail(state, toSandboxError({
      field: "startDate",
      message: "The start date can't change after pocket money has been processed.",
    }));
  }
  const invalid = validatePocketMoneyInput(plan, today, {
    allowPastStart: !startChanged,
  });
  if (invalid) return fail(state, toSandboxError(invalid));

  const upcoming = upcomingOccurrence({ ...plan, runs: schedule.runs }, today);
  if (!upcoming) {
    return fail(state, toSandboxError({
      field: "endDate",
      message: "No transfer day is left before this end date. Cancel the schedule instead.",
    }));
  }

  const { endDate: _dropped, ...withoutEnd } = schedule;
  void _dropped;
  const updated: PocketMoneySchedule = {
    ...withoutEnd,
    ...plan,
    nextRunAt: schedule.status === "active" ? dueInstant(upcoming) : null,
    updatedAt: at,
    version: schedule.version + 1,
  };
  return ok(
    commitEvents(replaceSchedule(state, updated), [scheduleEvent(updated, "updated", actorId, at)]),
    result(updated),
  );
}

// ── Pause / resume / cancel ──────────────────────────────────────

export interface ScheduleActionInput extends ActionContext {
  scheduleId: string;
  /** When given, a change made since the screen loaded is refused. */
  expectedVersion?: number;
}

type LifecycleAction = "pause" | "resume" | "cancel";

function lifecycle(
  state: SandboxState,
  input: ScheduleActionInput,
  action: LifecycleAction,
): TransitionOutput<PocketMoneyScheduleResult> {
  const { actorId, at } = resolveContext(state, input);
  const schedule = findSchedule(state, input.scheduleId);
  if (!schedule) return fail(state, UNKNOWN_SCHEDULE);
  const denied = authorizeOwner(state, actorId, schedule);
  if (denied) return fail(state, denied);
  const result = (s: PocketMoneySchedule) => ({
    scheduleId: s.id,
    nextOccurrence: s.nextRunAt ? occurrenceDayOf(s.nextRunAt) : null,
  });

  // Already in the requested state: idempotent no-op (double submit).
  const target = { pause: "paused", resume: "active", cancel: "cancelled" }[action];
  if (schedule.status === target) return ok(state, result(schedule));
  if (!isOpenSchedule(schedule)) return fail(state, ENDED);
  if (action === "pause" && schedule.status !== "active") {
    return fail(state, { code: "invalid_transition", message: "Only active pocket money can be paused." });
  }
  if (action === "resume" && schedule.status !== "paused") {
    return fail(state, { code: "invalid_transition", message: "Only paused pocket money can be resumed." });
  }
  if (input.expectedVersion !== undefined && input.expectedVersion !== schedule.version) {
    return fail(state, STALE);
  }

  const base = { ...schedule, updatedAt: at, version: schedule.version + 1 };
  let updated: PocketMoneySchedule;
  let change: "paused" | "resumed" | "cancelled" | "completed";
  if (action === "pause") {
    updated = { ...base, status: "paused", nextRunAt: null };
    change = "paused";
  } else if (action === "cancel") {
    updated = { ...base, status: "cancelled", nextRunAt: null, endedReason: "cancelled" };
    change = "cancelled";
  } else {
    // Resume from the next valid occurrence: nothing is back-paid for
    // the paused period.
    const upcoming = upcomingOccurrence(schedule, productDay(at));
    if (upcoming) {
      updated = { ...base, status: "active", nextRunAt: dueInstant(upcoming) };
      change = "resumed";
    } else {
      updated = { ...base, status: "completed", nextRunAt: null, endedReason: "end_date_reached" };
      change = "completed";
    }
  }
  return ok(
    commitEvents(replaceSchedule(state, updated), [scheduleEvent(updated, change, actorId, at)]),
    result(updated),
  );
}

export function pausePocketMoneyScheduleTransition(state: SandboxState, input: ScheduleActionInput) {
  return lifecycle(state, input, "pause");
}

export function resumePocketMoneyScheduleTransition(state: SandboxState, input: ScheduleActionInput) {
  return lifecycle(state, input, "resume");
}

export function cancelPocketMoneyScheduleTransition(state: SandboxState, input: ScheduleActionInput) {
  return lifecycle(state, input, "cancel");
}

/**
 * Used by `disconnectTransition` (either side may disconnect): every
 * open schedule between this teen and guardian is cancelled with the
 * reason `family_disconnected`. History stays; nothing moves.
 */
export function stopSchedulesOnDisconnect(
  state: SandboxState,
  teenId: string,
  guardianId: string,
  actorId: string,
  at: string,
): { state: SandboxState; events: DomainEvent[] } {
  const events: DomainEvent[] = [];
  const schedules = state.schedules.map((s) => {
    if (s.teenAccountId !== teenId || s.parentAccountId !== guardianId || !isOpenSchedule(s)) {
      return s;
    }
    const stopped: PocketMoneySchedule = {
      ...s,
      status: "cancelled",
      endedReason: "family_disconnected",
      nextRunAt: null,
      updatedAt: at,
      version: s.version + 1,
    };
    events.push(scheduleEvent(stopped, "cancelled", actorId, at));
    return stopped;
  });
  return events.length ? { state: { ...state, schedules }, events } : { state, events };
}

// ── Execute ──────────────────────────────────────────────────────

export interface ExecutePocketMoneyInput extends ActionContext {
  /**
   * The sandbox clock: which occurrences count as due. Defaults to
   * `at`. Ledger entries are always stamped with `at` (real time).
   */
  asOf?: string;
  /** Only this schedule (e.g. a per-schedule sandbox control). */
  scheduleId?: string;
}

export type PocketMoneyRunOutcome = {
  scheduleId: string;
  occurrence: string;
  runId: string;
  status: "completed" | "failed" | "already_processed";
  reference?: string;
  message?: string;
  /** Earlier due occurrences skipped under the missed-schedule policy. */
  missed: number;
};

export interface ExecutePocketMoneyResult {
  outcomes: PocketMoneyRunOutcome[];
}

type Check = { reason: PocketMoneyFailureReason; message: string } | null;

function walletCheck(
  source: Wallet | null,
  destination: Wallet | null,
  schedule: PocketMoneySchedule,
  teenName: string,
): Check {
  if (
    !source ||
    !destination ||
    source.ownerAccountId !== schedule.parentAccountId ||
    destination.ownerAccountId !== schedule.teenAccountId
  ) {
    return { reason: "wallet_unavailable", message: "A wallet for this schedule isn't available, so nothing was sent." };
  }
  if (source.status === "frozen") {
    return { reason: "source_frozen", message: "Your wallet is frozen, so pocket money wasn't sent. Nothing moved." };
  }
  if (source.status === "closed") {
    return { reason: "source_closed", message: "Your wallet is closed, so pocket money wasn't sent. Nothing moved." };
  }
  if (destination.status === "frozen") {
    return {
      reason: "destination_frozen",
      message: `${teenName}'s wallet is frozen, so pocket money wasn't sent. Nothing left your wallet.`,
    };
  }
  if (destination.status === "closed") {
    return {
      reason: "destination_closed",
      message: `${teenName}'s wallet is closed, so pocket money wasn't sent. Nothing left your wallet.`,
    };
  }
  return null;
}

/** Processes one due schedule's occurrence. The state is scoped and pure. */
function runOccurrence(
  state: SandboxState,
  schedule: PocketMoneySchedule,
  actorId: string,
  at: string,
  asOf: string,
): { state: SandboxState; outcome: PocketMoneyRunOutcome | null; events: DomainEvent[] } {
  const floor = occurrenceDayOf(schedule.nextRunAt!);
  const asOfDay = productDay(asOf);
  const cap = schedule.endDate !== undefined && schedule.endDate < asOfDay ? schedule.endDate : asOfDay;
  const occurrence = latestOccurrenceBetween(schedule, floor, cap);

  const advance = (s: PocketMoneySchedule, from: string, runs: PocketMoneyRun[]) => {
    const following = nextOccurrenceAfter(s, from);
    const ended = s.endDate !== undefined && following > s.endDate;
    const lastRunAt = runs.reduce<string | undefined>(
      (latest, run) => (latest === undefined || run.at > latest ? run.at : latest),
      undefined,
    );
    const updated: PocketMoneySchedule = {
      ...s,
      runs,
      ...(lastRunAt !== undefined ? { lastRunAt } : {}),
      updatedAt: at,
      version: s.version + 1,
      nextRunAt: ended ? null : dueInstant(following),
      status: ended ? "completed" : "active",
      ...(ended ? { endedReason: "end_date_reached" as const } : {}),
    };
    return updated;
  };

  if (!occurrence) {
    // Due, but no occurrence left before the end date: complete it.
    const done: PocketMoneySchedule = {
      ...schedule,
      status: "completed",
      endedReason: "end_date_reached",
      nextRunAt: null,
      updatedAt: at,
      version: schedule.version + 1,
    };
    return { state: replaceSchedule(state, done), outcome: null, events: [scheduleEvent(done, "completed", actorId, at)] };
  }

  const runId = pocketMoneyExecutionId(schedule.id, occurrence);
  const missed = countOccurrences(schedule, floor, occurrence);

  // Idempotency: an occurrence is processed at most once, ever.
  const priorRun = schedule.runs.find((r) => r.id === runId);
  const priorOperation = state.operations.find((op) => op.id === runId);
  if (priorRun || priorOperation) {
    const runs = priorRun
      ? schedule.runs
      : [
          ...schedule.runs,
          {
            id: runId,
            scheduleId: schedule.id,
            occurrence,
            status: "completed" as const,
            amount: priorOperation!.amount,
            at: priorOperation!.createdAt,
            operationId: priorOperation!.id,
            reference: priorOperation!.reference,
          },
        ];
    const updated = advance(schedule, occurrence, runs);
    return {
      state: replaceSchedule(state, updated),
      outcome: {
        scheduleId: schedule.id,
        occurrence,
        runId,
        status: "already_processed",
        ...(priorRun?.reference ?? priorOperation?.reference
          ? { reference: priorRun?.reference ?? priorOperation?.reference }
          : {}),
        missed: 0,
      },
      events: updated.status === "completed" ? [scheduleEvent(updated, "completed", actorId, at)] : [],
    };
  }

  const teenName = nameOf(state, schedule.teenAccountId);
  const parentName = nameOf(state, schedule.parentAccountId);
  const source = findWallet(state.wallets, schedule.sourceWalletId);
  const destination = findWallet(state.wallets, schedule.destinationWalletId);
  let failure: Check = walletCheck(source, destination, schedule, teenName);
  if (!failure && walletBalance(state.ledger, source!.id) < schedule.amount) {
    failure = { reason: "insufficient_funds", message: INSUFFICIENT_FUNDS_MESSAGE };
  }

  let next = state;
  let run: PocketMoneyRun;
  if (!failure) {
    const posted = post(
      state,
      allowanceRunDraft({
        scheduleId: schedule.id,
        occurrence,
        actorId,
        at,
        from: { walletId: source!.id, accountId: schedule.parentAccountId, name: parentName },
        to: { walletId: destination!.id, accountId: schedule.teenAccountId, name: teenName },
        amount: schedule.amount,
      }),
    );
    if (posted.ok) {
      next = posted.state;
      run = {
        id: runId,
        scheduleId: schedule.id,
        occurrence,
        status: "completed",
        amount: schedule.amount,
        at,
        operationId: runId,
        reference: posted.reference,
        ...(missed ? { missed } : {}),
      };
    } else {
      failure = {
        reason:
          posted.error.code === "insufficient_balance"
            ? "insufficient_funds"
            : posted.error.code === "wallet_frozen"
              ? "source_frozen"
              : "rejected",
        message:
          posted.error.code === "insufficient_balance"
            ? INSUFFICIENT_FUNDS_MESSAGE
            : `${posted.error.message} Nothing was sent.`,
      };
    }
  }
  if (failure) {
    run = {
      id: runId,
      scheduleId: schedule.id,
      occurrence,
      status: "failed",
      amount: schedule.amount,
      at,
      reason: failure.reason,
      message: failure.message,
      ...(missed ? { missed } : {}),
    };
  }

  const updated = advance(schedule, occurrence, [...schedule.runs, run!]);
  const events: DomainEvent[] = [
    run!.status === "completed"
      ? {
          id: `evt_pm_paid_${runId}`,
          type: "pocket_money_paid",
          actorId,
          at,
          scheduleId: schedule.id,
          runId,
          teenId: schedule.teenAccountId,
          guardianId: schedule.parentAccountId,
          amount: schedule.amount,
          reference: run!.reference!,
          occurrence,
        }
      : {
          id: `evt_pm_failed_${runId}`,
          type: "pocket_money_failed",
          actorId,
          at,
          scheduleId: schedule.id,
          runId,
          teenId: schedule.teenAccountId,
          guardianId: schedule.parentAccountId,
          amount: schedule.amount,
          occurrence,
          reason: run!.reason!,
          message: run!.message!,
        },
  ];
  if (updated.status === "completed") events.push(scheduleEvent(updated, "completed", actorId, at));

  return {
    state: replaceSchedule(next, updated),
    outcome: {
      scheduleId: schedule.id,
      occurrence,
      runId,
      status: run!.status,
      ...(run!.reference ? { reference: run!.reference } : {}),
      ...(run!.message ? { message: run!.message } : {}),
      missed,
    },
    events,
  };
}

/**
 * Executes every due occurrence the acting parent pays (or just one
 * schedule's). Safe to call any number of times: processed
 * occurrences are skipped by their execution id.
 */
export function executeDuePocketMoneyTransition(
  state: SandboxState,
  input: ExecutePocketMoneyInput = {},
): TransitionOutput<ExecutePocketMoneyResult> {
  const { actorId, at } = resolveContext(state, input);
  const asOf = input.asOf ?? at;
  if (Number.isNaN(Date.parse(asOf))) {
    return fail(state, { code: "invalid_transition", message: "That date isn't valid." });
  }
  // Gate: only an active, linked parent can execute anything.
  const denied = authorize(state, actorId, "allowance.schedule");
  if (denied) return fail(state, denied);

  let candidates = state.schedules.filter((s) => s.parentAccountId === actorId);
  if (input.scheduleId !== undefined) {
    const one = findSchedule(state, input.scheduleId);
    if (!one) return fail(state, UNKNOWN_SCHEDULE);
    const ownerProblem = authorizeOwner(state, actorId, one);
    if (ownerProblem) return fail(state, ownerProblem);
    if (one.status === "paused") {
      return fail(state, { code: "invalid_transition", message: "This pocket money is paused, so nothing was sent." });
    }
    if (!isOpenSchedule(one)) return fail(state, ENDED);
    candidates = [one];
  }

  let next = state;
  const outcomes: PocketMoneyRunOutcome[] = [];
  const events: DomainEvent[] = [];
  for (const candidate of candidates) {
    // Always the latest copy (an earlier iteration may have changed state).
    const schedule = findSchedule(next, candidate.id)!;
    if (schedule.status !== "active" || !schedule.nextRunAt) continue;
    if (Date.parse(schedule.nextRunAt) > Date.parse(asOf)) continue;
    if (authorizeOwner(next, actorId, schedule)) continue;
    const step = runOccurrence(next, schedule, actorId, at, asOf);
    next = step.state;
    if (step.outcome) outcomes.push(step.outcome);
    events.push(...step.events);
  }
  if (next === state) return ok(state, { outcomes });
  return ok(commitEvents(next, events), { outcomes });
}
