import { describe, expect, it } from "vitest";
import {
  deadlineInfo,
  deadlineLabel,
  defaultSaveSpaceId,
  isCalendarDate,
  MAX_ACTIVE_SPACES,
  productDay,
  spaceProgress,
  validateSpaceDraft,
  type MoneySpace,
} from "@/domain";
import { deriveMoneySummary, spaceBalance, spaceTotals, walletBalance } from "@/sandbox/engine";
import { postOperation, spaceMoveDraft, type Journal } from "@/sandbox/operations";
import { buildSeedDatabase, buildSeedState, SEED_GOAL_SPACE_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import {
  getSpace,
  listSpaceEntries,
  selectActiveSpaces,
  selectArchivedSpaces,
  selectMoneySummary,
  selectMyNotifications,
  selectSaveSpace,
  selectSpaces,
  selectTransactions,
} from "@/sandbox/selectors";
import {
  archiveSpaceTransition,
  createSpaceTransition,
  moveSpaceMoneyTransition,
  updateSpaceTransition,
} from "@/sandbox/space-transitions";
import { updateGuardianNotificationsTransition } from "@/sandbox/family-transitions";
import { payTransition, refundTransition, fullRefundId, setWalletStatusTransition } from "@/sandbox/transitions";
import type { SandboxState } from "@/sandbox/types";
import { AT, linkedState, must, PARENT, TEEN, TEEN_WALLET } from "./helpers/fixtures";

const TODAY = productDay(AT); // 2026-09-26

const move = (
  s: SandboxState,
  operationId: string,
  spaceId: string,
  amount: number,
  direction: "add" | "withdraw" = "add",
) => moveSpaceMoneyTransition(s, { ...TEEN, operationId, spaceId, amount, direction });

const available = (s: SandboxState) => walletBalance(s.ledger, TEEN_WALLET);
const inSpace = (s: SandboxState, id: string) => spaceBalance(s.ledger, id);
const total = (s: SandboxState) => deriveMoneySummary(s.ledger.filter((e) => e.walletId === TEEN_WALLET), []).total;

const createGoal = (s: SandboxState, extra: Partial<Parameters<typeof createSpaceTransition>[1]> = {}) =>
  createSpaceTransition(s, {
    ...TEEN,
    spaceId: "spc_phone",
    name: "Headphones",
    type: "goal",
    icon: "headphones",
    targetAmount: 800,
    ...extra,
  });

// ── Domain ────────────────────────────────────────────────────────

describe("Money Space domain — progress and dates", () => {
  it("derives current, remaining and percentage (one decimal, rounded down)", () => {
    expect(spaceProgress(750, 2000)).toEqual({
      balance: 750,
      target: 2000,
      remaining: 1250,
      percent: 37.5,
      reached: false,
    });
    expect(spaceProgress(1500, 2500).percent).toBe(60);
    // Never shows 100% before the target is actually reached.
    expect(spaceProgress(1999, 2000).percent).toBe(99.9);
    expect(spaceProgress(2000, 2000)).toMatchObject({ percent: 100, remaining: 0, reached: true });
    // Past the target (Save may go over): capped at 100%, nothing negative.
    expect(spaceProgress(2600, 2000)).toMatchObject({ percent: 100, remaining: 0, reached: true });
    // No target → no percentage.
    expect(spaceProgress(300)).toEqual({ balance: 300, reached: false });
  });

  it("deadline state and neutral wording (never a promise)", () => {
    expect(deadlineLabel(deadlineInfo("2026-09-27", TODAY))).toBe("1 day left");
    expect(deadlineLabel(deadlineInfo("2026-10-26", TODAY))).toBe("30 days left");
    expect(deadlineLabel(deadlineInfo("2026-11-30", TODAY))).toBe("About 2 months left");
    expect(deadlineLabel(deadlineInfo(TODAY, TODAY))).toBe("Target date is today");
    const passed = deadlineInfo("2026-09-01", TODAY);
    expect(passed).toMatchObject({ state: "passed", daysLeft: -25 });
    expect(deadlineLabel(passed)).toBe("Target date passed");
  });

  it("uses the product timezone (IST) for 'today'", () => {
    expect(productDay("2026-09-25T18:29:00Z")).toBe("2026-09-25");
    expect(productDay("2026-09-25T18:30:00Z")).toBe("2026-09-26");
    expect(isCalendarDate("2026-02-29")).toBe(false);
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("30/11/2026")).toBe(false);
  });
});

