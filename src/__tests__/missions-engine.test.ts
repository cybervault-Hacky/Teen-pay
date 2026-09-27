import { describe, expect, it } from "vitest";
import { MISSIONS, missionById, type MissionView } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import {
  advanceMissionTransition,
  missionBoardFor,
  missionDetailFor,
  missionFactsFor,
  startMissionTransition,
} from "@/sandbox/missions";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { archiveSpaceTransition, createSpaceTransition } from "@/sandbox/space-transitions";
import type { SandboxDatabase, SandboxResult, SandboxState } from "@/sandbox/types";
import { linkedDatabase } from "./helpers/fixtures";

/**
 * Money Missions (Phase 11) — the engine against the real sandbox:
 * completion rules, idempotency, order, evidence from real data,
 * locks, teen-only access, privacy between teens, and money safety
 * (only `missionProgress` ever changes). Explicit clock throughout.
 */

const AT = "2026-09-27T05:00:00.000Z";
const LATER = "2026-09-27T05:05:00.000Z";

type Out = { db: SandboxDatabase; result: SandboxResult<MissionView> };

function ok(out: Out): SandboxDatabase {
  if (!out.result.ok) throw new Error(JSON.stringify(out.result.error));
  return out.db;
}

const start = (db: SandboxDatabase, missionId: string, actorId = SEED_TEEN_ID, at = AT) =>
  startMissionTransition(db, { actorId, at, missionId });

const advance = (db: SandboxDatabase, missionId: string, stepId: string, answer?: number, actorId = SEED_TEEN_ID, at = LATER) =>
  advanceMissionTransition(db, { actorId, at, missionId, stepId, ...(answer !== undefined ? { answer } : {}) });

/** Runs a mission start to finish with the right answers (evidence must already be true). */
function complete(db: SandboxDatabase, missionId: string, actorId = SEED_TEEN_ID): SandboxDatabase {
  const mission = missionById(missionId)!;
  let next = ok(start(db, missionId, actorId));
  for (const step of mission.steps) {
    next = ok(advance(next, missionId, step.id, step.kind === "check" ? step.answer : undefined, actorId));
  }
  return next;
}

