import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ParentContent } from "@/components/parent/parent-content";
import {
  cancelPocketMoneyScheduleTransition,
  createPocketMoneyScheduleTransition,
  pausePocketMoneyScheduleTransition,
  resumePocketMoneyScheduleTransition,
} from "@/sandbox/allowance-transitions";
import { selectTeenCenter } from "@/sandbox/parent-center";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider } from "@/sandbox/store";
import type { SandboxState } from "@/sandbox/types";
import { AT, linkedState, preloadDatabase } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/parent",
}));

window.matchMedia = (query: string) =>
  ({
    matches: query === "(prefers-reduced-motion: reduce)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

/** Mon 28 Sep 2026, 00:00 IST — when the first weekly run is due. */
const MON1 = "2026-09-27T18:30:00.000Z";

function withSchedule(): SandboxState {
  const out = createPocketMoneyScheduleTransition(linkedState(), {
    actorId: SEED_PARENT_ID,
    at: AT,
    scheduleId: "pms_1",
    teenId: SEED_TEEN_ID,
    amount: 500,
    frequency: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 1,
    startDate: "2026-09-26",
  });
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.state;
}

function renderCenter(state: SandboxState) {
  preloadDatabase(state);
  render(
    <SandboxProvider viewerId={SEED_PARENT_ID}>
      <ParentContent />
    </SandboxProvider>,
  );
}

/**
 * Pocket money in the center is the existing engine, projected: the
 * selector exposes schedule status/amount/cadence/next date/version,
 * and every pause/resume/cancel goes through the same transitions.
 */
describe("pocket money in the parent control center", () => {
  it("projects the open schedule: status, amount, cadence, next run and version", () => {
    const view = selectTeenCenter(withSchedule(), SEED_PARENT_ID, SEED_TEEN_ID);
    expect(view?.allowance).toEqual({
      scheduleId: "pms_1",
      status: "active",
      amount: 500,
      cadence: "Every Monday",
      nextRunAt: MON1,
      version: 1,
    });
  });

  it("projects pause and resume through the same transitions", () => {
    const scheduled = withSchedule();
    const schedule = scheduled.schedules.find((s) => s.id === "pms_1")!;
    const paused = pausePocketMoneyScheduleTransition(scheduled, {
      actorId: SEED_PARENT_ID,
      at: AT,
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
    });
    expect(paused.result.ok).toBe(true);
    expect(
      selectTeenCenter(paused.state, SEED_PARENT_ID, SEED_TEEN_ID)?.allowance?.status,
    ).toBe("paused");

    const resumed = resumePocketMoneyScheduleTransition(paused.state, {
      actorId: SEED_PARENT_ID,
      at: AT,
      scheduleId: schedule.id,
      expectedVersion: schedule.version + 1,
    });
    expect(resumed.result.ok).toBe(true);
    expect(
      selectTeenCenter(resumed.state, SEED_PARENT_ID, SEED_TEEN_ID)?.allowance,
    ).toMatchObject({ status: "active", nextRunAt: MON1, version: 3 });
  });

  it("a cancelled schedule disappears from the projection — never a stale card", () => {
    const scheduled = withSchedule();
    const schedule = scheduled.schedules.find((s) => s.id === "pms_1")!;
    const cancelled = cancelPocketMoneyScheduleTransition(scheduled, {
      actorId: SEED_PARENT_ID,
      at: AT,
      scheduleId: schedule.id,
      expectedVersion: schedule.version,
    });
    expect(cancelled.result.ok).toBe(true);
    expect(
      selectTeenCenter(cancelled.state, SEED_PARENT_ID, SEED_TEEN_ID)?.allowance,
    ).toBeNull();
  });

  it("the center's stat reflects the schedule — and says plainly when there is none", () => {
    renderCenter(withSchedule());
    expect(screen.getByText("₹500 · Every Monday")).toBeInTheDocument();
  });

  it("without a schedule the stat is honest, not zero", () => {
    renderCenter(linkedState());
    expect(screen.getByText("Not set up")).toBeInTheDocument();
    expect(screen.queryByText(/₹0/i)).not.toBeInTheDocument();
  });
});
