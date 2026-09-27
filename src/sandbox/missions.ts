import {
  checkStep,
  deriveMissionBoard,
  deriveMissionView,
  missionById,
  type MissionBoard,
  type MissionFacts,
  type MissionProgress,
  type MissionView,
} from "@/domain";
import { authorize } from "./authorization";
import type { PeerOutput } from "./peer-transitions";
import { scopeFor } from "./scope";
import { listWalletEntries, selectActiveSpaces, selectViewerWallet } from "./selectors";
import type { SandboxDatabase, SandboxError, SandboxResult, SandboxState } from "./types";

/**
 * Money Missions — the mission engine (Phase 11).
 *
 *   ledger / Spaces → existing selectors → mission facts (here)
 *     → mission rules (domain/mission.ts) → UI
 *
 * What it reads: the signed-in teen's own scoped state, through the
 * existing selectors — whether they have a custom Space, a goal with a
 * target, any completed transaction. Nothing else, and never another
 * account's data.
 *
 * What it writes: only `db.missionProgress` — which mission, how many
 * steps are done, when. Never the ledger, operations, wallets, Spaces,
 * requests, notifications or anything else; there is no path from
 * here to `postOperation`. Missions never move money and never pay
 * out rewards.
 *
 * Teen-only (`missions.use`): a parent — even a linked guardian whose
 * scope includes the teen's wallet — gets the standard teen-only
 * refusal, so mission progress stays private to the teen.
 *
 * Transitions are pure and all-or-nothing (the input database comes
 * back unchanged on failure) and idempotent: finishing a step that's
 * already done, or completing a completed mission, changes nothing.
 */

const ACCOUNT_UNAVAILABLE: SandboxError = {
  code: "account_unavailable",
  message: "This account isn't available. Please sign in again.",
};

export const UNKNOWN_MISSION: SandboxError = {
  code: "unknown_mission",
  message: "This mission doesn't exist.",
};

const STEP_MESSAGES = {
  wrong_order: "Finish the earlier steps first.",
  wrong_answer: "Not quite — have another look and try again.",
  evidence_missing: "This step isn't done yet.",
} as const;

function fail<T>(db: SandboxDatabase, error: SandboxError): PeerOutput<T> {
  return { db, result: { ok: false, error } };
}

function done<T>(db: SandboxDatabase, value: T): PeerOutput<T> {
  return { db, result: { ok: true, value } };
}

/**
 * The actor's scoped state, if they may use missions: an active teen
 * whose own wallet is the one in view. Anyone else gets an error.
 */
function missionScope(db: SandboxDatabase, actorId: string): { state: SandboxState } | SandboxError {
  const scope = scopeFor(db, actorId);
  if (!scope) return ACCOUNT_UNAVAILABLE;
  const denied = authorize(scope.state, actorId, "missions.use");
  if (denied) return denied;
  const wallet = selectViewerWallet(scope.state);
  if (!wallet || wallet.ownerAccountId !== actorId) {
    return { code: "not_permitted", message: "Money Missions are available on teen accounts." };
  }
  return { state: scope.state };
}

const isError = (value: unknown): value is SandboxError =>
  typeof value === "object" && value !== null && "code" in value && "message" in value;

/**
 * The facts mission steps and locks depend on, from the teen's own
 * scoped state via the existing selectors (no second calculation).
 */
export function missionFactsFor(state: SandboxState): MissionFacts {
  const spaces = selectActiveSpaces(state);
  const custom = spaces.find((s) => s.type === "custom");
  const goal = spaces.find((s) => s.type === "goal" && s.progress.target !== undefined);
  const wallet = selectViewerWallet(state);
  return {
    customSpace: custom ? custom.name : null,
    goalWithTarget: goal ? { name: goal.name, target: goal.progress.target! } : null,
    hasTransactions: wallet ? listWalletEntries(state, wallet.id).length > 0 : false,
  };
}

/** The actor's own progress records (never anyone else's). */
export function missionRecordsFor(db: SandboxDatabase, accountId: string): MissionProgress[] {
  return (db.missionProgress ?? []).filter((r) => r.ownerAccountId === accountId);
}

const boardCache = new WeakMap<SandboxDatabase, Map<string, SandboxResult<MissionBoard>>>();

/**
 * The teen's mission board: every mission with its status and steps.
 * Memoized per database snapshot and account — it doesn't depend on
 * the clock, so it only changes when the teen's data does.
 */
export function missionBoardFor(db: SandboxDatabase, accountId: string): SandboxResult<MissionBoard> {
  let byAccount = boardCache.get(db);
  if (!byAccount) {
    byAccount = new Map();
    boardCache.set(db, byAccount);
  }
  const hit = byAccount.get(accountId);
  if (hit) return hit;
  const scope = missionScope(db, accountId);
  const result: SandboxResult<MissionBoard> = isError(scope)
    ? { ok: false, error: scope }
    : { ok: true, value: deriveMissionBoard(missionRecordsFor(db, accountId), missionFactsFor(scope.state)) };
  byAccount.set(accountId, result);
  return result;
}