describe("Money Space domain — central validation", () => {
  const ctx = { otherActiveNames: ["Save", "New Bike"], today: TODAY };
  const goal = { name: "Trip", type: "goal" as const, icon: "plane" as const, targetAmount: 3000 };

  it("accepts a valid goal and a custom space without a target", () => {
    expect(validateSpaceDraft(goal, ctx)).toEqual({});
    expect(validateSpaceDraft({ name: "Gifts", type: "custom", icon: "gift" }, ctx)).toEqual({});
  });

  it("names: required, length-capped, unique among active spaces (case-insensitive)", () => {
    expect(validateSpaceDraft({ ...goal, name: "   " }, ctx).name).toBe("Give this space a name.");
    expect(validateSpaceDraft({ ...goal, name: "x".repeat(31) }, ctx).name).toMatch(/under 31/);
    expect(validateSpaceDraft({ ...goal, name: " new bike " }, ctx).name).toBe(
      "You already have a space with this name.",
    );
  });

  it("targets: goals need one; zero, negative, fractional and oversized are rejected", () => {
    expect(validateSpaceDraft({ ...goal, targetAmount: null }, ctx).targetAmount).toBe("Goals need a target amount.");
    expect(validateSpaceDraft({ ...goal, targetAmount: 0 }, ctx).targetAmount).toBe("A target must be above ₹0.");
    expect(validateSpaceDraft({ ...goal, targetAmount: -5 }, ctx).targetAmount).toBe("A target must be above ₹0.");
    expect(validateSpaceDraft({ ...goal, targetAmount: 10.5 }, ctx).targetAmount).toBe("Enter a whole-rupee target.");
    expect(validateSpaceDraft({ ...goal, targetAmount: 100_001 }, ctx).targetAmount).toMatch(/capped/);
    expect(
      validateSpaceDraft({ ...goal, targetAmount: 400 }, { ...ctx, currentBalance: 500 }).targetAmount,
    ).toBe("The target can't be less than what's already saved.");
  });

  it("deadlines: real dates, not in the past, within 10 years, goals only", () => {
    expect(validateSpaceDraft({ ...goal, deadline: "2026-02-30" }, ctx).deadline).toBe("Enter a valid date.");
    expect(validateSpaceDraft({ ...goal, deadline: "next week" }, ctx).deadline).toBe("Enter a valid date.");
    expect(validateSpaceDraft({ ...goal, deadline: "2026-09-25" }, ctx).deadline).toBe("Pick today or a later date.");
    expect(validateSpaceDraft({ ...goal, deadline: TODAY }, ctx).deadline).toBeUndefined();
    expect(validateSpaceDraft({ ...goal, deadline: "2036-09-27" }, ctx).deadline).toMatch(/within 10 years/);
    expect(
      validateSpaceDraft({ name: "Gifts", type: "custom", icon: "gift", deadline: "2026-12-01" }, ctx).deadline,
    ).toBe("Only goals have a target date.");
    // Editing may keep an unchanged date that has since passed.
    expect(
      validateSpaceDraft({ ...goal, deadline: "2026-09-01" }, { ...ctx, previousDeadline: "2026-09-01" }).deadline,
    ).toBeUndefined();
  });
});

// ── Seed ──────────────────────────────────────────────────────────

