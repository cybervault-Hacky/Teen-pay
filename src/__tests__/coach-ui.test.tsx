import { act, cleanup, configure, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { deriveCoachReport, coachWindows, type CoachGoal, type CoachReport } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import { coachReportFor } from "@/sandbox/coach";
import { buildSeedDatabase, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxResult } from "@/sandbox/types";
import { CoachGoals } from "@/components/coach/coach-goals";
import { InsightCard } from "@/components/coach/insight-card";
import { SpendingCompare } from "@/components/coach/spending-compare";
import { TestApp } from "./helpers/app";
import { AT, SANDBOX_KEY } from "./helpers/fixtures";
import { resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

/** Lets a test replace the hook's result (error fallback); real by default. */
const override: { result: SandboxResult<CoachReport> | null; throws: boolean } = { result: null, throws: false };
vi.mock("@/components/coach/use-coach", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/components/coach/use-coach")>();
  return {
    useCoachReport: (period: Parameters<typeof real.useCoachReport>[0]) => {
      const live = real.useCoachReport(period);
      if (override.throws) throw new Error("boom");
      return override.result ?? live;
    },
  };
});

configure({ asyncUtilTimeout: 5000 });

const NOW = "2026-09-27T10:00:00Z";

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

async function open(path: string, accountId = SEED_TEEN_ID, role: "teen" | "parent" = "teen") {
  const service = createSandboxAuthService();
  await service.signIn({ method: "sandbox", accountId, role }, Date.now());
  resetRouter(path);
  const view = render(<TestApp service={service} />);
  await settle();
  return view;
}

afterEach(() => {
  override.result = null;
  override.throws = false;
  cleanup();
  window.localStorage.clear();
});

describe("Money Coach screen", () => {
  it("has one h1, labelled sections in order, and a keyboard radio group", async () => {
    await open("/coach");
    expect(screen.getAllByRole("heading", { level: 1 }).map((h) => h.textContent)).toEqual(["Money Coach"]);
    const labels = screen
      .getAllByRole("region")
      .map((r) => r.getAttribute("aria-label"))
      .filter((l) => ["Your money at a glance", "Insights", "Saving goals", "How these numbers work", "Learn"].includes(l ?? ""));
    expect(labels).toEqual(["Your money at a glance", "Insights", "Saving goals", "How these numbers work", "Learn"]);
    const group = screen.getByRole("group", { name: "Period" });
    expect(within(group).getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual(["week", "month", "30d"]);
    expect(within(group).getByRole("radio", { name: "Month" })).toBeChecked();
    // The period status is announced politely.
    expect(screen.getByText(/^Showing this month:/)).toHaveAttribute("aria-live", "polite");
  });

  it("labels every metric with what it is and when", async () => {
    await open("/coach");
    const glance = screen.getByRole("region", { name: "Your money at a glance" });
    const terms = within(glance).getAllByRole("term").map((t) => t.textContent);
    expect(terms[0]).toBe("Available, Now");
    expect(terms[1]).toBe("Set aside, Now");
    expect(terms[2]).toMatch(/^Received, [A-Z][a-z]{2} \d/);
    expect(terms[3]).toMatch(/^Spent, [A-Z][a-z]{2} \d/);
    expect(within(glance).getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/activity");
  });

  it("explains the definitions and that it's read-only; has no money controls", async () => {
    await open("/coach");
    const how = screen.getByRole("region", { name: "How these numbers work" });
    expect(within(how).getByText(/Pending, declined or failed payments aren't counted/)).toBeInTheDocument();
    expect(within(how).getByText(/Refunds aren't counted as money received/)).toBeInTheDocument();
    expect(within(how).getByText(/If nothing was received, there isn't enough data for a rate/)).toBeInTheDocument();
    expect(within(how).getByText(/Dates are in India time/)).toBeInTheDocument();
    expect(within(how).getByText(/doesn't move money, approve payments, change limits or give investment advice/)).toBeInTheDocument();
    const main = document.querySelector("main")!;
    const buttons = within(main).queryAllByRole("button").map((b) => b.textContent);
    expect(buttons.filter((b) => /pay|send|approve|decline|add|move|limit|freeze|transfer/i.test(b ?? ""))).toEqual([]);
    // Every link stays in the app.
    for (const link of within(main).getAllByRole("link")) {
      expect(link.getAttribute("href")).toMatch(/^(\/|#learn-)/);
    }
  });

  it("new teen: welcome state on /coach and on the Home card", async () => {
    const made = createAccount(buildSeedDatabase(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(made.db));
    await open("/coach", made.account.id);
    expect(screen.getByText("Your Money Coach is getting to know your money.")).toBeInTheDocument();
    expect(screen.getByText("Make a few transactions to see insights here.")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Period" })).not.toBeInTheDocument();
    cleanup();
    await open("/", made.account.id);
    const card = screen.getByRole("region", { name: "Money Coach" });
    expect(within(card).getByText("Your Money Coach is getting to know your money.")).toBeInTheDocument();
    expect(within(card).queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("falls back safely when the report isn't available — no crash, no internals", async () => {
    override.result = { ok: false, error: { code: "not_signed_in", message: "internal detail wal_usr_aarav" } };
    await open("/coach");
    expect(screen.getByText("Money Coach isn't available right now")).toBeInTheDocument();
    expect(screen.getByText("Nothing was changed. Try again in a moment.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/wal_usr_aarav|internal detail/);
    // Home simply leaves the card out.
    cleanup();
    await open("/");
    expect(screen.queryByRole("region", { name: "Money Coach" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Recent activity" })).toBeInTheDocument();
  });
});

describe("Coach parts", () => {
  const seedReport = (period: "week" | "month") => {
    const r = coachReportFor(buildSeedDatabase(), SEED_TEEN_ID, period, NOW);
    if (!r.ok) throw new Error("no report");
    return r.value;
  };

  it("the spending chart is zero-based and has a text alternative", () => {
    render(<SpendingCompare summary={seedReport("week").summary} />);
    const figure = screen.getByRole("figure", { name: "Spending compared" });
    expect(within(figure).getByText("This period (Sep 21–27)")).toBeInTheDocument();
    expect(within(figure).getByText("Before (Sep 14–20)")).toBeInTheDocument();
    expect(within(figure).getByText("₹350")).toBeInTheDocument();
    expect(within(figure).getByText("₹0")).toBeInTheDocument();
    for (const bar of figure.querySelectorAll("[aria-hidden] > div")) {
      expect((bar as HTMLElement).style.width).toMatch(/^(100|0)%$/);
    }
    cleanup();
    // Not comparable → no chart at all.
    const { container } = render(<SpendingCompare summary={seedReport("month").summary} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("an insight shows its category in words and a navigation-only action", () => {
    const insight = seedReport("month").insights.find((i) => i.kind === "goal_progress")!;
    render(<InsightCard insight={insight} headingId="h1" />);
    expect(screen.getByRole("article", { name: "Your New Bike goal is 60% complete." })).toBeInTheDocument();
    expect(screen.getByText("Goals")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View New Bike" })).toHaveAttribute("href", "/money/goal_bike");
    cleanup();
    const lesson = seedReport("month").insights.find((i) => i.kind === "lesson")!;
    render(<InsightCard insight={lesson} headingId="h2" />);
    expect(screen.getByText("Learn")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Read more in Learn" }).getAttribute("href")).toMatch(/^#learn-/);
  });

  it("goals: reached is said in words, not just colour; no goals → an empty state", () => {
    const reached: CoachGoal = { name: "Trip", type: "goal", href: "/money/trip", balance: 3000, target: 3000, percent: 100, remaining: 0, reached: true, deadline: "2026-10-01", daysLeft: 4, deadlineState: "upcoming" };
    render(<CoachGoals goals={[reached]} />);
    expect(screen.getByText("Target reached · ₹3,000")).toBeInTheDocument();
    expect(screen.getByText("Target date Oct 1, 2026 · 4 days left")).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Trip, progress toward target" })).toHaveAttribute("aria-valuetext", "₹3,000 of ₹3,000, 100%");
    cleanup();
    render(<CoachGoals goals={[]} />);
    expect(screen.getByText("No saving goals yet")).toBeInTheDocument();
  });

  it("the report is plain data (no functions) and the lowData flag drives the caption", () => {
    const report = deriveCoachReport({
      period: "week",
      windows: coachWindows("week", NOW),
      hasHistory: true,
      canCompare: false,
      available: 10,
      setAside: 0,
      total: 10,
      current: { spent: 0, spendingCount: 0, payments: 0, transfers: 0, refunded: 0, received: { pocketMoney: 10, fromPeople: 0, sandbox: 0, total: 10 }, pocketMoneyCount: 1, movedToSpaces: 0, movedFromSpaces: 0 },
      previous: null,
      goals: [],
      pendingApprovals: { count: 0, amount: 0 },
      nextPocketMoney: null,
    });
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(report.lowData).toBe(true);
  });
});
