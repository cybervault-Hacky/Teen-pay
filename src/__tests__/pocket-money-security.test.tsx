import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/domain";
import { TEEN_FAILED_RUN_MESSAGE } from "@/domain";
import { AuthProvider, useAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import {
  cancelPocketMoneyScheduleTransition,
  createPocketMoneyScheduleTransition,
  executeDuePocketMoneyTransition,
  pausePocketMoneyScheduleTransition,
  resumePocketMoneyScheduleTransition,
  updatePocketMoneyScheduleTransition,
  type CreatePocketMoneyInput,
} from "@/sandbox/allowance-transitions";
import { disconnectTransition } from "@/sandbox/family-transitions";
import { databaseFromState } from "@/sandbox/persistence";
import { LedgerIntegrityError, mergeScope, scopeFor } from "@/sandbox/scope";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider, useOptionalSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { TransitionOutput } from "@/sandbox/transitions";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { AT, PARENT_WALLET, SANDBOX_KEY, TEEN_WALLET, linkedState, preloadDatabase } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const MON1 = "2026-09-28T06:00:00Z";

function newAccount(db: SandboxDatabase, role: "teen" | "parent", username: string) {
  const out = createAccount(db, { role, displayName: `${username} Test`, username }, AT);
  if ("code" in out) throw new Error(out.message);
  return out as { db: SandboxDatabase; account: User };
}

function planFor(actorId: string, overrides: Partial<CreatePocketMoneyInput> = {}): CreatePocketMoneyInput {
  return {
    actorId,
    at: AT,
    scheduleId: "pms_1",
    teenId: SEED_TEEN_ID,
    amount: 500,
    frequency: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 1,
    startDate: "2026-09-26",
    ...overrides,
  };
}

/** Runs a transition the way the store does: scope → transition → merge. */
function run<T>(
  db: SandboxDatabase,
  accountId: string,
  transition: (s: SandboxState) => TransitionOutput<T>,
): { db: SandboxDatabase; out: TransitionOutput<T> } {
  const scope = scopeFor(db, accountId)!;
  const out = transition(scope.state);
  return { db: mergeScope(db, scope.info, scope.state, out.state), out };
}

/** Aarav ↔ Priya linked with a ₹500 weekly schedule; teen Kabir and parent Neha unrelated. */
function world() {
  let db = databaseFromState(linkedState());
  db = run(db, SEED_PARENT_ID, (s) => createPocketMoneyScheduleTransition(s, planFor(SEED_PARENT_ID))).db;
  const kabir = newAccount(db, "teen", "kabirm");
  db = kabir.db;
  const neha = newAccount(db, "parent", "neha");
  db = neha.db;
  return { db, kabir: kabir.account, neha: neha.account };
}

const money = (db: SandboxDatabase) => JSON.stringify([db.ledger, db.operations]);
const schedules = (db: SandboxDatabase) => JSON.stringify(db.pocketMoneySchedules);
const codeOf = (out: TransitionOutput<unknown>) => (out.result.ok ? "ok" : out.result.error.code);

describe("pocket money authorization (repository boundary)", () => {
  it("the linked parent can create and execute; money moves exactly once", () => {
    const { db } = world();
    expect(db.pocketMoneySchedules).toHaveLength(1);
    const exec = run(db, SEED_PARENT_ID, (s) => executeDuePocketMoneyTransition(s, { actorId: SEED_PARENT_ID, at: MON1 }));
    expect(codeOf(exec.out)).toBe("ok");
    expect(exec.db.ledger.filter((e) => e.scheduleId)).toHaveLength(2);
    const again = run(exec.db, SEED_PARENT_ID, (s) => executeDuePocketMoneyTransition(s, { actorId: SEED_PARENT_ID, at: MON1 }));
    expect(again.db).toBe(exec.db);
  });

  it("the teen can see their schedule but never create, modify or execute it", () => {
    const { db } = world();
    const teenView = scopeFor(db, SEED_TEEN_ID)!.state;
    expect(teenView.schedules.map((s) => s.id)).toEqual(["pms_1"]);
    const version = teenView.schedules[0]!.version;
    const attempts: ((s: SandboxState) => TransitionOutput<unknown>)[] = [
      (s) => createPocketMoneyScheduleTransition(s, planFor(SEED_TEEN_ID, { scheduleId: "pms_teen" })),
      (s) => updatePocketMoneyScheduleTransition(s, { actorId: SEED_TEEN_ID, at: AT, scheduleId: "pms_1", expectedVersion: version, amount: 5000 }),
      (s) => pausePocketMoneyScheduleTransition(s, { actorId: SEED_TEEN_ID, at: AT, scheduleId: "pms_1" }),
      (s) => resumePocketMoneyScheduleTransition(s, { actorId: SEED_TEEN_ID, at: AT, scheduleId: "pms_1" }),
      (s) => cancelPocketMoneyScheduleTransition(s, { actorId: SEED_TEEN_ID, at: AT, scheduleId: "pms_1" }),
      (s) => executeDuePocketMoneyTransition(s, { actorId: SEED_TEEN_ID, at: MON1 }),
      (s) => executeDuePocketMoneyTransition(s, { actorId: SEED_TEEN_ID, at: MON1, scheduleId: "pms_1" }),
    ];
    for (const attempt of attempts) {
      const { db: after, out } = run(db, SEED_TEEN_ID, attempt);
      expect(codeOf(out)).toBe("not_permitted");
      expect(money(after)).toBe(money(db));
      expect(schedules(after)).toBe(schedules(db));
    }
  });

  it("an unrelated parent can't see, change or execute the schedule", () => {
    const { db, neha } = world();
    const view = scopeFor(db, neha.id)!.state;
    expect(view.schedules).toEqual([]);
    const attempts: ((s: SandboxState) => TransitionOutput<unknown>)[] = [
      (s) => createPocketMoneyScheduleTransition(s, planFor(neha.id, { scheduleId: "pms_neha" })),
      (s) => pausePocketMoneyScheduleTransition(s, { actorId: neha.id, at: AT, scheduleId: "pms_1" }),
      (s) => cancelPocketMoneyScheduleTransition(s, { actorId: neha.id, at: AT, scheduleId: "pms_1" }),
      (s) => executeDuePocketMoneyTransition(s, { actorId: neha.id, at: MON1 }),
      (s) => executeDuePocketMoneyTransition(s, { actorId: neha.id, at: MON1, scheduleId: "pms_1" }),
    ];
    for (const attempt of attempts) {
      const { db: after, out } = run(db, neha.id, attempt);
      expect(out.result.ok).toBe(false);
      expect(money(after)).toBe(money(db));
      expect(schedules(after)).toBe(schedules(db));
    }
  });

  it("another teen can't see the schedule", () => {
    const { db, kabir } = world();
    expect(scopeFor(db, kabir.id)!.state.schedules).toEqual([]);
  });

  it("a disconnected parent loses the schedule: ended, hidden, and nothing can run", () => {
    const { db } = world();
    const off = run(db, SEED_PARENT_ID, (s) => disconnectTransition(s, { actorId: SEED_PARENT_ID, at: AT, teenId: SEED_TEEN_ID })).db;
    expect(off.pocketMoneySchedules[0]).toMatchObject({ status: "cancelled", endedReason: "family_disconnected" });
    expect(scopeFor(off, SEED_PARENT_ID)!.state.schedules).toEqual([]);
    const exec = run(off, SEED_PARENT_ID, (s) => executeDuePocketMoneyTransition(s, { actorId: SEED_PARENT_ID, at: MON1 }));
    expect(exec.out.result.ok).toBe(false);
    expect(money(exec.db)).toBe(money(off));
    const create = run(off, SEED_PARENT_ID, (s) => createPocketMoneyScheduleTransition(s, planFor(SEED_PARENT_ID, { scheduleId: "pms_2" })));
    expect(create.out.result.ok).toBe(false);
  });

  it("a teen who disconnects ends the schedule through the only write they may make", () => {
    const { db } = world();
    const off = run(db, SEED_TEEN_ID, (s) => disconnectTransition(s, { actorId: SEED_TEEN_ID, at: AT, teenId: SEED_TEEN_ID })).db;
    expect(off.pocketMoneySchedules[0]).toMatchObject({ status: "cancelled", endedReason: "family_disconnected", nextRunAt: null });
    expect(money(off)).toBe(money(db));
  });

  it("unknown or signed-out actors get no scope and can't execute", () => {
    const { db } = world();
    expect(scopeFor(db, "")).toBeNull();
    expect(scopeFor(db, "usr_ghost")).toBeNull();
    const s = scopeFor(db, SEED_PARENT_ID)!.state;
    const out = executeDuePocketMoneyTransition(s, { actorId: "usr_ghost", at: MON1 });
    expect(out.result.ok).toBe(false);
    expect(out.state).toBe(s);
  });

  it("tampered parent, source, destination or teen ids are rejected", () => {
    const { db, kabir, neha } = world();
    const fresh = run(db, SEED_PARENT_ID, (s) => cancelPocketMoneyScheduleTransition(s, { actorId: SEED_PARENT_ID, at: AT, scheduleId: "pms_1" })).db;
    const tampered: Partial<CreatePocketMoneyInput>[] = [
      { parentAccountId: neha.id },
      { sourceWalletId: TEEN_WALLET },
      { destinationWalletId: PARENT_WALLET },
      { sourceWalletId: `wal_${neha.id}` },
      { teenId: kabir.id },
    ];
    for (const extra of tampered) {
      const { db: after, out } = run(fresh, SEED_PARENT_ID, (s) =>
        createPocketMoneyScheduleTransition(s, planFor(SEED_PARENT_ID, { scheduleId: "pms_x", ...extra })),
      );
      expect(out.result.ok).toBe(false);
      expect(after.pocketMoneySchedules.some((s) => s.id === "pms_x")).toBe(false);
    }
  });

  it("forged schedule records are refused at the merge boundary", () => {
    const { db } = world();
    const scope = scopeFor(db, SEED_PARENT_ID)!;
    const original = scope.state.schedules[0]!;
    const forge = (patch: Partial<typeof original>) => ({
      ...scope.state,
      schedules: [{ ...original, ...patch, version: original.version + 1 }],
    });
    // Rerouting the money, taking over the schedule, or rewriting history.
    for (const patch of [
      { sourceWalletId: TEEN_WALLET, destinationWalletId: PARENT_WALLET },
      { destinationWalletId: PARENT_WALLET },
      { amount: 500, runs: [] as typeof original.runs, parentAccountId: "usr_neha" },
    ]) {
      expect(() => mergeScope(db, scope.info, scope.state, forge(patch))).toThrow(LedgerIntegrityError);
    }
    // Deleting a schedule.
    expect(() => mergeScope(db, scope.info, scope.state, { ...scope.state, schedules: [] })).toThrow(LedgerIntegrityError);
    // A teen forging a change to their own schedule.
    const teen = scopeFor(db, SEED_TEEN_ID)!;
    const teenForged = { ...teen.state, schedules: teen.state.schedules.map((s) => ({ ...s, amount: 9000, version: s.version + 1 })) };
    expect(() => mergeScope(db, teen.info, teen.state, teenForged)).toThrow(LedgerIntegrityError);
    // A teen inventing a schedule paying themselves.
    const invented = { ...teen.state, schedules: [...teen.state.schedules, { ...original, id: "pms_fake", version: 1, runs: [] }] };
    expect(() => mergeScope(db, teen.info, teen.state, invented)).toThrow(LedgerIntegrityError);
  });

  it("the teen sees a neutral message for a failed run, never the parent's balance reason", () => {
    let { db } = world();
    // Make the schedule larger than Priya's balance.
    const v = db.pocketMoneySchedules[0]!.version;
    db = run(db, SEED_PARENT_ID, (s) =>
      updatePocketMoneyScheduleTransition(s, { actorId: SEED_PARENT_ID, at: AT, scheduleId: "pms_1", expectedVersion: v, amount: 9000 }),
    ).db;
    db = run(db, SEED_PARENT_ID, (s) => executeDuePocketMoneyTransition(s, { actorId: SEED_PARENT_ID, at: MON1 })).db;
    const parentRun = scopeFor(db, SEED_PARENT_ID)!.state.schedules[0]!.runs[0]!;
    const teenRun = scopeFor(db, SEED_TEEN_ID)!.state.schedules[0]!.runs[0]!;
    expect(parentRun).toMatchObject({ status: "failed", reason: "insufficient_funds" });
    expect(teenRun).toMatchObject({ status: "failed", message: TEEN_FAILED_RUN_MESSAGE });
    expect(teenRun.reason).toBeUndefined();
  });
});

// ── Store level: stale screens ─────────────────────────────────────

let sb: SandboxContextValue | null = null;
let auth: AuthContextValue | null = null;

function Capture() {
  sb = useOptionalSandbox();
  auth = useAuth();
  return null;
}

async function mountAsParent() {
  window.localStorage.clear();
  preloadDatabase(world().db);
  const service = createSandboxAuthService();
  await service.signIn({ method: "sandbox", accountId: SEED_PARENT_ID, role: "parent" }, Date.now());
  render(
    <AuthProvider service={service}>
      <SandboxProvider>
        <Capture />
      </SandboxProvider>
    </AuthProvider>,
  );
  await vi.waitFor(() => expect(sb).not.toBeNull());
  return sb!.actions;
}

function storedMoney() {
  const db = JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "{}") as Partial<SandboxDatabase>;
  return JSON.stringify([db.ledger, db.operations, db.pocketMoneySchedules]);
}