describe("seed — one Save, one goal, real allocations, balanced", () => {
  it("Aarav: available ₹1,850, Save ₹800 of ₹2,000, New Bike ₹1,500 of ₹2,500", () => {
    const s = buildSeedState();
    expect(selectMoneySummary(s)).toEqual({ available: 1850, allocated: 2300, total: 4150, upcoming: 200 });
    const save = selectSaveSpace(s, AT)!;
    expect(save).toMatchObject({ id: SEED_SAVE_SPACE_ID, name: "Save", type: "save", balance: 800, isDefault: true });
    expect(save.progress.percent).toBe(40);
    const bike = getSpace(s, SEED_GOAL_SPACE_ID, AT)!;
    expect(bike).toMatchObject({ name: "New Bike", type: "goal", balance: 1500, deadline: "2026-11-30" });
    expect(bike.progress).toMatchObject({ percent: 60, remaining: 1000 });
  });

  it("every Space entry has a matching operation with an SPC reference; every operation balances", () => {
    const db = buildSeedDatabase();
    const spaceEntries = db.ledger.filter((e) => e.spaceId);
    expect(spaceEntries).toHaveLength(2);
    for (const e of spaceEntries) {
      expect(e.reference).toMatch(/^SPC-[0-9A-Z]{8}$/);
      expect(db.operations.find((op) => op.id === e.operationId)?.type).toBe("space");
    }
    // Wallet total = available + Σ Space balances, for every account.
    for (const wallet of db.wallets) {
      const entries = db.ledger.filter((e) => e.walletId === wallet.id);
      const summary = deriveMoneySummary(entries, []);
      const spaces = db.spaces.filter((sp) => sp.walletId === wallet.id);
      expect(summary.allocated).toBe(spaces.reduce((sum, sp) => sum + spaceBalance(db.ledger, sp.id), 0));
      expect(summary.total).toBe(summary.available + summary.allocated);
    }
    // Deterministic.
    expect(buildSeedDatabase()).toEqual(db);
  });
});

// ── Engine: moving money ─────────────────────────────────────────

