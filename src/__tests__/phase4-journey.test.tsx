import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY } from "@/auth/sandbox-service";
import { deriveBalance } from "@/sandbox/engine";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { SANDBOX_KEY, teenLedger } from "./helpers/fixtures";
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
 * Phase 4 acceptance journey, end to end through the real provider
 * stack (AuthProvider → SandboxProvider → AppShell/AuthGate), the
 * real page modules and localStorage. Runs in jsdom with Testing
 * Library — an automated UI journey, not a real browser.
 *
 * Daily limits use the real clock: every seed debit predates
 * 26 Sep 2026, so today's spend starts at ₹0.
 */

// Page transitions animate (AnimatePresence); allow for slow CI.
configure({ asyncUtilTimeout: 5000 });

function db(): SandboxDatabase {
  return JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
}

/** Phase 5: the teen's wallet entries + teen records (requests/approvals). */
function teenWallet() {
  const current = db();
  return {
    ledger: teenLedger(current),
    approvals: current.teenRecords.find((r) => r.teenId === SEED_TEEN_ID)!.approvals,
  };
}

/**
 * Page transitions use AnimatePresence (200ms). When the exit of the
 * previous page completes, the entering page is remounted, discarding
 * any local form state — so a fast test must let the transition settle
 * before typing, exactly as a person would.
 */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

async function go(path: string) {
  act(() => navigate(path));
  await settle();
}