describe("pocket money actions from a stale screen", () => {
  it("after sign-out every action is refused with not_signed_in and nothing is written", async () => {
    const stale = await mountAsParent();
    const before = storedMoney();
    act(() => auth!.signOut("user"));
    await vi.waitFor(() => expect(sb).toBeNull());
    const results: unknown[] = [];
    act(() => {
      results.push(stale.executeDuePocketMoney({ asOf: "2027-01-01T00:00:00Z" }));
      results.push(stale.pausePocketMoneySchedule("pms_1"));
      results.push(stale.cancelPocketMoneySchedule("pms_1"));
      results.push(
        stale.createPocketMoneySchedule({
          idempotencyId: "pms_stale",
          teenId: SEED_TEEN_ID,
          amount: 100,
          frequency: "weekly",
          dayOfWeek: 1,
          dayOfMonth: 1,
          startDate: "2026-12-01",
        }),
      );
    });
    for (const r of results) expect(r).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(storedMoney()).toBe(before);
  });

  it("a stale parent screen can't execute once another account is signed in", async () => {
    const stale = await mountAsParent();
    const before = storedMoney();
    act(() => {
      auth!.switchAccount({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" });
    });
    await vi.waitFor(() => expect(sb?.state.session.currentUserId).toBe(SEED_TEEN_ID));
    let result: unknown;
    act(() => {
      result = stale.executeDuePocketMoney({ asOf: "2027-01-01T00:00:00Z" });
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    expect(storedMoney()).toBe(before);
  });
});
