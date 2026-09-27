import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useOptionalAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import type { CoachPeriod, CoachReport } from "@/domain";
import { formatINR } from "@/lib/currency";
import { createAccount } from "@/sandbox/accounts";
import { coachReportFor } from "@/sandbox/coach";
import { spaceBalance, walletBalance } from "@/sandbox/engine";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider, useOptionalSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, SANDBOX_KEY, TEEN_WALLET, linkedDatabase } from "./helpers/fixtures";
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
 * Phase 10 acceptance journey — Money Coach — through the real
 * provider stack, page modules and localStorage (jsdom + Testing
 * Library: an automated UI journey, not a real browser). Real clock:
 * period figures are checked against the engine for "now" and by
 * exact deltas, never against hard-coded dates.
 */
configure({ asyncUtilTimeout: 5000 });

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const save = (next: SandboxDatabase) => window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(next));
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const now = () => new Date().toISOString();

function engine(accountId: string, period: CoachPeriod): CoachReport {
  const r = coachReportFor(db(), accountId, period, now());
  if (!r.ok) throw new Error(r.error.code);
  return r.value;
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

async function go(path: string) {
  act(() => navigate(path));
  await settle();
}

async function signedIn(accountId: string, role: "teen" | "parent", path: string) {
  const service = createSandboxAuthService();
  await service.signIn({ method: "sandbox", accountId, role }, Date.now());
  resetRouter(path);
  const view = render(<TestApp service={service} />);
  await settle();
  return view;
}

/** The value shown for a metric in "Your money at a glance". */
async function metric(label: "Available" | "Set aside" | "Received" | "Spent"): Promise<{ amount: string; note: string }> {
  const glance = await screen.findByRole("region", { name: "Your money at a glance" });
  const dt = within(glance)
    .getAllByRole("term")
    .find((el) => el.firstElementChild?.textContent === label);
  if (!dt) throw new Error(`no metric ${label}`);
  const amount = dt.nextElementSibling!;
  return { amount: amount.textContent ?? "", note: amount.nextElementSibling?.textContent ?? "" };
}

const insightTitles = () =>
  within(screen.getByRole("region", { name: "Insights" }))
    .getAllByRole("heading", { level: 3 })
    .map((h) => h.textContent);

async function amountThenContinue(user: ReturnType<typeof userEvent.setup>, amount: string) {
  await user.type(await screen.findByLabelText("Amount"), amount);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("Phase 10 journey — Money Coach", () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed")));
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("29 steps: figures, periods, payment, pending & declined, incoming, Spaces, determinism, privacy, sign-out", async () => {
    const user = userEvent.setup();
    const consoleError = vi.spyOn(console, "error");
    window.localStorage.clear();
    // Aarav is connected to Priya, who approves payments over ₹500.
    save(linkedDatabase({ threshold: 500 }));

    // 1. Home shows the compact Coach card: this month's headline and the closest goal.
    let view = await signedIn(SEED_TEEN_ID, "teen", "/");
    const card = await screen.findByRole("region", { name: "Money Coach" });
    expect(within(card).getByText(engine(SEED_TEEN_ID, "month").headline)).toBeInTheDocument();
    expect(within(card).getByText("New Bike is 60% complete")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "View insights" })).toHaveAttribute("href", "/coach");

    // 2. The Coach opens, says it's read-only, and defaults to Month.
    await go("/coach");
    expect(await screen.findByRole("heading", { level: 1, name: "Money Coach" })).toBeInTheDocument();
    expect(screen.getByText(/never moves money or changes anything/)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Month" })).toBeChecked();

    // 3. Balances right now: ₹1,850 available, ₹2,300 set aside.
    expect(await metric("Available")).toMatchObject({ amount: "₹1,850" });
    expect(await metric("Set aside")).toMatchObject({ amount: "₹2,300" });

    // 4. Received and Spent for the month match the engine, with the dates shown.
    const month0 = engine(SEED_TEEN_ID, "month").summary;
    expect((await metric("Received")).amount).toBe(formatINR(month0.totalReceived));
    expect((await metric("Spent")).amount).toBe(formatINR(month0.totalSpent));
    expect(screen.getByText(/^Showing this month:/)).toBeInTheDocument();

    // 5. Week: the display changes (keyboard-selectable radio), balances don't.
    await user.click(screen.getByRole("radio", { name: "Week" }));
    expect(screen.getByRole("radio", { name: "Week" })).toBeChecked();
    expect(await screen.findByText(/^Showing this week:/)).toBeInTheDocument();
    const week0 = engine(SEED_TEEN_ID, "week").summary;
    expect((await metric("Spent")).amount).toBe(formatINR(week0.totalSpent));
    expect((await metric("Received")).amount).toBe(formatINR(week0.totalReceived));
    expect(await metric("Available")).toMatchObject({ amount: "₹1,850" });

    // 6. 30 days, via the keyboard (arrow key within the radio group).
    screen.getByRole("radio", { name: "Week" }).focus();
    await user.keyboard("{ArrowRight}{ArrowRight}");
    await waitFor(() => expect(screen.getByRole("radio", { name: "30 days" })).toBeChecked());
    const d30 = engine(SEED_TEEN_ID, "30d").summary;
    expect((await metric("Spent")).amount).toBe(formatINR(d30.totalSpent));
    expect(screen.getByText(/^Showing last 30 days:/)).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Month" }));

    // 7. Insights: balance explanation first, each with a heading and a category in words.
    const titles = insightTitles();
    expect(titles[0]).toBe("You have ₹1,850 available and ₹2,300 set aside.");
    expect(titles).toContain("Your New Bike goal is 60% complete.");
    const insights = screen.getByRole("region", { name: "Insights" });
    expect(within(insights).getAllByText("Balance").length).toBeGreaterThan(0);
    expect(within(insights).getAllByText("Goals").length).toBeGreaterThan(0);

    // 8. Saving goals come from Space progress, spoken and in words.
    const goals = screen.getByRole("region", { name: "Saving goals" });
    const bike = within(goals).getByRole("progressbar", { name: "New Bike, progress toward target" });
    expect(bike).toHaveAttribute("aria-valuetext", "₹1,500 of ₹2,500, 60%");
    expect(within(goals).getByText("₹1,500 of ₹2,500 · ₹1,000 to go")).toBeInTheDocument();
    expect(within(goals).getByRole("link", { name: "View New Bike" })).toHaveAttribute("href", "/money/goal_bike");

    // 9. Learn is anchored; lessons are native disclosures (keyboard-operable <summary>).
    const learn = screen.getByRole("region", { name: "Learn" });
    expect(learn.querySelector("#learn-available-vs-saved")).not.toBeNull();
    const summary = within(learn).getByText("What's the difference between available and saved money?").closest("summary")!;
    expect(summary.closest("details")).not.toHaveAttribute("open");
    await user.click(summary);
    expect(summary.closest("details")).toHaveAttribute("open");

    // 10. No internal ids, no score, no emoji anywhere on the screen.
    const main = document.querySelector("main")!.textContent ?? "";
    expect(main).not.toMatch(/usr_|wal_|fam_|spc_|ope_|apr_/);
    expect(main).not.toMatch(/score|health|grade/i);
    expect(main).not.toMatch(/\p{Extended_Pictographic}/u);

    // 11. Looking at the Coach and switching periods wrote nothing.
    const untouched = JSON.stringify(db());
    await user.click(screen.getByRole("radio", { name: "Week" }));
    await user.click(screen.getByRole("radio", { name: "Month" }));
    expect(JSON.stringify(db())).toBe(untouched);

    // 12. A completed ₹100 payment through the normal Send flow.
    await go("/send?to=meera");
    await amountThenContinue(user, "100");
    await user.click(await screen.findByRole("button", { name: "Send ₹100" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    expect(aarav()).toBe(1750);

    // 13. Coach: Spent up by exactly ₹100; Available ₹1,750; Set aside unchanged.
    await go("/coach");
    expect((await metric("Spent")).amount).toBe(formatINR(month0.totalSpent + 100));
    expect(await metric("Available")).toMatchObject({ amount: "₹1,750" });
    expect(await metric("Set aside")).toMatchObject({ amount: "₹2,300" });
    expect((await metric("Received")).amount).toBe(formatINR(month0.totalReceived));

    // 14. …and one more payment or transfer is counted.
    expect((await metric("Spent")).note).toMatch(
      new RegExp(`^${month0.spendingTransactionCount + 1} payments or transfers`),
    );

    // 15. ₹600 is over Priya's threshold: it waits for approval.
    await go("/send?to=meera");
    await amountThenContinue(user, "600");
    await user.click(await screen.findByRole("button", { name: "Ask Priya to approve" }));
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();

    // 16. Pending isn't spending: Spent and Available unchanged; shown as information.
    await go("/coach");
    expect((await metric("Spent")).amount).toBe(formatINR(month0.totalSpent + 100));
    expect(await metric("Available")).toMatchObject({ amount: "₹1,750" });
    expect(insightTitles()[0]).toBe("₹600 is waiting for approval.");
    const ledgerBeforeDecline = db().ledger.length;
    view.unmount();
    cleanup();

    // 17. Priya declines it.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Decline ₹600 to @meera" }));
    await waitFor(() =>
      expect(db().teenRecords.flatMap((r) => r.approvals).some((a) => a.status === "pending")).toBe(false),
    );
    view.unmount();
    cleanup();

    // 18. Declined still isn't spending; nothing was written to the ledger; the note is gone.
    expect(db().ledger.length).toBe(ledgerBeforeDecline);
    view = await signedIn(SEED_TEEN_ID, "teen", "/coach");
    expect((await metric("Spent")).amount).toBe(formatINR(month0.totalSpent + 100));
    expect(insightTitles()).not.toContain("₹600 is waiting for approval.");
    view.unmount();
    cleanup();

    // 19. Meera sends Aarav ₹150.
    view = await signedIn(SEED_PEER_ID, "teen", "/send?to=aarav");
    await amountThenContinue(user, "150");
    await user.click(await screen.findByRole("button", { name: "Send ₹150" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 20. Aarav: Received up by exactly ₹150 (from people); Spent unchanged.
    view = await signedIn(SEED_TEEN_ID, "teen", "/coach");
    const received = await metric("Received");
    expect(received.amount).toBe(formatINR(month0.totalReceived + 150));
    expect(received.note).toContain("From people ₹150");
    expect((await metric("Spent")).amount).toBe(formatINR(month0.totalSpent + 100));
    expect(await metric("Available")).toMatchObject({ amount: "₹1,900" });

    // 21. He moves ₹200 into Save from Money.
    await go("/money");
    await user.click(await screen.findByRole("button", { name: "Add to Save" }));
    const add = await screen.findByRole("dialog", { name: "Add to Save" });
    await user.type(within(add).getByLabelText("Amount"), "200");
    await user.click(within(add).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(1000));

    // 22. Coach: Set aside ₹2,500, Available ₹1,700; not spending, not income.
    await go("/coach");
    expect(await metric("Set aside")).toMatchObject({ amount: "₹2,500" });
    expect(await metric("Available")).toMatchObject({ amount: "₹1,700" });
    expect((await metric("Spent")).amount).toBe(formatINR(month0.totalSpent + 100));
    expect((await metric("Received")).amount).toBe(formatINR(month0.totalReceived + 150));
    expect(within(screen.getByRole("region", { name: "Saving goals" })).getByRole("progressbar", { name: "Save, progress toward target" })).toHaveAttribute(
      "aria-valuetext",
      "₹1,000 of ₹2,000, 50%",
    );

    // 23. Deterministic: a fresh load shows the same figures and insights; the engine agrees.
    const shown = { titles: insightTitles(), spent: (await metric("Spent")).amount };
    view.unmount();
    cleanup();
    view = await signedIn(SEED_TEEN_ID, "teen", "/coach");
    expect(insightTitles()).toEqual(shown.titles);
    expect((await metric("Spent")).amount).toBe(shown.spent);
    expect(coachReportFor(structuredClone(db()), SEED_TEEN_ID, "month", now())).toEqual(
      coachReportFor(db(), SEED_TEEN_ID, "month", now()),
    );
    view.unmount();
    cleanup();

    // 24. No network, no console errors along the way.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();

    // 25. After sign-out, a stale screen gets no Coach data.
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, Date.now());
    let auth: AuthContextValue | null = null;
    let live: SandboxContextValue | null = null;
    function CaptureBoth() {
      auth = useOptionalAuth();
      live = useOptionalSandbox();
      return null;
    }
    view = render(
      <AuthProvider service={service}>
        <SandboxProvider>
          <CaptureBoth />
        </SandboxProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(live).not.toBeNull());
    const stale = live!.actions;
    expect(stale.coachReport("month").ok).toBe(true);
    act(() => auth!.signOut("user"));
    await waitFor(() => expect(live).toBeNull());
    for (const period of ["week", "month", "30d"] as const) {
      expect(stale.coachReport(period)).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    }
    view.unmount();
    cleanup();

    // 26. Signed out, /coach goes to sign-in.
    resetRouter("/coach");
    view = render(<TestApp service={createSandboxAuthService()} />);
    await settle();
    await waitFor(() => expect(nav.url).toMatch(/^\/sign-in/));
    view.unmount();
    cleanup();

    // 27. Priya (parent) gets no Coach and none of Aarav's figures.
    view = await signedIn(SEED_PARENT_ID, "parent", "/coach");
    expect(await screen.findByRole("heading", { level: 1, name: /This is .*'s space/ })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your money at a glance" })).not.toBeInTheDocument();
    expect(screen.queryByText(/set aside ₹/)).not.toBeInTheDocument();
    view.unmount();
    cleanup();

    // 28. Meera sees only her own money.
    view = await signedIn(SEED_PEER_ID, "teen", "/coach");
    const meera = engine(SEED_PEER_ID, "month").summary;
    expect(await metric("Available")).toMatchObject({ amount: formatINR(meera.availableBalance) });
    expect(document.querySelector("main")!.textContent).not.toMatch(/New Bike|₹1,700|₹2,500/);
    view.unmount();
    cleanup();

    // 29. A brand-new teen gets the welcome state.
    const made = createAccount(db(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    save(made.db);
    view = await signedIn(made.account.id, "teen", "/coach");
    expect(await screen.findByText("Your Money Coach is getting to know your money.")).toBeInTheDocument();
    expect(screen.getByText("Make a few transactions to see insights here.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your money at a glance" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Learn" })).toBeInTheDocument();
    view.unmount();
    cleanup();
    expect(fetchSpy).not.toHaveBeenCalled();
    consoleError.mockRestore();
  }, 180_000);
});