describe("Phase 4 journey", () => {
  it("signs in, links, limits, approves once, signs out, persists, and resets", async () => {
    const user = userEvent.setup();

    // 1. Start signed out: "/" redirects to sign-in.
    resetRouter("/");
    const first = render(<TestApp />);
    expect(await screen.findByRole("heading", { name: "Welcome to TeenPay" })).toBeInTheDocument();
    expect(nav.url).toBe("/sign-in?next=%2F");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    // 2–3. Sandbox auth as the teen account.
    expect(screen.getByText("Sandbox session — not real sign-in")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue as teen/i }));
    await waitFor(() => expect(nav.url).toBe("/"));
    await settle();
    expect((await screen.findAllByRole("navigation", { name: "Primary" })).length).toBeGreaterThan(0);

    // 4. Teen profile: account + honest security status.
    await go("/profile");
    const account = await screen.findByRole("region", { name: "Account" });
    expect(within(account).getByText("Aarav Sharma")).toBeInTheDocument();
    expect(within(account).getByText("Teen")).toBeInTheDocument();
    expect(within(account).getByText("Active")).toBeInTheDocument();
    expect(await screen.findByText(/^Sandbox session · started/)).toBeInTheDocument();

    // 5. The family exists (not linked yet).
    const family = screen.getByRole("region", { name: "Family" });
    expect(within(family).getByText("Sharma family")).toBeInTheDocument();
    expect(within(family).getAllByText("Not connected").length).toBeGreaterThan(0);

    // 6–7. Link a parent: teen creates the code, switches to Parent
    // (sandbox control), parent enters the code, reviews, connects.
    await go("/family");
    await user.click(await screen.findByRole("button", { name: /connect parent/i }));
    const code = (await screen.findByText(/^TEEN-\d{4}$/)).textContent ?? "";
    await user.click(await screen.findByRole("button", { name: /sandbox: switch to parent to accept/i }));
    await user.type(await screen.findByLabelText("Invite code"), code);
    await user.click(await screen.findByRole("button", { name: /find teen/i }));
    expect(await screen.findByRole("heading", { name: "Review teen" })).toBeInTheDocument();
    expect(screen.getByText("Found Aarav. Review before connecting.")).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /^connect$/i }));
    expect(await screen.findByRole("heading", { name: "Connected" })).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SESSION_STORAGE_KEY)!).session.accountId).toBe(
      SEED_PARENT_ID,
    );

    // 8. Parent-only controls are available to the linked parent.
    await go("/parent");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /edit rules/i })).toBeInTheDocument();
    // Phase 7: the schedule preview became "Create pocket money".
    expect(await screen.findByRole("button", { name: /create pocket money/i })).toBeInTheDocument();

    // 9. Daily limit ₹500, approvals above ₹500.
    await user.click(await screen.findByRole("button", { name: /edit rules/i }));
    const dialog = await screen.findByRole("dialog", { name: "Spending rules" });
    await user.click(await within(dialog).findByRole("switch", { name: "Daily limit" }));
    const daily = await within(dialog).findByLabelText("Daily limit amount");
    await user.clear(daily);
    await user.type(daily, "500");
    await user.click(await screen.findByRole("switch", { name: "Ask me first" }));
    await user.click(await screen.findByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("₹500 a day")).toBeInTheDocument();
    expect(await screen.findByText("You approve payments above ₹500")).toBeInTheDocument();

    // 10. Switch to teen (the role gate's transparent switch).
    await go("/pay");
    await user.click(await screen.findByRole("button", { name: /switch to teen/i }));

    // 11. Pay ₹200 — completes.
    await user.click(await screen.findByRole("button", { name: /riya patel/i }));
    await user.type(await screen.findByLabelText("Amount"), "200");
    await user.click(await screen.findByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /confirm payment/i }));
    expect(await screen.findByRole("heading", { name: /payment sent/i })).toBeInTheDocument();

    // 12. The ledger has it (and Activity shows it).
    await waitFor(() => expect(teenWallet().ledger).toHaveLength(7));
    expect(deriveBalance(teenWallet().ledger)).toBe(1650);
    await go("/activity");
    expect((await screen.findAllByText("Payment to Riya Patel")).length).toBeGreaterThan(0);

    // 13. A larger payment becomes an approval request; nothing moves.
    await go("/pay");
    await screen.findByText(/who are you paying/i);
    await waitFor(() => expect(screen.queryByText("Payment to Riya Patel")).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    await user.type(await screen.findByLabelText("Amount"), "750");
    expect(await screen.findByText(/this payment needs parent approval/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /ask priya to approve/i }));
    expect(await screen.findByRole("heading", { name: /pending approval/i })).toBeInTheDocument();
    await waitFor(() =>
      expect(teenWallet().approvals.map((a) => a.status)).toEqual(["pending"]),
    );
    expect(teenWallet().ledger).toHaveLength(7);

    // 14. Switch to parent.
    await go("/parent");
    await user.click(await screen.findByRole("button", { name: /switch to parent/i }));
    expect(await screen.findByText(/aarav wants to send/i)).toBeInTheDocument();

    // 15. Approve (double click).
    await user.dblClick(await screen.findByRole("button", { name: "Approve ₹750 to Riya Patel" }));

    // 16. Executes exactly once.
    await waitFor(() => expect(teenWallet().approvals[0]?.status).toBe("approved"));
    const sent750 = teenWallet().ledger.filter(
      (e) => e.type === "payment_sent" && e.amount === 750,
    );
    expect(sent750).toHaveLength(1);
    expect(deriveBalance(teenWallet().ledger)).toBe(900);

    // 17. Sign out (session only).
    await go("/profile");
    await user.click(await screen.findByRole("button", { name: /^sign out$/i }));
    await waitFor(() => expect(nav.url).toBe("/sign-in"));
    await settle();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(teenWallet().ledger).toHaveLength(8); // data kept

    // 18. Protected screens need a session.
    for (const path of ["/parent", "/pay", "/family", "/profile"]) {
      await go(path);
      await waitFor(() => expect(nav.url).toBe(`/sign-in?next=${encodeURIComponent(path)}`));
      expect(screen.queryAllByRole("navigation", { name: "Primary" })).toHaveLength(0);
    }

    // 19. Sign in again (as the parent; lands where they were going).
    await user.click(await screen.findByRole("button", { name: /continue as parent/i }));
    await waitFor(() => expect(nav.url).toBe("/profile"));
    await settle();

    // 20. State persists — including across a full reload.
    await go("/parent");
    expect(await screen.findByText("You approve payments above ₹500")).toBeInTheDocument();
    first.unmount();
    cleanup();
    resetRouter("/parent");
    render(<TestApp />);
    await settle();
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(await screen.findByText("₹500 a day")).toBeInTheDocument();
    expect(deriveBalance(teenWallet().ledger)).toBe(900);
    expect(teenWallet().approvals[0]?.status).toBe("approved");

    // 21. Reset: confirm, signed out, back to sign-in.
    await go("/profile");
    const sandbox = await screen.findByRole("region", { name: "Sandbox" });
    await user.click(within(sandbox).getByRole("button", { name: /^reset$/i }));
    const confirm = await screen.findByRole("dialog", { name: "Reset sandbox data?" });
    await user.click(within(confirm).getByRole("button", { name: /^reset$/i }));
    await waitFor(() => expect(nav.url).toBe("/sign-in"));
    await settle();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();

    // 22. Deterministic initial state.
    await waitFor(() => expect(db()).toEqual(buildSeedDatabase()));
    await user.click(await screen.findByRole("button", { name: /continue as teen/i }));
    await waitFor(() => expect(nav.url).toBe("/"));
    expect(deriveBalance(teenWallet().ledger)).toBe(1850);
    expect(db().families[0]?.links[0]?.status).toBe("not_linked");
  }, 60_000);
});
