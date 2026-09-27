import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { spaceBalance, walletBalance } from "@/sandbox/engine";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, SANDBOX_KEY, TEEN_WALLET } from "./helpers/fixtures";
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
 * Phase 6 acceptance journey through the real provider stack
 * (AuthProvider → SandboxProvider → AppShell/AuthGate), the real page
 * modules and localStorage. jsdom + Testing Library — an automated UI
 * journey, not a real browser.
 */
configure({ asyncUtilTimeout: 5000 });

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const available = () => walletBalance(db().ledger, TEEN_WALLET);

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

function splitValue(label: string): string {
  const card = screen.getByText("How your money splits").closest("div")!.parentElement!;
  return within(card).getByText(label).nextSibling?.textContent ?? "";
}

describe("Phase 6 journey — Money Spaces", () => {
  it("15 steps: create a goal, allocate, inspect, move back, reload, archive; history intact", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();

    // 1. Sign in as Aarav (sandbox teen).
    resetRouter("/");
    const first = render(<TestApp />);
    await user.click(await screen.findByRole("button", { name: /continue as teen/i }));
    await waitFor(() => expect(nav.url).toBe("/"));
    await settle();

    // 2. Money page: available, then Spaces.
    await go("/money");
    expect(await screen.findByRole("heading", { name: "Your money" })).toBeInTheDocument();
    expect(splitValue("Available")).toContain("₹1,850");
    expect(splitValue("In spaces")).toContain("₹2,300");

    // 3. Create a goal.
    await user.click(screen.getByRole("button", { name: "New goal" }));
    const create = await screen.findByRole("dialog", { name: "New goal" });
    await user.type(within(create).getByLabelText("Name"), "Trip");
    await user.type(within(create).getByLabelText("Target amount"), "3000");
    await user.click(within(create).getByRole("button", { name: "Create goal" }));
    await closedDialog();
    const trip = db().spaces.find((s) => s.name === "Trip")!;
    expect(trip).toMatchObject({ type: "goal", targetAmount: 3000, status: "active", ownerAccountId: "usr_aarav" });

    // 4. Allocate ₹500 (double click — once).
    await user.click(await screen.findByRole("button", { name: "Add to Trip" }));
    const add = await screen.findByRole("dialog", { name: "Add to Trip" });
    await user.type(within(add).getByLabelText("Amount"), "500");
    await user.dblClick(within(add).getByRole("button", { name: "Confirm" }));
    await closedDialog();

    // 5. Available and Space balances (ledger and screen agree).
    expect(available()).toBe(1350);
    expect(spaceBalance(db().ledger, trip.id)).toBe(500);
    expect(db().ledger.filter((e) => e.spaceId === trip.id)).toHaveLength(1);
    expect(splitValue("Available")).toContain("₹1,350");
    expect(splitValue("In spaces")).toContain("₹2,800");
    expect(splitValue("Total")).toContain("₹4,150");
    expect(screen.getByRole("progressbar", { name: "Trip progress" })).toHaveAttribute(
      "aria-valuetext",
      "₹500 of ₹3,000, 16.6%",
    );

    // 6. Activity lists the move.
    await go("/activity");
    const row = await screen.findByRole("button", { name: /Added to Trip.*open details/i });

    // 7. Transaction detail: reference + link to the Space.
    await user.click(row);
    const detail = await screen.findByRole("dialog");
    const reference = db().ledger.find((e) => e.spaceId === trip.id)!.reference;
    expect(reference).toMatch(/^SPC-[0-9A-Z]{8}$/);
    expect(within(detail).getByText(reference)).toBeInTheDocument();
    expect(within(detail).getByRole("link", { name: "Trip" })).toHaveAttribute("href", `/money/${trip.id}`);

    // 8. Back to the goal.
    await go(`/money/${trip.id}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Trip" })).toBeInTheDocument();

    // 9. Move part of it back.
    await user.click(screen.getByRole("button", { name: "Move back" }));
    const back = await screen.findByRole("dialog", { name: "Move back from Trip" });
    await user.type(within(back).getByLabelText("Amount"), "200");
    await user.click(within(back).getByRole("button", { name: "Confirm" }));
    await closedDialog();

    // 10. Balances after.
    expect(available()).toBe(1550);
    expect(spaceBalance(db().ledger, trip.id)).toBe(300);
    expect(await screen.findByText(/Moved ₹200 from Trip back to available\. Reference SPC-/)).toBeInTheDocument();
    const entriesBeforeReload = db().ledger.length;

    // 11. Reload the whole app.
    first.unmount();
    cleanup();
    resetRouter(`/money/${trip.id}`);
    const second = render(<TestApp />);
    await settle();

    // 12. Everything persisted — no duplicates.
    expect(await screen.findByRole("heading", { level: 1, name: "Trip" })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Space summary" });
    expect(within(summary).getByText("Total added").nextSibling).toHaveTextContent("₹500");
    expect(within(summary).getByText("Moved back").nextSibling).toHaveTextContent("₹200");
    expect(db().ledger.length).toBe(entriesBeforeReload);

    // 13. Archive (the remaining ₹300 moves back first).
    await user.click(screen.getByRole("button", { name: "Archive" }));
    const archive = await screen.findByRole("dialog", { name: "Archive Trip?" });
    await user.click(within(archive).getByRole("button", { name: "Archive" }));
    await closedDialog();
    expect(db().spaces.find((s) => s.id === trip.id)?.status).toBe("archived");
    expect(available()).toBe(1850);

    // 14. History intact: every movement remains, on the page and in the ledger.
    const activity = screen.getByRole("region", { name: "Space activity" });
    expect(within(activity).getAllByText("Moved from Trip")).toHaveLength(2);
    expect(within(activity).getByText("Added to Trip")).toBeInTheDocument();
    expect(db().ledger.filter((e) => e.spaceId === trip.id).map((e) => [e.type, e.amount])).toEqual([
      ["space_allocation", 500],
      ["space_release", 200],
      ["space_release", 300],
    ]);

    // 15. Money lists it as archived (not deleted); seed Spaces untouched.
    await go("/money");
    expect(await screen.findByRole("button", { name: "Archived (1)" })).toBeInTheDocument();
    expect(splitValue("In spaces")).toContain("₹2,300");
    expect(spaceBalance(db().ledger, "goal_bike")).toBe(1500);
    second.unmount();
    cleanup();

    // Another account can't open or see Aarav's Space.
    const stored = db();
    const made = createAccount(stored, { role: "teen", displayName: "Kabir Mehta", username: "kabirm" }, AT);
    if ("code" in made) throw new Error(made.message);
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(made.db));
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: made.account.id, role: "teen" }, Date.now());
    resetRouter(`/money/${trip.id}`);
    render(<TestApp service={service} />);
    await settle();
    expect(await screen.findByText("This space isn't available")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1, name: "Trip" })).not.toBeInTheDocument();
    await go("/money");
    expect(await screen.findByRole("heading", { name: "Your money" })).toBeInTheDocument();
    expect(screen.queryByText("Trip")).not.toBeInTheDocument();
    expect(screen.queryByText("New Bike")).not.toBeInTheDocument();
    expect(splitValue("In spaces")).toContain("₹0");
    // Aarav's records are unchanged by the visit.
    expect(db().ledger.filter((e) => e.spaceId === trip.id)).toHaveLength(3);
  }, 60_000);
});
