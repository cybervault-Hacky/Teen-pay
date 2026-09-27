import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useOptionalAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider, useOptionalSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, SANDBOX_KEY, linkedDatabase } from "./helpers/fixtures";
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
 * Money Missions (Phase 11) — UI through the real provider stack and
 * page modules (jsdom + Testing Library, not a real browser).
 */
configure({ asyncUtilTimeout: 5000 });

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const save = (next: SandboxDatabase) => window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(next));

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

const main = () => document.querySelector("main")!;

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("/missions — the list", () => {
  it("shows every mission by category with status, time and progress in words", async () => {
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions");
    expect(await screen.findByRole("heading", { level: 1, name: "Money Missions" })).toBeInTheDocument();
    expect(screen.getByText("Short, optional lessons and challenges about your own money. They never move money.")).toBeInTheDocument();
    const progress = screen.getByRole("region", { name: "Your progress" });
    expect(within(progress).getByText("0 of 10 completed")).toBeInTheDocument();
    expect(within(progress).getByRole("link", { name: /Explore: Know Your Balance/ })).toHaveAttribute(
      "href",
      "/missions/know-your-balance",
    );
    for (const category of ["Money basics", "Save", "Explore", "Safety"]) {
      expect(screen.getByRole("region", { name: category })).toBeInTheDocument();
    }
    const links = within(main()).getAllByRole("link").filter((a) => a.getAttribute("href")?.startsWith("/missions/"));
    expect(new Set(links.map((a) => a.getAttribute("href"))).size).toBe(10);
    const kyb = within(screen.getByRole("region", { name: "Money basics" })).getByRole("link", { name: /Know Your Balance/ });
    expect(kyb).toHaveTextContent("Not started");
    expect(kyb).toHaveTextContent("About 3 min · 3 steps");
    // No percentages, points, streaks or rewards (only the promise that there are none).
    const disclaimer = "They never move money, give rewards or change your limits";
    expect(screen.getByText(new RegExp(disclaimer))).toBeInTheDocument();
    expect(main().textContent!.replace(disclaimer, "")).not.toMatch(/%|points|streak|reward/i);
  });

  it("marks a locked mission in words (brand-new teen with no transactions)", async () => {
    const made = createAccount(buildSeedDatabase(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    save(made.db);
    await signedIn(made.account.id, "teen", "/missions");
    const card = await screen.findByRole("link", { name: /Review a Transaction/ });
    expect(card).toHaveTextContent("Locked");
    await go("/missions/review-transaction");
    expect(await screen.findByRole("heading", { level: 2, name: "Locked for now" })).toBeInTheDocument();
    expect(screen.getByText(/Available after your first transaction/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start mission" })).not.toBeInTheDocument();
  });
});

describe("/missions/[id] — a mission", () => {
  it("start → read → gentle check → complete, with focus following the step", async () => {
    const user = userEvent.setup();
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions/know-your-balance");
    expect(await screen.findByRole("heading", { level: 1, name: "Know Your Balance" })).toBeInTheDocument();
    const steps = screen.getByRole("region", { name: "Steps" });
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    expect(within(steps).getAllByText("Not yet")).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Start mission" }));
    const step1 = await screen.findByRole("heading", { level: 2, name: "Your balance is a total" });
    expect(step1).toHaveFocus();
    expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
    expect(within(steps).getByText("Current step")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Total and available" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Quick check" })).toHaveFocus();

    const check = screen.getByRole("button", { name: "Check answer" });
    expect(check).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: "It goes down straight away" }));
    await user.click(check);
    expect(screen.getByRole("status")).toHaveTextContent(/^Not quite\./);
    expect(db().missionProgress?.[0]?.stepsCompleted).toBe(2); // a wrong answer records nothing

    await user.click(screen.getByRole("radio", { name: "It stays the same until the payment completes" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^That's right\./);
    await user.click(screen.getByRole("button", { name: "Complete mission" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Mission completed" })).toHaveFocus();
    expect(screen.getByText("You know how your balance is worked out.")).toBeInTheDocument();
    expect(screen.getByText(/^Completed on /)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next: / })).toBeInTheDocument();
    expect(within(steps).getAllByText("Done")).toHaveLength(2 + 1);
    expect(db().missionProgress?.[0]).toMatchObject({ missionId: "know-your-balance", stepsCompleted: 3 });
  });

  it("an unknown mission id is a calm not-found, and creates nothing", async () => {
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions/free-money");
    expect(await screen.findByText("We couldn't find that mission")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All missions" })).toHaveAttribute("href", "/missions");
    expect(db().missionProgress).toBeUndefined();
  });

  it("evidence step: no Continue until the Space exists; the action links to the usual screen", async () => {
    const user = userEvent.setup();
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions/build-a-space");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Create a Space" })).toBeInTheDocument();
    expect(screen.getByText("You don't have a Space of your own yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete mission" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open Money Spaces" })).toHaveAttribute("href", "/money?mission=build-a-space");
  });
});

describe("notices on existing screens", () => {
  it("Activity: the visit step is marked done there, then back to the mission", async () => {
    const user = userEvent.setup();
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions/explore-spending");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("link", { name: "Review Activity" })).toHaveAttribute(
      "href",
      "/activity?mission=explore-spending",
    );
    await go("/activity?mission=explore-spending");
    const notice = await screen.findByRole("region", { name: "Mission step" });
    expect(notice).toHaveTextContent("Mission · Explore Your Spending");
    expect(screen.getByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    await user.click(within(notice).getByRole("button", { name: "Mark step done" }));
    await waitFor(() => expect(nav.url).toBe("/missions/explore-spending"));
    expect(await screen.findByRole("heading", { level: 2, name: "Mission completed" })).toBeInTheDocument();
  });

  it("Activity: reviewing a transaction needs a transaction opened first", async () => {
    const user = userEvent.setup();
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions/review-transaction");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await go("/activity?mission=review-transaction");
    const notice = await screen.findByRole("region", { name: "Mission step" });
    const mark = within(notice).getByRole("button", { name: "Mark step done" });
    expect(mark).toBeDisabled();
    expect(notice).toHaveTextContent("Open any transaction below to see its details first.");
    await user.click(screen.getAllByRole("button", { name: /open details/i })[0]!);
    await screen.findByRole("dialog");
    await waitFor(() => expect(within(notice).getByRole("button", { name: "Mark step done" })).toBeEnabled());
  });

  it("Coach: the lesson step unlocks once a lesson is opened", async () => {
    const user = userEvent.setup();
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions/learn-from-coach");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await go("/coach?mission=learn-from-coach");
    expect(await screen.findByRole("heading", { level: 1, name: "Money Coach" })).toBeInTheDocument();
    const notice = screen.getByRole("region", { name: "Mission step" });
    expect(within(notice).getByRole("button", { name: "Mark step done" })).toBeDisabled();
    const learn = screen.getByRole("region", { name: "Learn" });
    await user.click(within(learn).getAllByRole("listitem")[0]!.querySelector("summary")!);
    await waitFor(() => expect(within(notice).getByRole("button", { name: "Mark step done" })).toBeEnabled());
  });

  it("Money: the evidence step's note shows the live fact", async () => {
    const user = userEvent.setup();
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/missions/set-saving-goal");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await go("/money?mission=set-saving-goal");
    const notice = await screen.findByRole("region", { name: "Mission step" });
    expect(notice).toHaveTextContent("Your goal New Bike has a ₹2,500 target.");
    expect(within(notice).getByRole("link", { name: "Back to mission" })).toHaveAttribute("href", "/missions/set-saving-goal");
  });

  it("an unknown or missing mission parameter shows nothing extra", async () => {
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/activity?mission=nope");
    expect(await screen.findByRole("heading", { level: 1, name: "Activity" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Mission step" })).not.toBeInTheDocument();
    await go("/money");
    expect(await screen.findByRole("heading", { level: 1, name: "Your money" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Mission step" })).not.toBeInTheDocument();
  });
});

describe("Home and Profile", () => {
  it("Home shows the count and the next mission; it becomes 'Continue learning' once started", async () => {
    const user = userEvent.setup();
    save(buildSeedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/");
    let card = await screen.findByRole("region", { name: "Money Missions" });
    expect(within(card).getByText("0 of 10 completed")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: /Up next.*Know Your Balance/ })).toHaveAttribute(
      "href",
      "/missions/know-your-balance",
    );
    expect(within(card).getByRole("link", { name: "All missions" })).toHaveAttribute("href", "/missions");

    await go("/missions/payment-safety");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await go("/");
    card = await screen.findByRole("region", { name: "Money Missions" });
    expect(within(card).getByRole("link", { name: /Continue learning.*Payment Safety.*Step 1 of 4/ })).toBeInTheDocument();
  });

  it("Profile has a Learn section for teens, and none for parents", async () => {
    save(linkedDatabase());
    let view = await signedIn(SEED_TEEN_ID, "teen", "/profile");
    const learn = await screen.findByRole("region", { name: "Learn" });
    expect(within(learn).getByRole("link", { name: /Money Coach/ })).toHaveAttribute("href", "/coach");
    expect(within(learn).getByRole("link", { name: /Money Missions.*0 of 10 completed/ })).toHaveAttribute("href", "/missions");
    view.unmount();
    cleanup();
    view = await signedIn(SEED_PARENT_ID, "parent", "/profile");
    expect(await screen.findByRole("region", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Learn" })).not.toBeInTheDocument();
    expect(main().textContent).not.toMatch(/of 10 completed/);
    view.unmount();
  });
});

describe("access", () => {
  it("a parent sees the teen-only gate on /missions and a mission page — no progress", async () => {
    let base = linkedDatabase();
    base = { ...base, missionProgress: [{ ownerAccountId: SEED_TEEN_ID, missionId: "know-your-balance", stepsCompleted: 1, startedAt: AT, updatedAt: AT }] };
    save(base);
    for (const path of ["/missions", "/missions/know-your-balance"]) {
      const view = await signedIn(SEED_PARENT_ID, "parent", path);
      expect(await screen.findByRole("heading", { level: 1, name: /This is .*'s space/ })).toBeInTheDocument();
      expect(main().textContent).not.toMatch(/Know Your Balance|of 10 completed|Step 2 of 3/);
      view.unmount();
      cleanup();
    }
    expect(db().missionProgress).toHaveLength(1);
  });

  it("signed out, /missions and a mission page go to sign-in", async () => {
    for (const path of ["/missions", "/missions/know-your-balance"]) {
      resetRouter(path);
      const view = render(<TestApp service={createSandboxAuthService()} />);
      await settle();
      await waitFor(() => expect(nav.url).toMatch(/^\/sign-in/));
      view.unmount();
      cleanup();
    }
  });

  it("stale actions after sign-out refuse to read or write missions", async () => {
    save(buildSeedDatabase());
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, Date.now());
    let live: SandboxContextValue | null = null;
    let auth: AuthContextValue | null = null;
    function Capture() {
      live = useOptionalSandbox();
      auth = useOptionalAuth();
      return null;
    }
    const view = render(
      <AuthProvider service={service}>
        <SandboxProvider>
          <Capture />
        </SandboxProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(live).not.toBeNull());
    const stale = live!.actions;
    expect(stale.missionBoard().ok).toBe(true);
    act(() => auth!.signOut("user"));
    await waitFor(() => expect(live).toBeNull());
    expect(stale.missionBoard()).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(stale.startMission("know-your-balance")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(stale.advanceMission("know-your-balance", "total")).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(db().missionProgress).toBeUndefined();
    view.unmount();
  });

  it("corrupt stored missions don't crash: the sandbox recovers and missions start fresh", async () => {
    const bad = { ...buildSeedDatabase(), missionProgress: [{ ownerAccountId: SEED_TEEN_ID, missionId: "know-your-balance", stepsCompleted: 42 }] };
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(bad));
    await signedIn(SEED_TEEN_ID, "teen", "/missions");
    expect(await screen.findByText("0 of 10 completed")).toBeInTheDocument();
  });
});