describe("moving money between available and a Space (through postOperation)", () => {
  it("add: available goes down, the Space goes up, total unchanged, one SPC-referenced entry", () => {
    const s0 = buildSeedState();
    const out = move(s0, "mv_1", SEED_SAVE_SPACE_ID, 250);
    expect(out.result).toMatchObject({ ok: true, value: { spaceId: SEED_SAVE_SPACE_ID, replayed: false } });
    const s = out.state;
    expect(available(s)).toBe(1600);
    expect(inSpace(s, SEED_SAVE_SPACE_ID)).toBe(1050);
    expect(total(s)).toBe(total(s0));
    const entries = s.ledger.filter((e) => e.operationId === "mv_1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      type: "space_allocation",
      direction: "debit",
      amount: 250,
      spaceId: SEED_SAVE_SPACE_ID,
      counterparty: { kind: "space", id: SEED_SAVE_SPACE_ID, name: "Save" },
    });
    expect(entries[0]!.reference).toMatch(/^SPC-[0-9A-Z]{8}$/);
    if (out.result.ok) expect(out.result.value.reference).toBe(entries[0]!.reference);
    // Ledger entries are frozen (immutable).
    expect(Object.isFrozen(entries[0])).toBe(true);
  });

  it("withdraw (move back): the reverse, and activity reads 'Moved from Save'", () => {
    const s = must(move(buildSeedState(), "mv_back", SEED_SAVE_SPACE_ID, 100, "withdraw"));
    expect(available(s)).toBe(1950);
    expect(inSpace(s, SEED_SAVE_SPACE_ID)).toBe(700);
    const row = selectTransactions(s).find((t) => t.id === "mv_back")!;
    expect(row).toMatchObject({ title: "Moved from Save", amount: 100 });
    const add = selectTransactions(must(move(s, "mv_in", SEED_SAVE_SPACE_ID, 250))).find((t) => t.id === "mv_in")!;
    expect(add).toMatchObject({ title: "Added to Save", amount: -250 });
  });

  it("rejects zero, negative and fractional amounts — nothing is written", () => {
    const s = buildSeedState();
    for (const amount of [0, -50, 12.5, Number.NaN]) {
      const out = move(s, `bad_${amount}`, SEED_SAVE_SPACE_ID, amount);
      expect(out.result).toMatchObject({ ok: false, error: { code: "invalid_amount", field: "amount" } });
      expect(out.state).toBe(s);
    }
  });

  it("rejects overdrawing available money, with a human message", () => {
    const s = buildSeedState();
    const out = move(s, "too_much", SEED_SAVE_SPACE_ID, 1851);
    expect(out.result).toMatchObject({
      ok: false,
      error: { code: "insufficient_balance", message: "You have ₹1,850 available, so you can add up to that. Nothing was moved." },
    });
    expect(out.state).toBe(s);
    // Exactly the available amount is fine; available then reads ₹0.
    expect(available(must(move(s, "all", SEED_SAVE_SPACE_ID, 1850)))).toBe(0);
  });

  it("rejects overdrawing a Space", () => {
    const s = buildSeedState();
    const out = move(s, "overdraw", SEED_SAVE_SPACE_ID, 801, "withdraw");
    expect(out.result).toMatchObject({
      ok: false,
      error: { code: "insufficient_space_balance", message: expect.stringMatching(/Save has ₹800/) },
    });
    expect(out.state).toBe(s);
  });

  it("goals stop at their target; Save may go past its optional target", () => {
    const s = buildSeedState();
    expect(move(s, "g_over", SEED_GOAL_SPACE_ID, 1001).result).toMatchObject({
      ok: false,
      error: { code: "exceeds_space_target", message: expect.stringMatching(/needs ₹1,000 more/) },
    });
    const reached = must(move(s, "g_exact", SEED_GOAL_SPACE_ID, 1000));
    expect(getSpace(reached, SEED_GOAL_SPACE_ID, AT)?.progress).toMatchObject({ percent: 100, reached: true });
    // Target reached → a notification; money stays put (nothing automatic).
    expect(selectMyNotifications(reached)[0]).toMatchObject({ title: "Goal reached" });
    expect(selectMyNotifications(reached)[0]?.body).toMatch(/Nothing moves automatically/);
    expect(move(reached, "g_more", SEED_GOAL_SPACE_ID, 1).result).toMatchObject({
      ok: false,
      error: { message: "New Bike has already reached its target." },
    });
    // Save (target ₹2,000, holds ₹800) can take ₹1,300 → ₹2,100.
    const saved = must(move(s, "s_over", SEED_SAVE_SPACE_ID, 1300));
    expect(getSpace(saved, SEED_SAVE_SPACE_ID, AT)?.progress).toMatchObject({ percent: 100, remaining: 0 });
  });

  it("payments and transfers respect allocated money (only available can be spent)", () => {
    // Total ₹4,150 = available ₹1,850 + ₹2,300 in Spaces.
    let s = buildSeedState();
    s = must(move(s, "set_aside", SEED_SAVE_SPACE_ID, 1750)); // available ₹100
    const pay = payTransition(s, { ...TEEN, entryId: "pay_150", recipientId: "rec_riya", amount: 150 });
    expect(pay.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(total(s)).toBe(4150);
    // Moving money back makes it spendable again.
    s = must(move(s, "back", SEED_SAVE_SPACE_ID, 100, "withdraw"));
    expect(payTransition(s, { ...TEEN, entryId: "pay_150b", recipientId: "rec_riya", amount: 150 }).result.ok).toBe(true);
  });

  it("Space moves are not refundable or reversible as payments", () => {
    const s = must(move(buildSeedState(), "mv_r", SEED_SAVE_SPACE_ID, 100));
    const refund = refundTransition(s, { ...TEEN, entryId: "mv_r", operationId: fullRefundId("mv_r") });
    expect(refund.result.ok).toBe(false);
    expect(refund.state).toBe(s);
  });
});

