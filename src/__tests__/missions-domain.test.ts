import { describe, expect, it } from "vitest";
import {
  checkStep,
  deriveMissionBoard,
  deriveMissionView,
  evidenceMet,
  evidenceText,
  isMissionId,
  MISSION_CATEGORIES,
  MISSION_PROGRESS_KEYS,
  missionById,
  MISSIONS,
  type MissionFacts,
  type MissionProgress,
} from "@/domain";

/**
 * Money Missions (Phase 11) — the catalog and the pure rules: stable
 * ids, honest steps, derived statuses, gentle checks, no fake progress.
 */

const FACTS: MissionFacts = { customSpace: null, goalWithTarget: null, hasTransactions: true };
const T0 = "2026-09-27T05:00:00.000Z";
const T1 = "2026-09-27T05:10:00.000Z";

function record(missionId: string, stepsCompleted: number, completed = false): MissionProgress {
  return {
    ownerAccountId: "usr_teen",
    missionId,
    stepsCompleted,
    startedAt: T0,
    updatedAt: T1,
    ...(completed ? { completedAt: T1 } : {}),
  };
}

const mission = (id: string) => {
  const m = missionById(id);
  if (!m) throw new Error(`no mission ${id}`);
  return m;
};

describe("catalog", () => {
  it("has 10 missions with unique, stable, URL-safe ids", () => {
    expect(MISSIONS).toHaveLength(10);
    const ids = MISSIONS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(ids).toEqual([
      "know-your-balance",
      "available-vs-set-aside",
      "understand-pocket-money",
      "send-vs-request",
      "payment-safety",
      "explore-spending",
      "review-transaction",
      "build-a-space",
      "set-saving-goal",
      "learn-from-coach",
    ]);
  });

  it("every mission is complete: title, summary, purpose, category, time, steps, completion copy", () => {
    for (const m of MISSIONS) {
      expect(m.title.length).toBeGreaterThan(3);
      expect(m.summary.length).toBeGreaterThan(10);
      expect(m.purpose.length).toBeGreaterThan(10);
      expect(MISSION_CATEGORIES).toContain(m.category);
      expect(Number.isInteger(m.estimatedMinutes)).toBe(true);
      expect(m.estimatedMinutes).toBeGreaterThanOrEqual(1);
      expect(m.estimatedMinutes).toBeLessThanOrEqual(5);
      expect(m.steps.length).toBeGreaterThanOrEqual(2);
      expect(m.completion.title.length).toBeGreaterThan(3);
      expect(m.completion.body.length).toBeGreaterThan(10);
    }
  });

  it("uses every category", () => {
    expect(new Set(MISSIONS.map((m) => m.category))).toEqual(new Set(MISSION_CATEGORIES));
  });

  it("step ids are unique within a mission; checks have a valid answer, hint and explanation", () => {
    for (const m of MISSIONS) {
      const ids = m.steps.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const s of m.steps) {
        if (s.kind === "check") {
          expect(s.options.length).toBeGreaterThanOrEqual(2);
          expect(new Set(s.options).size).toBe(s.options.length);
          expect(Number.isInteger(s.answer)).toBe(true);
          expect(s.answer).toBeGreaterThanOrEqual(0);
          expect(s.answer).toBeLessThan(s.options.length);
          expect(s.hint.length).toBeGreaterThan(10);
          expect(s.explanation.length).toBeGreaterThan(10);
        } else {
          expect(s.body.length).toBeGreaterThan(0);
        }
      }
    }
  });

  it("actions only point at existing in-app screens, tagged with the mission", () => {
    const allowed = /^\/(activity|money|coach)\?mission=[a-z-]+$/;
    for (const m of MISSIONS) {
      for (const s of m.steps) {
        if (s.kind === "visit" || s.kind === "evidence") {
          expect(s.href).toMatch(allowed);
          expect(s.href.endsWith(`mission=${m.id}`)).toBe(true);
          expect(s.actionLabel.length).toBeGreaterThan(3);
        }
      }
    }
  });

  it("the Space and goal missions complete from real data, not from a click", () => {
    expect(mission("build-a-space").steps.at(-1)).toMatchObject({ kind: "evidence", rule: "custom_space" });
    expect(mission("set-saving-goal").steps.at(-1)).toMatchObject({ kind: "evidence", rule: "goal_target" });
    expect(mission("explore-spending").steps.some((s) => s.kind === "visit" && s.surface === "activity")).toBe(true);
    expect(mission("review-transaction").steps.some((s) => s.kind === "visit" && s.surface === "transaction")).toBe(true);
    expect(mission("learn-from-coach").steps.some((s) => s.kind === "visit" && s.surface === "coach")).toBe(true);
  });

  it("only Review a Transaction can be locked (it needs a transaction to review)", () => {
    expect(MISSIONS.filter((m) => m.lock).map((m) => m.id)).toEqual(["review-transaction"]);
  });

  it("missionById / isMissionId accept only catalog ids", () => {
    expect(missionById("know-your-balance")?.title).toBe("Know Your Balance");
    for (const bad of ["", "KNOW-YOUR-BALANCE", "../money", "usr_aarav", 7, null, undefined, "__proto__", "constructor"]) {
      expect(missionById(bad)).toBeUndefined();
      expect(isMissionId(bad)).toBe(false);
    }
  });

  it("progress records hold only progress: no money, answers, rewards or scores", () => {
    expect([...MISSION_PROGRESS_KEYS].sort()).toEqual(
      ["completedAt", "missionId", "ownerAccountId", "startedAt", "stepsCompleted", "updatedAt"].sort(),
    );
  });

  it("copy has no rewards, streaks, pressure, gambling, crypto, loans or investing", () => {
    const text = JSON.stringify(MISSIONS).toLowerCase();
    for (const word of [
      "streak",
      "reward",
      "points",
      "xp",
      "leaderboard",
      "hurry",
      "deadline",
      "countdown",
      "don't miss",
      "last chance",
      "lottery",
      "casino",
      "bet ",
      "crypto",
      "bitcoin",
      "loan",
      "borrow",
      "invest",
      "stock",
      "lazy",
      "bad with money",
      "failure",
    ]) {
      expect(text).not.toMatch(new RegExp(`\\b${word.trim()}(s|es)?\\b`));
    }
  });

  it("\"prize\" appears only as a scam warning in Payment Safety — never as something to win", () => {
    for (const m of MISSIONS) {
      const text = JSON.stringify(m).toLowerCase();
      if (m.id === "payment-safety") expect(text).toMatch(/never pay to unlock a prize/);
      else expect(text).not.toContain("prize");
    }
  });
});

