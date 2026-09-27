import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FamilyContent } from "@/components/family/family-content";
import { HomeContent } from "@/components/home/home-content";
import { ParentContent } from "@/components/parent/parent-content";
import {
  createPocketMoneyScheduleTransition,
  executeDuePocketMoneyTransition,
  updatePocketMoneyScheduleTransition,
} from "@/sandbox/allowance-transitions";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider, useSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { SandboxState } from "@/sandbox/types";
import { PARENT, balanceOf, linkedState, must, preloadDatabase, storedDatabase } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/parent",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

// These run on the real clock (faking Date stalls motion exits).
// Schedules created through the UI start "today"; preloaded ones use
// a start date well in the future so they never depend on the clock.
const FUTURE_START = "2030-01-05"; // a Saturday → first Monday 7 Jan 2030

let viewer: string = SEED_PARENT_ID;
let sandbox: SandboxContextValue | null = null;
beforeEach(() => {
  viewer = SEED_PARENT_ID;
  sandbox = null;
});

function Capture() {
  sandbox = useSandbox();
  return null;
}

function preload(state: SandboxState, as: "teen" | "parent" = "parent") {
  viewer = as === "parent" ? SEED_PARENT_ID : SEED_TEEN_ID;
  preloadDatabase(state);
}

function renderWith(ui: React.ReactNode) {
  return render(
    <SandboxProvider viewerId={viewer}>
      <Capture />
      {ui}
    </SandboxProvider>,
  );
}

function withSchedule(amount = 500, base = linkedState()): SandboxState {
  return must(
    createPocketMoneyScheduleTransition(base, {
      ...PARENT,
      scheduleId: "pms_ui",
      teenId: SEED_TEEN_ID,
      amount,
      frequency: "weekly",
      dayOfWeek: 1,
      dayOfMonth: 1,
      startDate: FUTURE_START,
    }),
  );
}

const section = () => screen.getByRole("region", { name: "Pocket money" });
const money = () => {
  const db = storedDatabase();
  return { parent: balanceOf(db, SEED_PARENT_ID), teen: balanceOf(db, SEED_TEEN_ID) };
};