describe("idempotency — double click, refresh, retry, conflict", () => {
  it("the same add replayed (double click / retry) posts once and returns the same reference", () => {
    const s1 = must(move(buildSeedState(), "once", SEED_SAVE_SPACE_ID, 200));
    const again = move(s1, "once", SEED_SAVE_SPACE_ID, 200);
    expect(again.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(again.state).toBe(s1);
    expect(s1.ledger.filter((e) => e.operationId === "once")).toHaveLength(1);
    const ref = s1.ledger.find((e) => e.operationId === "once")!.reference;
    if (again.result.ok) expect(again.result.value.reference).toBe(ref);
  });

  it("a replay after the goal filled up (or after a withdraw) is still a no-op success", () => {
    const s1 = must(move(buildSeedState(), "fill", SEED_GOAL_SPACE_ID, 1000));
    expect(move(s1, "fill", SEED_GOAL_SPACE_ID, 1000).result).toMatchObject({ ok: true, value: { replayed: true } });
    const w1 = must(move(buildSeedState(), "w_all", SEED_SAVE_SPACE_ID, 800, "withdraw"));
    expect(move(w1, "w_all", SEED_SAVE_SPACE_ID, 800, "withdraw").result).toMatchObject({ ok: true });
    expect(w1.ledger.filter((e) => e.operationId === "w_all")).toHaveLength(1);
  });

  it("the same key with a different amount, Space or direction is a conflict — nothing written", () => {
    const s1 = must(move(buildSeedState(), "key", SEED_SAVE_SPACE_ID, 200));
    for (const out of [
      move(s1, "key", SEED_SAVE_SPACE_ID, 300),
      move(s1, "key", SEED_GOAL_SPACE_ID, 200),
      move(s1, "key", SEED_SAVE_SPACE_ID, 200, "withdraw"),
    ]) {
      expect(out.result).toMatchObject({ ok: false, error: { code: "duplicate" } });
      expect(out.state).toBe(s1);
    }
  });

  it("a failed attempt records nothing, so retrying the same key after fixing it works", () => {
    const s = buildSeedState();
    expect(move(s, "retry", SEED_SAVE_SPACE_ID, 5000).result.ok).toBe(false);
    const ok = move(s, "retry", SEED_SAVE_SPACE_ID, 500);
    expect(ok.result).toMatchObject({ ok: true, value: { replayed: false } });
  });

  it("creating a Space is idempotent on its id; a different Space under the same id conflicts", () => {
    const s1 = must(createGoal(buildSeedState(), { startingAmount: 300 }));
    const replay = createGoal(s1, { startingAmount: 300 });
    expect(replay.result).toMatchObject({ ok: true, value: { spaceId: "spc_phone", replayed: true } });
    expect(replay.state).toBe(s1);
    expect(s1.ledger.filter((e) => e.spaceId === "spc_phone")).toHaveLength(1);
    expect(createGoal(s1, { name: "Something else" }).result).toMatchObject({ ok: false, error: { code: "duplicate" } });
  });
});

describe("creating, editing and archiving Spaces", () => {
  it("creates a goal with a starting amount atomically (Space + move, or neither)", () => {
    const s0 = buildSeedState();
    const out = createGoal(s0, { startingAmount: 300, deadline: "2027-01-15" });
    expect(out.result).toMatchObject({ ok: true, value: { spaceId: "spc_phone" } });
    if (out.result.ok) expect(out.result.value.reference).toMatch(/^SPC-/);
    const view = getSpace(out.state, "spc_phone", AT)!;
    expect(view).toMatchObject({ balance: 300, targetAmount: 800, deadline: "2027-01-15", status: "active", displayOrder: 2 });
    expect(view.progress.percent).toBe(37.5);
    expect(available(out.state)).toBe(1550);

    const tooMuch = createGoal(s0, { startingAmount: 5000, targetAmount: 9000 });
    expect(tooMuch.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(tooMuch.state).toBe(s0);
    expect(tooMuch.state.spaces.some((sp) => sp.id === "spc_phone")).toBe(false);
    expect(createGoal(s0, { startingAmount: 900 }).result).toMatchObject({
      ok: false,
      error: { code: "exceeds_space_target" },
    });
  });

  it("maps validation to typed errors: invalid target, invalid deadline, name", () => {
    const s = buildSeedState();
    expect(createGoal(s, { targetAmount: 0 }).result).toMatchObject({
      ok: false,
      error: { code: "invalid_target", field: "targetAmount", message: "A target must be above ₹0." },
    });
    expect(createGoal(s, { deadline: "2026-13-01" }).result).toMatchObject({
      ok: false,
      error: { code: "invalid_deadline", field: "deadline" },
    });
    expect(createGoal(s, { name: "save" }).result).toMatchObject({
      ok: false,
      error: { field: "name", message: "You already have a space with this name." },
    });
  });

  it(`caps active Spaces at ${MAX_ACTIVE_SPACES}`, () => {
    let s = buildSeedState();
    for (let i = 0; i < MAX_ACTIVE_SPACES - 2; i += 1) {
      s = must(createSpaceTransition(s, { ...TEEN, spaceId: `spc_${i}`, name: `Pot ${i}`, type: "custom", icon: "gift" }));
    }
    const out = createSpaceTransition(s, { ...TEEN, spaceId: "spc_x", name: "One more", type: "custom", icon: "gift" });
    expect(out.result).toMatchObject({ ok: false, error: { code: "space_limit_reached" } });
  });

  it("edits name, icon, target and date; type can't change; target can't drop below the balance", () => {
    const s = buildSeedState();
    const renamed = must(
      updateSpaceTransition(s, { ...TEEN, spaceId: SEED_GOAL_SPACE_ID, name: "Road bike", targetAmount: 3000, deadline: null }),
    );
    expect(getSpace(renamed, SEED_GOAL_SPACE_ID, AT)).toMatchObject({ name: "Road bike", targetAmount: 3000 });
    expect(getSpace(renamed, SEED_GOAL_SPACE_ID, AT)?.deadline).toBeUndefined();
    // Renaming never touches the ledger.
    expect(renamed.ledger).toBe(s.ledger);
    expect(updateSpaceTransition(s, { ...TEEN, spaceId: SEED_GOAL_SPACE_ID, targetAmount: 1000 }).result).toMatchObject({
      ok: false,
      error: { code: "invalid_target" },
    });
    expect(updateSpaceTransition(s, { ...TEEN, spaceId: SEED_GOAL_SPACE_ID, targetAmount: null }).result).toMatchObject({
      ok: false,
      error: { code: "invalid_target", message: "Goals need a target amount." },
    });
    // Save's optional target can be cleared.
    const cleared = must(updateSpaceTransition(s, { ...TEEN, spaceId: SEED_SAVE_SPACE_ID, targetAmount: null }));
    expect(getSpace(cleared, SEED_SAVE_SPACE_ID, AT)?.progress.percent).toBeUndefined();
  });

  it("archiving moves any balance back first (referenced), keeps history, and blocks further moves", () => {
    const s0 = buildSeedState();
    const out = archiveSpaceTransition(s0, { ...TEEN, spaceId: SEED_GOAL_SPACE_ID, operationId: "arch_1" });
    expect(out.result).toMatchObject({ ok: true, value: { returned: 1500, replayed: false } });
    const s = out.state;
    expect(available(s)).toBe(3350);
    expect(total(s)).toBe(total(s0));
    expect(inSpace(s, SEED_GOAL_SPACE_ID)).toBe(0);
    const release = s.ledger.find((e) => e.operationId === "arch_1")!;
    expect(release).toMatchObject({ type: "space_release", amount: 1500, spaceId: SEED_GOAL_SPACE_ID });
    expect(release.reference).toMatch(/^SPC-/);
    // History intact: the original allocation and the release both remain.
    expect(listSpaceEntries(s, SEED_GOAL_SPACE_ID).map((e) => e.type)).toEqual(["space_release", "space_allocation"]);
    expect(s.ledger.length).toBe(s0.ledger.length + 1);
    // Listed as archived, not deleted.
    expect(selectArchivedSpaces(s, AT).map((sp) => sp.id)).toEqual([SEED_GOAL_SPACE_ID]);
    expect(selectActiveSpaces(s, AT).map((sp) => sp.id)).toEqual([SEED_SAVE_SPACE_ID]);
    expect(selectMyNotifications(s)[0]).toMatchObject({ title: "Space archived" });
    // No more money in or out, no edits; archiving again is a no-op.
    expect(move(s, "after", SEED_GOAL_SPACE_ID, 10).result).toMatchObject({ ok: false, error: { code: "space_archived" } });
    expect(move(s, "after2", SEED_GOAL_SPACE_ID, 10, "withdraw").result.ok).toBe(false);
    expect(updateSpaceTransition(s, { ...TEEN, spaceId: SEED_GOAL_SPACE_ID, name: "X" }).result).toMatchObject({
      ok: false,
      error: { code: "space_archived" },
    });
    expect(archiveSpaceTransition(s, { ...TEEN, spaceId: SEED_GOAL_SPACE_ID, operationId: "arch_2" }).state).toBe(s);
    // Its name is free for a new Space.
    expect(createGoal(s, { name: "New Bike" }).result.ok).toBe(true);
  });

  it("the default Save can't be archived", () => {
    const out = archiveSpaceTransition(buildSeedState(), { ...TEEN, spaceId: SEED_SAVE_SPACE_ID, operationId: "a" });
    expect(out.result).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });
});

describe("frozen wallet", () => {
  it("blocks add, withdraw and archiving a Space with money; balances and history stay visible", () => {
    const frozen = must(setWalletStatusTransition(buildSeedState(), { ...TEEN, walletId: TEEN_WALLET, status: "frozen" }));
    for (const out of [
      move(frozen, "f1", SEED_SAVE_SPACE_ID, 10),
      move(frozen, "f2", SEED_SAVE_SPACE_ID, 10, "withdraw"),
      archiveSpaceTransition(frozen, { ...TEEN, spaceId: SEED_GOAL_SPACE_ID, operationId: "f3" }),
      createGoal(frozen, { startingAmount: 100 }),
    ]) {
      expect(out.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
      expect(out.state.ledger).toBe(frozen.ledger);
    }
    expect(selectSpaces(frozen, AT).map((sp) => sp.balance)).toEqual([800, 1500]);
    expect(listSpaceEntries(frozen, SEED_SAVE_SPACE_ID)).toHaveLength(1);
    // An empty Space can still be archived (no money moves).
    const empty = must(createSpaceTransition(buildSeedState(), { ...TEEN, spaceId: "spc_e", name: "Empty", type: "custom", icon: "gift" }));
    const emptyFrozen = must(setWalletStatusTransition(empty, { ...TEEN, walletId: TEEN_WALLET, status: "frozen" }));
    expect(archiveSpaceTransition(emptyFrozen, { ...TEEN, spaceId: "spc_e", operationId: "f4" }).result.ok).toBe(true);
  });
});

describe("postOperation guards Space legs (no bypass)", () => {
  const journal = (s: SandboxState): Journal => ({
    wallets: s.wallets,
    ledger: s.ledger,
    operations: s.operations,
    spaces: s.spaces,
  });
  const seedSpace = (s: SandboxState, id: string) => s.spaces.find((sp) => sp.id === id)!;

  it("rejects an unknown Space, another wallet's Space, and a leg naming a Space it isn't for", () => {
    const s = buildSeedState();
    const ghost: MoneySpace = { ...seedSpace(s, SEED_SAVE_SPACE_ID), id: "spc_ghost" };
    expect(
      postOperation(journal(s), spaceMoveDraft({ id: "g", actorId: SEED_TEEN_ID, at: AT, walletId: TEEN_WALLET, space: ghost, amount: 10, direction: "add" })),
    ).toMatchObject({ ok: false, error: { code: "unknown_space" } });
    const parentWallet = s.wallets.find((w) => w.ownerAccountId !== SEED_TEEN_ID)!;
    expect(
      postOperation(
        journal(s),
        spaceMoveDraft({ id: "x", actorId: SEED_TEEN_ID, at: AT, walletId: parentWallet.id, space: seedSpace(s, SEED_SAVE_SPACE_ID), amount: 10, direction: "add" }),
      ),
    ).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });

  it("totals are derived per Space and memoized per ledger", () => {
    const s = buildSeedState();
    const totals = spaceTotals(s.ledger);
    expect(totals.get(SEED_SAVE_SPACE_ID)).toEqual({ added: 800, withdrawn: 0 });
    expect(spaceTotals(s.ledger)).toBe(totals);
    expect(defaultSaveSpaceId(SEED_TEEN_ID)).toBe(SEED_SAVE_SPACE_ID);
  });
});

describe("guardian notifications for Space moves (amount only)", () => {
  it("an opted-in guardian hears the amount — never the Space's name or target", () => {
    let s = linkedState();
    s = must(updateGuardianNotificationsTransition(s, { ...PARENT, teenId: SEED_TEEN_ID, payments: true, savings: true }));
    s = must(move(s, "n1", SEED_GOAL_SPACE_ID, 250));
    const toParent = s.notifications.filter((n) => n.recipientId === PARENT.actorId && n.title === "Saving progress");
    expect(toParent).toHaveLength(1);
    expect(toParent[0]!.body).toBe("Aarav set aside ₹250 in a Money Space.");
    expect(JSON.stringify(toParent)).not.toMatch(/Bike|2,500/);
    // Moving money back doesn't notify the guardian.
    s = must(move(s, "n2", SEED_GOAL_SPACE_ID, 50, "withdraw"));
    expect(s.notifications.filter((n) => n.recipientId === PARENT.actorId && n.title === "Saving progress")).toHaveLength(1);
  });
});
