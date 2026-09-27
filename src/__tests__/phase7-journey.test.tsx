import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { firstOccurrenceOnOrAfter, nextOccurrenceAfter, productDay } from "@/domain";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { executeDuePocketMoneyTransition } from "@/sandbox/allowance-transitions";
import { spaceBalance, walletBalance } from "@/sandbox/engine";
import { databaseFromState } from "@/sandbox/persistence";
import { scopeFor } from "@/sandbox/scope";
import { SEED_PARENT_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { formatDateKey } from "@/lib/format";
import { TestApp } from "./helpers/app";
import { AT, PARENT_WALLET, SANDBOX_KEY, TEEN_WALLET, linkedState } from "./helpers/fixtures";
import { nav, navigate, resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

/**
 * Phase 7 acceptance journey through the real provider stack
 * (AuthProvider → SandboxProvider → AppShell/AuthGate), the real page
 * modules and localStorage. jsdom + Testing Library — an automated UI
 * journey, not a real browser. Runs on the real clock: dates are
 * computed from "today" rather than hard-coded.
 */
configure({ asyncUtilTimeout: 5000 });

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const priya = () => walletBalance(db().ledger, PARENT_WALLET);
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const scheduledOps = () => db().operations.filter((op) => op.scheduleId);

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

async function go(path: string) {
  act(() => navigate(path));
  await settle();
}

async function closedDialog() {
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
}

const pocketMoney = () => screen.getByRole("region", { name: "Pocket money" });

describe("Phase 7 journey — Pocket Money Autopilot", () => {
  it("28 steps: create, execute once, repeat safely, pause/resume, Spaces, reload, isolation", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    // Aarav and Priya are already connected (Phase 4 flow).
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(databaseFromState(linkedState())));
    const weekly = { frequency: "weekly" as const, dayOfWeek: 1, dayOfMonth: 1 };
    const firstDay = firstOccurrenceOnOrAfter(weekly, productDay(new Date().toISOString()));
    const secondDay = nextOccurrenceAfter(weekly, firstDay);
    const thirdDay = nextOccurrenceAfter(weekly, secondDay);

    // 1. Priya signs in (sandbox parent).
    resetRouter("/sign-in");
    const first = render(<TestApp />);
    await user.click(await screen.findByRole("button", { name: /continue as parent/i }));
    await waitFor(() => expect(nav.url).not.toBe("/sign-in"));
    await settle();

    // 2. Her balance before anything: ₹5,500; Aarav ₹1,850 available.
    expect(priya()).toBe(5500);
    expect(aarav()).toBe(1850);

    // 3. The parent page shows Aarav as linked, with no schedule yet.
    await go("/parent");
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(within(pocketMoney()).getByText("No pocket money scheduled")).toBeInTheDocument();

    // 4. Open "Create pocket money".
    await user.click(within(pocketMoney()).getByRole("button", { name: "Create pocket money" }));
    const create = await screen.findByRole("dialog", { name: "Create pocket money" });

    // 5. ₹500 weekly on Monday (the defaults), preview checked.
    expect(within(create).getByLabelText("Amount")).toHaveValue("500");
    const preview = within(create).getByRole("region", { name: "Preview" });
    expect(preview).toHaveTextContent("₹500");
    expect(preview).toHaveTextContent("Every Monday");
    expect(preview).toHaveTextContent("Priya's wallet");
    expect(preview).toHaveTextContent("Aarav's wallet");
    expect(preview).toHaveTextContent(`First transfer${formatDateKey(firstDay)}`);
    expect(preview).toHaveTextContent(`Next transfer${formatDateKey(secondDay)}`);
    expect(preview).toHaveTextContent("Nothing moves now");

    // 6. Create it (double click — one schedule).
    await user.dblClick(within(create).getByRole("button", { name: "Create pocket money" }));
    await closedDialog();
    expect(db().pocketMoneySchedules).toHaveLength(1);

    // 7. Active, with the next occurrence, and nothing moved.
    expect(within(pocketMoney()).getByText("Active")).toBeInTheDocument();
    expect(within(pocketMoney()).getAllByText(formatDateKey(firstDay)).length).toBeGreaterThan(0);
    expect(within(pocketMoney()).getByText("Your wallet · ₹5,500 available")).toBeInTheDocument();
    expect(priya()).toBe(5500);
    expect(aarav()).toBe(1850);

    // 8. Execute the first transfer day (sandbox control — no timer).
    await user.click(within(pocketMoney()).getByRole("button", { name: "Process next transfer" }));
    expect(
      await within(pocketMoney()).findByText(new RegExp(`Sent ₹500 to Aarav for ${formatDateKey(firstDay)} · ALW-`)),
    ).toBeInTheDocument();

    // 9. Priya −₹500, Aarav +₹500; money conserved.
    expect(priya()).toBe(5000);
    expect(aarav()).toBe(2350);
    expect(priya() + aarav()).toBe(5500 + 1850);

    // 10. Exactly one ALW operation, both legs posted.
    expect(scheduledOps()).toHaveLength(1);
    const op = scheduledOps()[0]!;
    expect(op.reference).toMatch(/^ALW-[0-9A-Z]{8}$/);
    expect(db().ledger.filter((e) => e.operationId === op.id)).toHaveLength(2);

    // 11. Notifications: sent (Priya), received (Aarav) — once each.
    const notes = db().notifications;
    expect(notes.filter((n) => n.title === "Pocket money sent" && n.recipientId === SEED_PARENT_ID)).toHaveLength(1);
    expect(
      notes.filter((n) => n.title === "Pocket money received" && n.id.startsWith("ntf_evt_pm_paid_")),
    ).toHaveLength(1);

    // 12. Parent history shows amount, teen, date, status and reference.
    const history = screen.getByRole("list", { name: "Scheduled transfers" });
    expect(within(history).getByText("₹500 to Aarav")).toBeInTheDocument();
    expect(within(history).getByText(op.reference)).toBeInTheDocument();
    expect(within(history).getByText("Completed")).toBeInTheDocument();

    // 13. Repeat the same occurrence (a stale caller): nothing new.
    const stored = db();
    const view = scopeFor(stored, SEED_PARENT_ID)!.state;
    const repeat = executeDuePocketMoneyTransition(view, {
      actorId: SEED_PARENT_ID,
      asOf: `${firstDay}T12:00:00Z`,
      scheduleId: stored.pocketMoneySchedules[0]!.id,
    });
    expect(repeat.state).toBe(view);
    expect(scheduledOps()).toHaveLength(1);

    // 14. Pause: the process control disappears; the schedule stays visible.
    await user.click(within(pocketMoney()).getByRole("button", { name: "Pause" }));
    expect(await within(pocketMoney()).findByText("Paused — resume to continue")).toBeInTheDocument();
    expect(within(pocketMoney()).queryByRole("button", { name: "Process next transfer" })).not.toBeInTheDocument();

    // 15. Execution is blocked while paused (engine check).
    const paused = scopeFor(db(), SEED_PARENT_ID)!.state;
    const blocked = executeDuePocketMoneyTransition(paused, { actorId: SEED_PARENT_ID, asOf: `${thirdDay}T12:00:00Z` });
    expect(blocked.state).toBe(paused);
    expect(priya()).toBe(5000);

    // 16. Resume: the next valid occurrence is scheduled.
    await user.click(within(pocketMoney()).getByRole("button", { name: "Resume" }));
    expect(await within(pocketMoney()).findByText(/Pocket money resumed\. Next transfer/)).toBeInTheDocument();
    const next = db().pocketMoneySchedules[0]!;
    expect(next.status).toBe("active");

    // 17. Execute the next occurrence.
    await user.click(within(pocketMoney()).getByRole("button", { name: "Process next transfer" }));
    expect(await within(pocketMoney()).findByText(/Sent ₹500 to Aarav for .* · ALW-/)).toBeInTheDocument();

    // 18. Balances after two transfers.
    expect(priya()).toBe(4500);
    expect(aarav()).toBe(2850);
    expect(scheduledOps()).toHaveLength(2);
    first.unmount();
    cleanup();

    // 19. Aarav signs in.
    const teenService = createSandboxAuthService();
    await teenService.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, Date.now());
    resetRouter("/family");
    const second = render(<TestApp service={teenService} />);
    await settle();

    // 20. Family shows the schedule read-only with his receipts.
    const card = await screen.findByRole("region", { name: "Pocket money" });
    expect(card).toHaveTextContent("₹500 · Every Monday");
    expect(card).toHaveTextContent("from Priya");
    expect(within(within(card).getByRole("list", { name: "Recent pocket money" })).getAllByText("Received")).toHaveLength(2);
    expect(within(card).queryByRole("button", { name: /pause|edit|cancel/i })).not.toBeInTheDocument();

    // 21. Activity lists both receipts from the same ledger.
    await go("/activity");
    const rows = await screen.findAllByRole("button", { name: /Pocket money received.*open details/i });
    expect(rows).toHaveLength(2);

    // 22. Detail: +₹500, ALW reference, Completed, scheduled day.
    await user.click(rows[rows.length - 1]!);
    const detail = await screen.findByRole("dialog");
    expect(within(detail).getByText(op.reference)).toBeInTheDocument();
    expect(within(detail).getAllByText("Completed").length).toBeGreaterThan(0);
    expect(within(detail).getByText("Scheduled for")).toBeInTheDocument();
    expect(within(detail).getByText(formatDateKey(firstDay))).toBeInTheDocument();
    await user.keyboard("{Escape}");
    await closedDialog();

    // 23. Move ₹300 of it into Save.
    await go("/money");
    await user.click(await screen.findByRole("button", { name: "Add to Save" }));
    const add = await screen.findByRole("dialog", { name: "Add to Save" });
    await user.type(within(add).getByLabelText("Amount"), "300");
    await user.click(within(add).getByRole("button", { name: "Confirm" }));
    await closedDialog();

    // 24. Pocket money and Spaces stay separate records.
    expect(aarav()).toBe(2550);
    expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(1100);
    expect(db().ledger.filter((e) => e.scheduleId && e.spaceId)).toHaveLength(0);
    expect(scheduledOps()).toHaveLength(2);
    const entriesBeforeReload = db().ledger.length;
    second.unmount();
    cleanup();

    // 25. Reload the whole app.
    resetRouter("/family");
    const third = render(<TestApp service={teenService} />);
    await settle();

    // 26. Everything persisted — no duplicate or automatic runs.
    expect(await screen.findByRole("region", { name: "Pocket money" })).toHaveTextContent("₹500 · Every Monday");
    expect(db().ledger.length).toBe(entriesBeforeReload);
    expect(db().pocketMoneySchedules[0]!.runs).toHaveLength(2);
    expect(priya()).toBe(4500);
    expect(aarav()).toBe(2550);
    third.unmount();
    cleanup();

    // 27. An unrelated parent can't see the schedule…
    const made = createAccount(db(), { role: "parent", displayName: "Neha Rao", username: "neharao" }, AT);
    if ("code" in made) throw new Error(made.message);
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(made.db));
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: made.account.id, role: "parent" }, Date.now());
    resetRouter("/parent");
    render(<TestApp service={service} />);
    await settle();
    expect(await screen.findByText("No teen connected yet")).toBeInTheDocument();
    expect(screen.queryByText("Pocket money to Aarav")).not.toBeInTheDocument();
    expect(scopeFor(db(), made.account.id)!.state.schedules).toEqual([]);

    // 28. …or execute it; nothing changes.
    const before = JSON.stringify([db().ledger, db().operations, db().pocketMoneySchedules]);
    const outsider = scopeFor(db(), made.account.id)!.state;
    const attempt = executeDuePocketMoneyTransition(outsider, {
      actorId: made.account.id,
      asOf: "2030-01-01T00:00:00Z",
      scheduleId: db().pocketMoneySchedules[0]!.id,
    });
    expect(attempt.result.ok).toBe(false);
    expect(JSON.stringify([db().ledger, db().operations, db().pocketMoneySchedules])).toBe(before);
  }, 60_000);
});