describe("parent pocket money — create", () => {
  it("creates a schedule from a labelled form with a preview that never claims money moved", async () => {
    const user = userEvent.setup();
    preload(linkedState());
    renderWith(<ParentContent />);
    const before = money();

    await user.click(within(section()).getByRole("button", { name: "Create pocket money" }));
    const dialog = screen.getByRole("dialog", { name: "Create pocket money" });
    // Labelled fields.
    expect(within(dialog).getByLabelText("Amount")).toHaveValue("500");
    const how = within(dialog).getByRole("group", { name: "How often" });
    expect(within(how).getByRole("button", { name: /weekly/i })).toHaveAttribute("aria-pressed", "true");
    expect(within(dialog).getByLabelText("Day of the week")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Start date")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("End date (optional)")).toBeInTheDocument();

    // Switch to monthly on the 5th, ₹750.
    const amount = within(dialog).getByLabelText("Amount");
    await user.clear(amount);
    await user.type(amount, "750");
    await user.click(within(how).getByRole("button", { name: /monthly/i }));
    await user.selectOptions(within(dialog).getByLabelText("Day of the month"), "5");
    const preview = within(dialog).getByRole("region", { name: "Preview" });
    expect(preview).toHaveTextContent("₹750");
    expect(preview).toHaveTextContent("On the 5th of every month");
    expect(preview).toHaveTextContent("From");
    expect(preview).toHaveTextContent("Priya's wallet");
    expect(preview).toHaveTextContent("Aarav's wallet");
    expect(preview).toHaveTextContent(/First transfer/);
    expect(preview).toHaveTextContent(/Next transfer/);
    expect(preview).toHaveTextContent("Nothing moves now");
    expect(preview).not.toHaveTextContent(/sent|received/i);

    await user.click(within(dialog).getByRole("button", { name: "Create pocket money" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(section()).getByText("Pocket money to Aarav")).toBeInTheDocument();
    expect(within(section()).getByText("On the 5th of every month")).toBeInTheDocument();
    expect(within(section()).getByText("Active")).toBeInTheDocument();
    expect(within(section()).getByText(/Pocket money scheduled: ₹750 on the 5th of every month/)).toBeInTheDocument();
    expect(within(section()).getByText(/Nothing has been sent yet/)).toBeInTheDocument();
    // Scheduling is a plan: no money moved, one schedule stored.
    expect(money()).toEqual(before);
    expect(storedDatabase().pocketMoneySchedules).toHaveLength(1);
  });

  it("shows field errors for an invalid amount and end date, and saves nothing", async () => {
    const user = userEvent.setup();
    preload(linkedState());
    renderWith(<ParentContent />);
    await user.click(within(section()).getByRole("button", { name: "Create pocket money" }));
    const dialog = screen.getByRole("dialog", { name: "Create pocket money" });
    const amount = within(dialog).getByLabelText("Amount");
    await user.clear(amount);
    await user.click(within(dialog).getByRole("button", { name: "Create pocket money" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent("Enter an amount above ₹0.");
    expect(amount).toHaveAttribute("aria-invalid", "true");

    await user.type(amount, "300");
    await user.type(within(dialog).getByLabelText("End date (optional)"), "2020-01-01");
    await user.click(within(dialog).getByRole("button", { name: "Create pocket money" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/end date can't be before the start date/i);
    expect(storedDatabase().pocketMoneySchedules).toHaveLength(0);
  });
});

describe("parent pocket money — manage", () => {
  it("processes the next transfer through the ledger and records it in history", async () => {
    const user = userEvent.setup();
    preload(withSchedule());
    renderWith(<ParentContent />);
    const before = money();
    expect(within(section()).getByText("Mon, Jan 7")).toBeInTheDocument();

    await user.click(within(section()).getByRole("button", { name: "Process next transfer" }));
    const notice = within(section()).getByText(/Sent ₹500 to Aarav for Mon, Jan 7 · ALW-[0-9A-Z]{8}/);
    expect(notice).toBeInTheDocument();
    expect(money()).toEqual({ parent: before.parent - 500, teen: before.teen + 500 });
    const history = screen.getByRole("list", { name: "Scheduled transfers" });
    expect(within(history).getByText("Completed")).toBeInTheDocument();
    expect(within(history).getByText(/^ALW-/)).toBeInTheDocument();
    expect(within(history).getByText("₹500 to Aarav")).toBeInTheDocument();
    expect(within(section()).getByText("Mon, Jan 14")).toBeInTheDocument();
  });

  it("a repeated or stale process call for the same day sends nothing more", async () => {
    preload(withSchedule());
    renderWith(<ParentContent />);
    const due = storedDatabase().pocketMoneySchedules[0]!.nextRunAt!;
    let first: unknown;
    let second: unknown;
    act(() => {
      first = sandbox!.actions.executeDuePocketMoney({ scheduleId: "pms_ui", asOf: due });
    });
    act(() => {
      second = sandbox!.actions.executeDuePocketMoney({ scheduleId: "pms_ui", asOf: due });
    });
    expect(first).toMatchObject({ ok: true, value: { outcomes: [{ status: "completed" }] } });
    expect(second).toMatchObject({ ok: true, value: { outcomes: [] } });
    expect(storedDatabase().operations.filter((op) => op.scheduleId)).toHaveLength(1);
  });

  it("pause stops processing and keeps the schedule visible; resume shows the next date", async () => {
    const user = userEvent.setup();
    preload(withSchedule());
    renderWith(<ParentContent />);
    const manage = () => within(section()).getByRole("group", { name: "Manage pocket money" });

    await user.click(within(manage()).getByRole("button", { name: "Pause" }));
    expect(within(section()).getByText("Pocket money paused. Nothing is sent until you resume.")).toBeInTheDocument();
    expect(within(section()).getByText("Paused")).toBeInTheDocument();
    expect(within(section()).getByText("Paused — resume to continue")).toBeInTheDocument();
    expect(within(section()).queryByRole("button", { name: "Process next transfer" })).not.toBeInTheDocument();
    expect(storedDatabase().pocketMoneySchedules[0]).toMatchObject({ status: "paused", nextRunAt: null });

    await user.click(within(manage()).getByRole("button", { name: "Resume" }));
    expect(within(section()).getByText("Pocket money resumed. Next transfer Mon, Jan 7.")).toBeInTheDocument();
    expect(within(section()).getByText("Active")).toBeInTheDocument();
  });

  it("edits the amount for future transfers with the saved values prefilled", async () => {
    const user = userEvent.setup();
    preload(withSchedule());
    renderWith(<ParentContent />);
    await user.click(within(section()).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit pocket money" });
    const amount = within(dialog).getByLabelText("Amount");
    expect(amount).toHaveValue("500");
    expect(within(dialog).getByLabelText("Start date")).toHaveValue(FUTURE_START);
    await user.clear(amount);
    await user.type(amount, "650");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(section()).getByText(/Pocket money updated: ₹650 every Monday/)).toBeInTheDocument();
    expect(storedDatabase().pocketMoneySchedules[0]).toMatchObject({ amount: 650, version: 2 });
  });

  it("a stale edit (the schedule changed since the dialog opened) is refused with a clear message", async () => {
    const user = userEvent.setup();
    preload(withSchedule());
    renderWith(<ParentContent />);
    await user.click(within(section()).getByRole("button", { name: "Edit" }));
    const dialog = screen.getByRole("dialog", { name: "Edit pocket money" });
    // Another tab changes it meanwhile.
    act(() => {
      sandbox!.actions.updatePocketMoneySchedule({ scheduleId: "pms_ui", expectedVersion: 1, amount: 520 });
    });
    const amount = within(dialog).getByLabelText("Amount");
    await user.clear(amount);
    await user.type(amount, "900");
    await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
    expect(within(dialog).getByRole("alert")).toHaveTextContent(/changed/i);
    expect(storedDatabase().pocketMoneySchedules[0]).toMatchObject({ amount: 520 });
  });

  it("cancel asks first, then ends the schedule and keeps the history", async () => {
    const user = userEvent.setup();
    let s = withSchedule();
    s = must(executeDuePocketMoneyTransition(s, { ...PARENT, at: "2030-01-07T06:00:00Z" }));
    preload(s);
    renderWith(<ParentContent />);

    await user.click(within(section()).getByRole("button", { name: "Cancel schedule" }));
    const confirm = screen.getByRole("dialog", { name: "Cancel pocket money?" });
    await user.click(within(confirm).getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(storedDatabase().pocketMoneySchedules[0]?.status).toBe("active");

    await user.click(within(section()).getByRole("button", { name: "Cancel schedule" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Cancel pocket money?" })).getByRole("button", { name: "Cancel pocket money" }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(within(section()).getByText("Pocket money cancelled. Its history stays below.")).toBeInTheDocument();
    expect(within(section()).getByText("No pocket money scheduled")).toBeInTheDocument();
    const past = screen.getByRole("list", { name: "Past schedules" });
    expect(within(past).getByText(/₹500 · Every Monday — Cancelled/)).toBeInTheDocument();
    expect(within(screen.getByRole("list", { name: "Scheduled transfers" })).getByText("Completed")).toBeInTheDocument();
    expect(storedDatabase().pocketMoneySchedules[0]).toMatchObject({ status: "cancelled", endedReason: "cancelled" });
  });

  it("an insufficient-funds run is shown as not sent, with the reason, never as received", async () => {
    const user = userEvent.setup();
    preload(withSchedule(6000));
    renderWith(<ParentContent />);
    const before = money();
    await user.click(within(section()).getByRole("button", { name: "Process next transfer" }));
    expect(
      within(section()).getAllByText("Pocket money couldn't be sent because the parent's available balance was too low.").length,
    ).toBeGreaterThan(0);
    const history = screen.getByRole("list", { name: "Scheduled transfers" });
    expect(within(history).getByText("Not sent")).toBeInTheDocument();
    expect(within(history).queryByText(/^ALW-/)).not.toBeInTheDocument();
    expect(money()).toEqual(before);
  });
});

describe("teen pocket money — read-only", () => {
  it("a linked teen without a schedule sees that plainly", () => {
    preload(linkedState(), "teen");
    renderWith(<FamilyContent />);
    const card = screen.getByRole("region", { name: "Pocket money" });
    expect(within(card).getByText("No schedule set")).toBeInTheDocument();
  });

  it("shows amount, cadence, parent, status, next date and receipts — with no controls", () => {
    let s = withSchedule();
    s = must(executeDuePocketMoneyTransition(s, { ...PARENT, at: "2030-01-07T06:00:00Z" }));
    // A later occurrence fails (too large): the teen sees "Not sent".
    s = must(
      updatePocketMoneyScheduleTransition(s, {
        ...PARENT,
        at: "2030-01-07T06:00:00Z",
        scheduleId: "pms_ui",
        expectedVersion: s.schedules[0]!.version,
        amount: 9000,
      }),
    );
    s = must(executeDuePocketMoneyTransition(s, { ...PARENT, at: "2030-01-14T06:00:00Z" }));
    preload(s, "teen");
    renderWith(<FamilyContent />);
    const card = screen.getByRole("region", { name: "Pocket money" });
    expect(card).toHaveTextContent("₹9,000 · Every Monday");
    expect(within(card).getByText("Active")).toBeInTheDocument();
    expect(card).toHaveTextContent("Next: Mon, Jan 21 · from Priya");
    const receipts = within(card).getByRole("list", { name: "Recent pocket money" });
    expect(within(receipts).getByText("+₹500")).toBeInTheDocument();
    expect(within(receipts).getByText("Received")).toBeInTheDocument();
    expect(within(receipts).getByText("Not sent")).toBeInTheDocument();
    expect(card).toHaveTextContent("available balance");
    expect(card).not.toHaveTextContent(/balance was too low/);
    // Read-only: no management controls anywhere for the teen.
    for (const name of ["Edit", "Pause", "Resume", "Cancel schedule", "Create pocket money", "Process next transfer"]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("Home shows a compact next pocket money line only when one is scheduled", () => {
    preload(withSchedule(), "teen");
    const { unmount } = renderWith(<HomeContent />);
    const link = screen.getByRole("link", { name: /next pocket money/i });
    expect(link).toHaveAttribute("href", "/family");
    expect(link).toHaveTextContent("₹500 on Mon, Jan 7");
    expect(link).toHaveTextContent("Every Monday");
    unmount();
    preload(linkedState(), "teen");
    renderWith(<HomeContent />);
    expect(screen.queryByRole("link", { name: /next pocket money/i })).not.toBeInTheDocument();
  });
});