function view(db: SandboxDatabase, missionId: string, actorId = SEED_TEEN_ID): MissionView {
  const r = missionDetailFor(db, actorId, missionId);
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

function runScoped(db: SandboxDatabase, actorId: string, fn: (s: SandboxState) => { state: SandboxState; result: { ok: boolean } }) {
  const scope = scopeFor(db, actorId)!;
  const out = fn(scope.state);
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return mergeScope(db, scope.info, scope.state, out.state);
}

const withoutMissions = (db: SandboxDatabase) => {
  const { missionProgress: _m, ...rest } = db;
  void _m;
  return rest;
};

describe("completion — lessons", () => {
  it("start → read steps → right answer completes the mission and records when", () => {
    let db = buildSeedDatabase();
    db = ok(start(db, "know-your-balance"));
    expect(view(db, "know-your-balance")).toMatchObject({ status: "in_progress", progress: { completedSteps: 0, totalSteps: 3 } });
    db = ok(advance(db, "know-your-balance", "total"));
    db = ok(advance(db, "know-your-balance", "available"));
    expect(view(db, "know-your-balance").statusLabel).toBe("In progress · Step 3 of 3");
    const out = advance(db, "know-your-balance", "check", 1);
    expect(out.result.ok).toBe(true);
    db = out.db;
    expect(view(db, "know-your-balance")).toMatchObject({ status: "completed", completedOn: "2026-09-27" });
    expect(db.missionProgress).toEqual([
      { ownerAccountId: SEED_TEEN_ID, missionId: "know-your-balance", stepsCompleted: 3, startedAt: AT, updatedAt: LATER, completedAt: LATER },
    ]);
  });

  it("every catalog mission can be completed by a teen with the evidence in place", () => {
    let db = buildSeedDatabase();
    db = runScoped(db, SEED_TEEN_ID, (s) =>
      createSpaceTransition(s, { actorId: SEED_TEEN_ID, at: AT, spaceId: "spc_mission_all", name: "Gifts", type: "custom", icon: "gift" }),
    );
    for (const m of MISSIONS) db = complete(db, m.id);
    const board = missionBoardFor(db, SEED_TEEN_ID);
    expect(board.ok && board.value.completed).toBe(10);
    expect(board.ok && board.value.next).toBeNull();
  });

  it("a wrong answer changes nothing and can be retried — no penalty", () => {
    let db = ok(start(buildSeedDatabase(), "send-vs-request"));
    db = ok(advance(db, "send-vs-request", "send"));
    db = ok(advance(db, "send-vs-request", "request"));
    const wrong = advance(db, "send-vs-request", "check", 0);
    expect(wrong.result).toEqual({ ok: false, error: { code: "mission_step", message: "Not quite — have another look and try again." } });
    expect(wrong.db).toBe(db);
    const missing = advance(db, "send-vs-request", "check");
    expect(missing.result.ok).toBe(false);
    expect(ok(advance(db, "send-vs-request", "check", 1)).missionProgress?.[0]?.completedAt).toBe(LATER);
  });
});

describe("no fake progress — order and starting", () => {
  it("a step can't be finished before the mission is started (no auto-start)", () => {
    const db = buildSeedDatabase();
    const out = advance(db, "know-your-balance", "total");
    expect(out.result).toEqual({ ok: false, error: { code: "mission_step", message: "Start the mission first." } });
    expect(out.db).toBe(db);
    expect(view(db, "know-your-balance").status).toBe("available");
  });

  it("steps must go in order", () => {
    const db = ok(start(buildSeedDatabase(), "know-your-balance"));
    const skip = advance(db, "know-your-balance", "check", 1);
    expect(skip.result).toEqual({ ok: false, error: { code: "mission_step", message: "Finish the earlier steps first." } });
    expect(skip.db).toBe(db);
  });

  it("unknown missions and steps are refused without touching anything", () => {
    const db = buildSeedDatabase();
    for (const id of ["nope", "", "__proto__", "constructor", "../money", "usr_aarav"]) {
      const out = start(db, id);
      expect(out.result).toMatchObject({ ok: false, error: { code: "unknown_mission" } });
      expect(out.db).toBe(db);
      expect(missionDetailFor(db, SEED_TEEN_ID, id)).toMatchObject({ ok: false, error: { code: "unknown_mission" } });
    }
    const started = ok(start(db, "know-your-balance"));
    const out = advance(started, "know-your-balance", "not-a-step");
    expect(out.result).toMatchObject({ ok: false, error: { code: "mission_step" } });
    expect(out.db).toBe(started);
  });
});

describe("idempotency", () => {
  it("starting twice is a no-op; repeating a done step is a no-op", () => {
    const db1 = ok(start(buildSeedDatabase(), "payment-safety"));
    const again = start(db1, "payment-safety", SEED_TEEN_ID, LATER);
    expect(again.result.ok).toBe(true);
    expect(again.db).toBe(db1);
    const db2 = ok(advance(db1, "payment-safety", "check-first"));
    const repeat = advance(db2, "payment-safety", "check-first", undefined, SEED_TEEN_ID, "2026-09-27T06:00:00.000Z");
    expect(repeat.result.ok).toBe(true);
    expect(repeat.db).toBe(db2);
  });

  it("a completed mission stays completed: any step or start again changes nothing", () => {
    const db = complete(buildSeedDatabase(), "know-your-balance");
    for (const stepId of ["total", "available", "check"]) {
      const out = advance(db, "know-your-balance", stepId, 0);
      expect(out.result).toMatchObject({ ok: true, value: { status: "completed" } });
      expect(out.db).toBe(db);
    }
    expect(start(db, "know-your-balance").db).toBe(db);
    expect(db.missionProgress).toHaveLength(1);
  });

  it("timestamps never go backwards, even if the device clock does", () => {
    let db = ok(start(buildSeedDatabase(), "know-your-balance", SEED_TEEN_ID, LATER));
    db = ok(advance(db, "know-your-balance", "total", undefined, SEED_TEEN_ID, AT)); // clock went back
    const r = db.missionProgress![0]!;
    expect(r.updatedAt).toBe(LATER);
    expect(Date.parse(r.updatedAt)).toBeGreaterThanOrEqual(Date.parse(r.startedAt));
  });
});

describe("evidence from real data — Spaces and goals", () => {
  it("Build a Money Space completes only once the teen really has a Space (no money needed)", () => {
    let db = ok(start(buildSeedDatabase(), "build-a-space"));
    db = ok(advance(db, "build-a-space", "job"));
    const early = advance(db, "build-a-space", "create");
    expect(early.result).toEqual({ ok: false, error: { code: "mission_step", message: "You don't have a Space of your own yet." } });
    expect(early.db).toBe(db);
    expect(view(db, "build-a-space").currentStep?.evidence).toEqual({ met: false, text: "You don't have a Space of your own yet." });

    // The existing Spaces flow — nothing moved, no starting amount.
    const before = db.ledger?.length;
    db = runScoped(db, SEED_TEEN_ID, (s) =>
      createSpaceTransition(s, { actorId: SEED_TEEN_ID, at: AT, spaceId: "spc_mission_01", name: "Gifts", type: "custom", icon: "gift" }),
    );
    expect(db.ledger?.length).toBe(before);
    expect(view(db, "build-a-space").currentStep?.evidence).toEqual({ met: true, text: "You have a Space: Gifts." });
    db = ok(advance(db, "build-a-space", "create"));
    expect(view(db, "build-a-space").status).toBe("completed");

    // Archiving the Space later doesn't undo learning.
    db = runScoped(db, SEED_TEEN_ID, (s) =>
      archiveSpaceTransition(s, { actorId: SEED_TEEN_ID, at: LATER, spaceId: "spc_mission_01", operationId: "op_mission_archive_01" }),
    );
    expect(missionFactsFor(scopeFor(db, SEED_TEEN_ID)!.state).customSpace).toBeNull();
    expect(view(db, "build-a-space").status).toBe("completed");
  });

  it("Set a Saving Goal uses the teen's existing goal with a target (seed: New Bike, ₹2,500)", () => {
    let db = ok(start(buildSeedDatabase(), "set-saving-goal"));
    db = ok(advance(db, "set-saving-goal", "target"));
    expect(view(db, "set-saving-goal").currentStep?.evidence).toEqual({ met: true, text: "Your goal New Bike has a ₹2,500 target." });
    db = ok(advance(db, "set-saving-goal", "goal"));
    expect(view(db, "set-saving-goal").status).toBe("completed");
  });

  it("the Save Space doesn't count as 'a Space of your own'", () => {
    const facts = missionFactsFor(scopeFor(buildSeedDatabase(), SEED_TEEN_ID)!.state);
    expect(facts).toEqual({ customSpace: null, goalWithTarget: { name: "New Bike", target: 2500 }, hasTransactions: true });
  });
});

describe("locks", () => {
  it("Review a Transaction is locked until there is a transaction — and can't be started", () => {
    const made = createAccount(buildSeedDatabase(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    const db = made.db;
    const v = view(db, "review-transaction", made.account.id);
    expect(v).toMatchObject({ status: "locked", lockedReason: "Available after your first transaction." });
    const out = start(db, "review-transaction", made.account.id);
    expect(out.result).toEqual({ ok: false, error: { code: "mission_locked", message: "Available after your first transaction." } });
    expect(out.db).toBe(db);
    // Other missions are open to a brand-new teen.
    expect(ok(start(db, "know-your-balance", made.account.id)).missionProgress).toHaveLength(1);
  });

  it("the seed teen has transactions, so it's open", () => {
    expect(view(buildSeedDatabase(), "review-transaction").status).toBe("available");
  });
});

describe("auth and privacy", () => {
  it("a linked parent gets the teen-only refusal for board, detail, start and advance", () => {
    const db = complete(linkedDatabase(), "know-your-balance");
    expect(missionBoardFor(db, SEED_PARENT_ID)).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(missionDetailFor(db, SEED_PARENT_ID, "know-your-balance")).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    const s = start(db, "payment-safety", SEED_PARENT_ID);
    expect(s.result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(s.db).toBe(db);
    const a = advance(db, "know-your-balance", "total", undefined, SEED_PARENT_ID);
    expect(a.result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(a.db).toBe(db);
    // The teen's progress is untouched.
    expect(view(db, "know-your-balance").status).toBe("completed");
  });

  it("unknown or missing accounts get nothing", () => {
    const db = buildSeedDatabase();
    expect(missionBoardFor(db, "usr_nobody").ok).toBe(false);
    expect(start(db, "know-your-balance", "usr_nobody").db).toBe(db);
  });

  it("each teen sees only their own progress", () => {
    let db = complete(buildSeedDatabase(), "know-your-balance");
    db = ok(start(db, "payment-safety", SEED_PEER_ID));
    const peer = missionBoardFor(db, SEED_PEER_ID);
    const teen = missionBoardFor(db, SEED_TEEN_ID);
    if (!peer.ok || !teen.ok) throw new Error("boards");
    expect(peer.value.completed).toBe(0);
    expect(peer.value.missions.find((m) => m.id === "payment-safety")?.status).toBe("in_progress");
    expect(teen.value.completed).toBe(1);
    expect(teen.value.missions.find((m) => m.id === "payment-safety")?.status).toBe("available");
    // Advancing another teen's mission isn't possible: it's always your own record.
    const cross = advance(db, "payment-safety", "check-first", undefined, SEED_TEEN_ID);
    expect(cross.result).toMatchObject({ ok: false, error: { message: "Start the mission first." } });
  });

  it("views carry no account, wallet or record ids", () => {
    const db = complete(buildSeedDatabase(), "know-your-balance");
    const board = missionBoardFor(db, SEED_TEEN_ID);
    const json = JSON.stringify(board);
    for (const id of [SEED_TEEN_ID, SEED_PARENT_ID, SEED_PEER_ID, "wal_", "usr_", "ownerAccountId"]) {
      expect(json).not.toContain(id);
    }
  });
});

describe("money safety", () => {
  it("completing every mission changes nothing but mission progress", () => {
    const seed = buildSeedDatabase();
    // A Space made through the normal flow first (that's the Spaces feature, not missions).
    const base = runScoped(seed, SEED_TEEN_ID, (s) =>
      createSpaceTransition(s, { actorId: SEED_TEEN_ID, at: AT, spaceId: "spc_mission_safe", name: "Gifts", type: "custom", icon: "gift" }),
    );
    let db = base;
    for (const m of MISSIONS) db = complete(db, m.id);
    expect(withoutMissions(db)).toEqual(withoutMissions(base));
    expect(JSON.stringify(withoutMissions(db))).toBe(JSON.stringify(withoutMissions(base)));
    expect(db.missionProgress).toHaveLength(10);
  });

  it("failed attempts change nothing at all", () => {
    const db = buildSeedDatabase();
    const snapshot = JSON.stringify(db);
    start(db, "nope");
    advance(db, "know-your-balance", "check", 0);
    start(db, "know-your-balance", SEED_PARENT_ID);
    expect(JSON.stringify(db)).toBe(snapshot);
  });
});

describe("performance", () => {
  it("the board is memoized per database snapshot and account", () => {
    const db = buildSeedDatabase();
    expect(missionBoardFor(db, SEED_TEEN_ID)).toBe(missionBoardFor(db, SEED_TEEN_ID));
    const next = ok(start(db, "know-your-balance"));
    expect(missionBoardFor(next, SEED_TEEN_ID)).not.toBe(missionBoardFor(db, SEED_TEEN_ID));
  });
});
