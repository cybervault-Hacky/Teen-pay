import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href: string; children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement("a", props, props.children),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/money",
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

import { ActivityFeed } from "@/components/activity/activity-feed";
import { HomeContent } from "@/components/home/home-content";
import { MoneyContent } from "@/components/money/money-content";
import { SpaceDetail } from "@/components/spaces/space-detail";
import { buildSeedState, SEED_GOAL_SPACE_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider } from "@/sandbox/store";
import { setWalletStatusTransition } from "@/sandbox/transitions";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { must, preloadDatabase, SANDBOX_KEY, TEEN, TEEN_WALLET } from "./helpers/fixtures";

function renderTeen(ui: React.ReactNode, db?: SandboxState | SandboxDatabase) {
  window.localStorage.clear();
  if (db) preloadDatabase(db);
  return render(<SandboxProvider viewerId={SEED_TEEN_ID}>{ui}</SandboxProvider>);
}

const stored = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const spaceEntries = (spaceId: string) => stored().ledger.filter((e) => e.spaceId === spaceId);
const frozenState = () =>
  must(setWalletStatusTransition(buildSeedState(), { ...TEEN, walletId: TEEN_WALLET, status: "frozen" }));

describe("Money page", () => {
  it("orders available money → Spaces → recent Space activity → actions", () => {
    renderTeen(<MoneyContent />);
    const headings = screen.getAllByRole("heading").map((h) => h.textContent ?? "");
    const at = (title: string) => headings.findIndex((h) => h.includes(title));
    expect(at("Your money")).toBe(0);
    expect(at("Money Spaces")).toBeGreaterThan(at("Your money"));
    expect(at("Recent space activity")).toBeGreaterThan(at("Money Spaces"));
    expect(at("Plan ahead")).toBeGreaterThan(at("Recent space activity"));

    // Total, available and allocated are distinct and add up.
    const split = screen.getByText("How your money splits").closest("div")!.parentElement!;
    expect(within(split).getByText("Available").nextSibling?.textContent).toContain("₹1,850");
    expect(within(split).getByText("In spaces").nextSibling?.textContent).toContain("₹2,300");
    expect(within(split).getByText("Total").nextSibling?.textContent).toContain("₹4,150");
  });

  it("each Space card shows its derived balance and an accessible progress bar", () => {
    renderTeen(<MoneyContent />);
    const bike = screen.getByRole("progressbar", { name: "New Bike progress" });
    expect(bike).toHaveAttribute("aria-valuenow", "60");
    expect(bike).toHaveAttribute("aria-valuetext", "₹1,500 of ₹2,500, 60%");
    expect(screen.getByRole("progressbar", { name: "Save progress" })).toHaveAttribute(
      "aria-valuetext",
      "₹800 of ₹2,000, 40%",
    );
    // Name links to the detail page; the date shows in words (not colour).
    expect(screen.getByRole("link", { name: /New Bike/ })).toHaveAttribute("href", `/money/${SEED_GOAL_SPACE_ID}`);
    expect(screen.getByText(/Nov 30, 2026 · (\d+ days? left|About \d+ months left|Target date (is today|passed))/)).toBeInTheDocument();
    // Recent Space activity comes from the ledger.
    const recent = screen.getByRole("region", { name: "Recent space activity" });
    expect(within(recent).getByText("Added to Save")).toBeInTheDocument();
    expect(within(recent).getByText("Added to New Bike")).toBeInTheDocument();
  });

  it("create goal: inline validation, labelled fields, then one Space even on double submit", async () => {
    const user = userEvent.setup();
    renderTeen(<MoneyContent />);
    await user.click(screen.getByRole("button", { name: "New goal" }));
    const dialog = await screen.findByRole("dialog", { name: "New goal" });

    await user.click(within(dialog).getByRole("button", { name: "Create goal" }));
    expect(within(dialog).getByText("Give this space a name.")).toBeInTheDocument();
    expect(within(dialog).getByText("Goals need a target amount.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");

    await user.type(within(dialog).getByLabelText("Name"), "save");
    expect(within(dialog).getByText("You already have a space with this name.")).toBeInTheDocument();
    await user.clear(within(dialog).getByLabelText("Name"));
    await user.type(within(dialog).getByLabelText("Name"), "Headphones");

    const target = within(dialog).getByLabelText("Target amount");
    await user.type(target, "0");
    expect(within(dialog).getByText("A target must be above ₹0.")).toBeInTheDocument();
    await user.clear(target);
    await user.type(target, "3000");
    await user.click(within(dialog).getByRole("radio", { name: "Headphones" }));
    await user.type(within(dialog).getByLabelText("Starting amount (optional)"), "250");

    await user.dblClick(within(dialog).getByRole("button", { name: "Create goal" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const created = stored().spaces.filter((s) => s.name === "Headphones");
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ type: "goal", targetAmount: 3000, icon: "headphones" });
    expect(spaceEntries(created[0]!.id)).toHaveLength(1);
    expect(screen.getByRole("progressbar", { name: "Headphones progress" })).toHaveAttribute(
      "aria-valuetext",
      "₹250 of ₹3,000, 8.3%",
    );
    expect(screen.getByText("Headphones was created.")).toHaveAttribute("role", "status");
  });

  it("add money: double-clicking Confirm moves money once and announces it", async () => {
    const user = userEvent.setup();
    renderTeen(<MoneyContent />);
    await user.click(screen.getByRole("button", { name: "Add to Save" }));
    const dialog = await screen.findByRole("dialog", { name: "Add to Save" });
    await user.type(within(dialog).getByLabelText("Amount"), "250");
    expect(within(dialog).getByText("Available after").nextSibling).toHaveTextContent("₹1,600");
    await user.dblClick(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    const added = spaceEntries(SEED_SAVE_SPACE_ID).filter((e) => e.type === "space_allocation");
    expect(added).toHaveLength(2); // the seed's + this one
    expect(screen.getByText(/Added ₹250 to Save\. Reference SPC-[0-9A-Z]{8}\./)).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "Save progress" })).toHaveAttribute(
      "aria-valuetext",
      "₹1,050 of ₹2,000, 52.5%",
    );
  });

  it("add and move back explain the limits inline and keep Confirm disabled", async () => {
    const user = userEvent.setup();
    renderTeen(<MoneyContent />);
    await user.click(screen.getByRole("button", { name: "Add to New Bike" }));
    let dialog = await screen.findByRole("dialog", { name: "Add to New Bike" });
    await user.type(within(dialog).getByLabelText("Amount"), "1500");
    expect(within(dialog).getByText("New Bike needs ₹1,000 more to reach its target.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Move back from New Bike" }));
    dialog = await screen.findByRole("dialog", { name: "Move back from New Bike" });
    await user.type(within(dialog).getByLabelText("Amount"), "2000");
    expect(within(dialog).getByText("New Bike has ₹1,500.")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm" })).toBeDisabled();
    expect(spaceEntries(SEED_GOAL_SPACE_ID)).toHaveLength(1);
  });

  it("a frozen wallet disables moves; balances stay visible", () => {
    renderTeen(<MoneyContent />, frozenState());
    expect(screen.getByRole("button", { name: "Add to Save" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move back from New Bike" })).toBeDisabled();
    expect(screen.getByRole("progressbar", { name: "New Bike progress" })).toHaveAttribute("aria-valuenow", "60");
  });
});

describe("Home Spaces summary", () => {
  it("is compact: total set aside, up to three linked Spaces and View all", () => {
    renderTeen(<HomeContent />);
    const section = screen.getByRole("region", { name: "Money Spaces" });
    expect(within(section).getByText(/₹2,300 set aside in 2 spaces/)).toBeInTheDocument();
    expect(within(section).getByRole("link", { name: /View all/ })).toHaveAttribute("href", "/money");
    expect(within(section).getByRole("link", { name: /New Bike/ })).toHaveAttribute("href", `/money/${SEED_GOAL_SPACE_ID}`);
    expect(within(section).getByRole("link", { name: /Save/ })).toHaveAttribute("href", `/money/${SEED_SAVE_SPACE_ID}`);
    // No add/move controls on Home.
    expect(within(section).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("Space detail", () => {
  it("shows name, balance, target, progress, date, totals and real activity", () => {
    renderTeen(<SpaceDetail spaceId={SEED_GOAL_SPACE_ID} />);
    expect(screen.getByRole("heading", { level: 1, name: "New Bike" })).toBeInTheDocument();
    expect(screen.getByRole("progressbar", { name: "New Bike progress" })).toBeInTheDocument();
    expect(screen.getByText("60% · ₹1,000 to go")).toBeInTheDocument();
    expect(screen.getByText("Target date:", { exact: false })).toBeInTheDocument();
    const summary = screen.getByRole("region", { name: "Space summary" });
    expect(within(summary).getByText("Total added").nextSibling).toHaveTextContent("₹1,500");
    expect(within(summary).getByText("Moved back").nextSibling).toHaveTextContent("₹0");
    const activity = screen.getByRole("region", { name: "Space activity" });
    expect(within(activity).getByText("Added to New Bike")).toBeInTheDocument();
    for (const name of ["Add money", "Move back", "Edit", "Archive"]) {
      expect(screen.getByRole("button", { name })).toBeEnabled();
    }
    expect(screen.getByRole("link", { name: /Money/ })).toHaveAttribute("href", "/money");
  });

  it("archive: money moves back first, history stays, and the Space can't take money", async () => {
    const user = userEvent.setup();
    renderTeen(<SpaceDetail spaceId={SEED_GOAL_SPACE_ID} />);
    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive New Bike?" });
    expect(within(dialog).getByText(/₹1,500/)).toBeInTheDocument();
    await user.dblClick(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(screen.getByText("Archived", { selector: "span" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add money" })).not.toBeInTheDocument();
    const activity = screen.getByRole("region", { name: "Space activity" });
    expect(within(activity).getByText("Moved from New Bike")).toBeInTheDocument();
    expect(within(activity).getByText("Added to New Bike")).toBeInTheDocument();
    const db = stored();
    expect(db.spaces.find((s) => s.id === SEED_GOAL_SPACE_ID)?.status).toBe("archived");
    expect(spaceEntries(SEED_GOAL_SPACE_ID).map((e) => e.type)).toEqual(["space_allocation", "space_release"]);
  });

  it("archived Spaces stay listed on Money behind a toggle", async () => {
    const user = userEvent.setup();
    renderTeen(
      <>
        <SpaceDetail spaceId={SEED_GOAL_SPACE_ID} />
        <MoneyContent />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Archive" }));
    const dialog = await screen.findByRole("dialog", { name: "Archive New Bike?" });
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    const toggle = screen.getByRole("button", { name: "Archived (1)" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    const list = document.getElementById("archived-spaces")!;
    expect(within(list).getByText("New Bike")).toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Add to New Bike" })).not.toBeInTheDocument();
  });

  it("a frozen wallet disables Add money and Move back, with the reason in words", () => {
    renderTeen(<SpaceDetail spaceId={SEED_SAVE_SPACE_ID} />, frozenState());
    expect(screen.getByRole("button", { name: "Add money" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move back" })).toBeDisabled();
    expect(screen.getByText(/Your wallet is frozen/)).toBeInTheDocument();
    // The default Save can't be archived, so there's no Archive button.
    expect(screen.queryByRole("button", { name: "Archive" })).not.toBeInTheDocument();
  });

  it("an unknown (or someone else's) Space id shows a neutral not-available state", () => {
    renderTeen(<SpaceDetail spaceId="spc_save_usr_someone" />);
    expect(screen.getByText("This space isn't available")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add money" })).not.toBeInTheDocument();
  });
});

describe("Activity ↔ Space", () => {
  it("a Space move's transaction detail shows its reference and links to the Space", async () => {
    const user = userEvent.setup();
    renderTeen(<ActivityFeed />);
    await user.click(screen.getByRole("button", { name: /Added to New Bike.*open details/i }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/^SPC-[0-9A-Z]{8}$/)).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "New Bike" })).toHaveAttribute("href", `/money/${SEED_GOAL_SPACE_ID}`);
    // Not a payment: no refund option.
    expect(within(dialog).queryByRole("button", { name: /refund/i })).not.toBeInTheDocument();
  });
});