/** One mission as the teen sees it. */
export function missionDetailFor(db: SandboxDatabase, accountId: string, missionId: string): SandboxResult<MissionView> {
  const board = missionBoardFor(db, accountId);
  if (!board.ok) return board;
  const view = board.value.missions.find((m) => m.id === missionId);
  return view ? { ok: true, value: view } : { ok: false, error: UNKNOWN_MISSION };
}

// ── Transitions ───────────────────────────────────────────────────

export interface MissionInput {
  actorId: string;
  at: string;
  missionId: string;
}

function withRecord(db: SandboxDatabase, record: MissionProgress): SandboxDatabase {
  const others = (db.missionProgress ?? []).filter(
    (r) => !(r.ownerAccountId === record.ownerAccountId && r.missionId === record.missionId),
  );
  return { ...db, missionProgress: [...others, record] };
}

/**
 * Starts a mission (status → in progress). Starting one that's already
 * started or completed changes nothing. A locked mission can't start.
 */
export function startMissionTransition(db: SandboxDatabase, input: MissionInput): PeerOutput<MissionView> {
  const scope = missionScope(db, input.actorId);
  if (isError(scope)) return fail(db, scope);
  const mission = missionById(input.missionId);
  if (!mission) return fail(db, UNKNOWN_MISSION);
  const facts = missionFactsFor(scope.state);
  const existing = missionRecordsFor(db, input.actorId).find((r) => r.missionId === mission.id);
  if (existing) return done(db, deriveMissionView(mission, existing, facts));
  const view = deriveMissionView(mission, undefined, facts);
  if (view.status === "locked") {
    return fail(db, { code: "mission_locked", message: view.lockedReason ?? "This mission isn't available yet." });
  }
  const record: MissionProgress = {
    ownerAccountId: input.actorId,
    missionId: mission.id,
    stepsCompleted: 0,
    startedAt: input.at,
    updatedAt: input.at,
  };
  const next = withRecord(db, record);
  return done(next, deriveMissionView(mission, record, facts));
}

export interface AdvanceMissionInput extends MissionInput {
  /** The step being finished — must be the current one. */
  stepId: string;
  /** For check steps: the chosen option. */
  answer?: number;
}

/**
 * Finishes the current step of a started mission, after checking it:
 * the right answer for a check, the evidence for an evidence step,
 * and always the right order. Finishing the last step completes the
 * mission (and it stays completed). Repeating a finished step, or any
 * step of a completed mission, changes nothing.
 */
export function advanceMissionTransition(db: SandboxDatabase, input: AdvanceMissionInput): PeerOutput<MissionView> {
  const scope = missionScope(db, input.actorId);
  if (isError(scope)) return fail(db, scope);
  const mission = missionById(input.missionId);
  if (!mission) return fail(db, UNKNOWN_MISSION);
  const facts = missionFactsFor(scope.state);
  const record = missionRecordsFor(db, input.actorId).find((r) => r.missionId === mission.id);
  const view = deriveMissionView(mission, record, facts);

  const index = mission.steps.findIndex((s) => s.id === input.stepId);
  if (index < 0) return fail(db, { code: "mission_step", message: "This step isn't part of the mission." });
  // Already done (or the whole mission is): a repeat changes nothing.
  if (view.status === "completed" || (record && index < record.stepsCompleted)) return done(db, view);
  if (view.status === "locked") {
    return fail(db, { code: "mission_locked", message: view.lockedReason ?? "This mission isn't available yet." });
  }
  if (!record) return fail(db, { code: "mission_step", message: "Start the mission first." });
  if (index !== record.stepsCompleted) return fail(db, { code: "mission_step", message: STEP_MESSAGES.wrong_order });

  const step = mission.steps[index]!;
  const problem = checkStep(step, { answer: input.answer }, facts);
  if (problem) {
    const message =
      problem === "evidence_missing" && step.kind === "evidence"
        ? view.steps[index]?.evidence?.text ?? STEP_MESSAGES.evidence_missing
        : STEP_MESSAGES[problem];
    return fail(db, { code: "mission_step", message });
  }

  const stepsCompleted = index + 1;
  const finished = stepsCompleted === mission.steps.length;
  // Never go back in time (a device clock can): stored timestamps stay ordered.
  const at = Date.parse(input.at) >= Date.parse(record.updatedAt) ? input.at : record.updatedAt;
  const updated: MissionProgress = {
    ...record,
    stepsCompleted,
    updatedAt: at,
    ...(finished ? { completedAt: at } : {}),
  };
  const next = withRecord(db, updated);
  return done(next, deriveMissionView(mission, updated, facts));
}
