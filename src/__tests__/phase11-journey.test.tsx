import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { walletBalance } from "@/sandbox/engine";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { SANDBOX_KEY, TEEN_WALLET, linkedDatabase } from "./helpers/fixtures";
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
 * Phase 11 acceptance journey — Money Missions — through the real
 * provider stack, page modules and localStorage (jsdom + Testing
 * Library: an automated UI journey, not a real browser).
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

/** Everything money-related, for "nothing moved" checks. */
function money(d: SandboxDatabase) {
  return JSON.stringify({ ledger: d.ledger, operations: d.operations, wallets: d.wallets, peerRequests: d.peerRequests, teenRecords: d.teenRecords });
}

/** A mission's card in its category list (not the "Continue" link in the summary). */
const cardFor = (title: string) => {
  const cards = screen
    .getAllByRole("link", { name: new RegExp(title) })
    .filter((a) => !a.closest('[aria-label="Your progress"]'));
  expect(cards).toHaveLength(1);
  return cards[0]!;
};

describe("Phase 11 journey — Money Missions", () => {
  const fetchSpy = vi.fn(() => Promise.reject(new Error("network is not allowed")));
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("25 steps: start, lesson, persistence, Activity, Space, Coach, money safety, parent denied, reset", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    save(linkedDatabase());
    const moneyAtStart = money(db());
    const spacesAtStart = db().spaces;
    const balanceAtStart = walletBalance(db().ledger, TEEN_WALLET);

    // 1. Aarav opens Money Missions: nothing started, 0 of 10.
    let view = await signedIn(SEED_TEEN_ID, "teen", "/missions");
    expect(await screen.findByRole("heading", { level: 1, name: "Money Missions" })).toBeInTheDocument();
    expect(screen.getByText("0 of 10 completed")).toBeInTheDocument();
    expect(cardFor("Know Your Balance")).toHaveTextContent("Not started");

    // 2. He opens Know Your Balance and starts it.
    await go("/missions/know-your-balance");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Your balance is a total" })).toBeInTheDocument();

    // 3. He finishes the first lesson step.
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText("Step 2 of 3")).toBeInTheDocument();

    // 4. The list shows the progress in words.
    await go("/missions");
    expect(cardFor("Know Your Balance")).toHaveTextContent("In progress · Step 2 of 3");

    // 5. He leaves (the app is closed) and comes back: progress is still there.
    view.unmount();
    cleanup();
    view = await signedIn(SEED_TEEN_ID, "teen", "/missions/know-your-balance");
    expect(await screen.findByRole("heading", { level: 2, name: "Total and available" })).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();

    // 6. He finishes it, with one wrong try on the way (no penalty).
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("radio", { name: "It goes up" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    expect(screen.getByRole("status")).toHaveTextContent(/^Not quite\./);
    await user.click(screen.getByRole("radio", { name: "It stays the same until the payment completes" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Complete mission" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Mission completed" })).toBeInTheDocument();

    // 7. Explore Your Spending: started, read, pointed at Activity.
    await go("/missions/explore-spending");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("link", { name: "Review Activity" })).toHaveAttribute("href", "/activity?mission=explore-spending");

    // 8. In Activity, he marks the step done and is taken back: completed.
    await go("/activity?mission=explore-spending");
    const activityNote = await screen.findByRole("region", { name: "Mission step" });
    await user.click(within(activityNote).getByRole("button", { name: "Mark step done" }));
    await waitFor(() => expect(nav.url).toBe("/missions/explore-spending"));
    expect(await screen.findByRole("heading", { level: 2, name: "Mission completed" })).toBeInTheDocument();

    // 9. Build a Money Space: the evidence step waits for a real Space.
    await go("/missions/build-a-space");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByText("You don't have a Space of your own yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Complete mission" })).not.toBeInTheDocument();

    // 10. On Money, the note says what's missing.
    await go("/money?mission=build-a-space");
    let moneyNote = await screen.findByRole("region", { name: "Mission step" });
    expect(moneyNote).toHaveTextContent("You don't have a Space of your own yet.");

    // 11. He creates a Space through the usual flow — no starting money.
    await user.click(screen.getByRole("button", { name: "New space" }));
    const dialog = await screen.findByRole("dialog", { name: "New space" });
    await user.type(within(dialog).getByLabelText("Name"), "Gifts");
    await user.click(within(dialog).getByRole("button", { name: "Create space" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // 12. The note now shows the fact; no money moved.
    moneyNote = screen.getByRole("region", { name: "Mission step" });
    expect(moneyNote).toHaveTextContent("You have a Space: Gifts.");
    expect(money(db())).toBe(moneyAtStart);

    // 13. Back on the mission, he completes it.
    await go("/missions/build-a-space");
    await user.click(await screen.findByRole("button", { name: "Complete mission" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Mission completed" })).toBeInTheDocument();

    // 14. Learn From Your Coach: started and read.
    await go("/missions/learn-from-coach");
    await user.click(await screen.findByRole("button", { name: "Start mission" }));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("link", { name: "Open Money Coach" })).toHaveAttribute("href", "/coach?mission=learn-from-coach");

    // 15. On the Coach he switches period; the step still waits for a lesson.
    await go("/coach?mission=learn-from-coach");
    expect(await screen.findByRole("heading", { level: 1, name: "Money Coach" })).toBeInTheDocument();
    await user.click(screen.getByRole("radio", { name: "Week" }));
    expect(screen.getByRole("radio", { name: "Week" })).toBeChecked();
    const coachNote = screen.getByRole("region", { name: "Mission step" });
    expect(within(coachNote).getByRole("button", { name: "Mark step done" })).toBeDisabled();

    // 16. He opens a lesson, marks the step done and goes back.
    const learn = screen.getByRole("region", { name: "Learn" });
    await user.click(within(learn).getAllByRole("listitem")[0]!.querySelector("summary")!);
    await user.click(await within(coachNote).findByRole("button", { name: "Mark step done" }));
    await waitFor(() => expect(nav.url).toBe("/missions/learn-from-coach"));

    // 17. The final check completes it.
    await user.click(await screen.findByRole("radio", { name: "A completed payment you sent" }));
    await user.click(screen.getByRole("button", { name: "Check answer" }));
    await user.click(screen.getByRole("button", { name: "Complete mission" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Mission completed" })).toBeInTheDocument();

    // 18. 4 of 10 on the list and on Home.
    await go("/missions");
    expect(screen.getByText("4 of 10 completed")).toBeInTheDocument();
    await go("/");
    expect(within(await screen.findByRole("region", { name: "Money Missions" })).getByText("4 of 10 completed")).toBeInTheDocument();

    // 19. No money was mutated by any of it: the ledger, operations, wallets,
    //     requests and approvals are identical; the only new Space is the one he made.
    expect(money(db())).toBe(moneyAtStart);
    expect(walletBalance(db().ledger, TEEN_WALLET)).toBe(balanceAtStart);
    expect(db().spaces.filter((s) => !spacesAtStart.some((o) => o.id === s.id)).map((s) => s.name)).toEqual(["Gifts"]);
    expect(db().missionProgress?.filter((r) => r.completedAt)).toHaveLength(4);
    const progressAsTeen = JSON.stringify(db().missionProgress);
    view.unmount();
    cleanup();

    // 20. Priya (linked parent) opens /missions: the teen-only gate, no progress.
    view = await signedIn(SEED_PARENT_ID, "parent", "/missions");
    expect(await screen.findByRole("heading", { level: 1, name: /This is .*'s space/ })).toBeInTheDocument();
    expect(document.querySelector("main")!.textContent).not.toMatch(/of 10 completed|Know Your Balance/);

    // 21. A mission page and her Profile show nothing of Aarav's missions either.
    await go("/missions/know-your-balance");
    expect(await screen.findByRole("heading", { level: 1, name: /This is .*'s space/ })).toBeInTheDocument();
    expect(document.querySelector("main")!.textContent).not.toMatch(/Mission completed|Step \d of/);
    await go("/profile");
    expect(await screen.findByRole("region", { name: "Account" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Learn" })).not.toBeInTheDocument();

    // 22. Nothing she did touched his progress.
    expect(JSON.stringify(db().missionProgress)).toBe(progressAsTeen);
    view.unmount();
    cleanup();

    // 23. Back as Aarav: everything is as he left it.
    view = await signedIn(SEED_TEEN_ID, "teen", "/missions");
    expect(await screen.findByText("4 of 10 completed")).toBeInTheDocument();
    expect(cardFor("Build a Money Space")).toHaveTextContent("Completed");

    // 24. Reset Sandbox from Profile.
    await go("/profile");
    const sandbox = await screen.findByRole("region", { name: "Sandbox" });
    await user.click(within(sandbox).getByRole("button", { name: /^reset$/i }));
    const confirm = await screen.findByRole("dialog", { name: "Reset sandbox data?" });
    expect(confirm).toHaveTextContent("Money Missions progress");
    await user.click(within(confirm).getByRole("button", { name: /^reset$/i }));
    await waitFor(() => expect(nav.url).toBe("/sign-in"));
    await settle();
    view.unmount();
    cleanup();

    // 25. Missions are cleared: the seed again, and 0 of 10.
    await waitFor(() => expect(db()).toEqual(buildSeedDatabase()));
    expect(db().missionProgress).toBeUndefined();
    view = await signedIn(SEED_TEEN_ID, "teen", "/missions");
    expect(await screen.findByText("0 of 10 completed")).toBeInTheDocument();
    view.unmount();
    cleanup();
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 180_000);
});