describe("statuses and progress", () => {
  it("no record → available (not started), 0 of N", () => {
    const v = deriveMissionView(mission("know-your-balance"), undefined, FACTS);
    expect(v.status).toBe("available");
    expect(v.statusLabel).toBe("Not started");
    expect(v.progress).toEqual({ completedSteps: 0, totalSteps: 3 });
    expect(v.currentStep).toBeNull();
    expect(v.steps.map((s) => s.state)).toEqual(["upcoming", "upcoming", "upcoming"]);
    expect(v.href).toBe("/missions/know-your-balance");
  });

  it("a record → in progress, with the current step and step N of M in words", () => {
    const v = deriveMissionView(mission("know-your-balance"), record("know-your-balance", 1), FACTS);
    expect(v.status).toBe("in_progress");
    expect(v.statusLabel).toBe("In progress · Step 2 of 3");
    expect(v.progress).toEqual({ completedSteps: 1, totalSteps: 3 });
    expect(v.currentStep?.id).toBe("available");
    expect(v.currentStep?.number).toBe(2);
    expect(v.steps.map((s) => s.state)).toEqual(["done", "current", "upcoming"]);
  });

  it("the completion day is the product (India) calendar day, not the UTC one", () => {
    const late = { ...record("know-your-balance", 3, true), updatedAt: "2026-09-27T19:00:00.000Z", completedAt: "2026-09-27T19:00:00.000Z" };
    expect(deriveMissionView(mission("know-your-balance"), late, FACTS).completedOn).toBe("2026-09-28");
  });

  it("all steps + completedAt → completed, with the day", () => {
    const v = deriveMissionView(mission("know-your-balance"), record("know-your-balance", 3, true), FACTS);
    expect(v.status).toBe("completed");
    expect(v.statusLabel).toBe("Completed");
    expect(v.currentStep).toBeNull();
    expect(v.completedOn).toBe("2026-09-27");
    expect(v.steps.every((s) => s.state === "done")).toBe(true);
  });

  it("locked when there is nothing to review — with a reason in words", () => {
    const v = deriveMissionView(mission("review-transaction"), undefined, { ...FACTS, hasTransactions: false });
    expect(v.status).toBe("locked");
    expect(v.statusLabel).toBe("Locked");
    expect(v.lockedReason).toMatch(/after your first transaction/);
  });

  it("completed stays completed — even if a lock or evidence would now fail", () => {
    const facts: MissionFacts = { customSpace: null, goalWithTarget: null, hasTransactions: false };
    expect(deriveMissionView(mission("review-transaction"), record("review-transaction", 3, true), facts).status).toBe(
      "completed",
    );
    expect(deriveMissionView(mission("build-a-space"), record("build-a-space", 2, true), facts).status).toBe("completed");
  });

  it("evidence is shown as a fact in words", () => {
    expect(evidenceMet("custom_space", FACTS)).toBe(false);
    expect(evidenceText("custom_space", FACTS)).toBe("You don't have a Space of your own yet.");
    const facts = { ...FACTS, customSpace: "Gifts", goalWithTarget: { name: "New Bike", target: 2500 } };
    expect(evidenceMet("custom_space", facts)).toBe(true);
    expect(evidenceText("custom_space", facts)).toBe("You have a Space: Gifts.");
    expect(evidenceText("goal_target", facts)).toBe("Your goal New Bike has a ₹2,500 target.");
  });

  it("the board counts completions and picks the next mission (in progress first)", () => {
    const empty = deriveMissionBoard([], FACTS);
    expect(empty).toMatchObject({ completed: 0, total: 10 });
    expect(empty.next?.id).toBe("know-your-balance");

    const some = deriveMissionBoard(
      [record("know-your-balance", 3, true), record("payment-safety", 1)],
      FACTS,
    );
    expect(some.completed).toBe(1);
    expect(some.next?.id).toBe("payment-safety");

    const allDone = deriveMissionBoard(
      MISSIONS.map((m) => record(m.id, m.steps.length, true)),
      FACTS,
    );
    expect(allDone.completed).toBe(10);
    expect(allDone.next).toBeNull();
  });

  it("is deterministic — same input, same output", () => {
    const a = deriveMissionBoard([record("send-vs-request", 2)], FACTS);
    const b = deriveMissionBoard([record("send-vs-request", 2)], FACTS);
    expect(a).toEqual(b);
  });
});

describe("step checks", () => {
  const kyb = mission("know-your-balance");
  const check = kyb.steps.find((s) => s.kind === "check")!;

  it("reading steps pass; checks need the right answer; wrong ones get a gentle hint", () => {
    expect(checkStep(kyb.steps[0]!, {}, FACTS)).toBeNull();
    if (check.kind !== "check") throw new Error("expected a check");
    expect(checkStep(check, { answer: check.answer }, FACTS)).toBeNull();
    expect(checkStep(check, { answer: (check.answer + 1) % check.options.length }, FACTS)).toBe("wrong_answer");
    expect(checkStep(check, {}, FACTS)).toBe("wrong_answer");
    expect(check.hint).not.toMatch(/wrong|fail|bad/i);
  });

  it("evidence steps pass only when the fact is true", () => {
    const step = mission("build-a-space").steps.at(-1)!;
    expect(checkStep(step, {}, FACTS)).toBe("evidence_missing");
    expect(checkStep(step, {}, { ...FACTS, customSpace: "Gifts" })).toBeNull();
  });
});
