import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { SandboxProvider, useSandbox } from "@/sandbox/store";

vi.mock("next/navigation", () => ({
  usePathname: () => "/activity",
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

function SpendProbe() {
  const { state } = useSandbox();
  const spend = state.ledger.reduce(
    (sum, e) => (e.direction === "credit" ? sum + e.amount : sum - e.amount),
    0,
  );
  return <span data-testid="spend">{spend}</span>;
}

function renderFeed() {
  render(
    <SandboxProvider>
      <SpendProbe />
      <ActivityFeed />
    </SandboxProvider>,
  );
}

const spend = () =>
  Number(document.querySelector('[data-testid="spend"]')?.textContent);

describe("activity feed", () => {
  it("lists ledger-derived activity, grouped by day, newest first", () => {
    renderFeed();

    // The seed's most recent entries (Sep 25 allowance) lead the feed.
    expect(screen.getAllByText("Pocket money").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Payment to Ananya Iyer")).toBeInTheDocument();
    // Phase 6: Money Space moves are titled by their Space.
    expect(screen.getByText("Added to New Bike")).toBeInTheDocument();
    expect(screen.getByText("Added to Save")).toBeInTheDocument();
    // Day groups in the product timezone.
    expect(screen.getByText("Sep 25")).toBeInTheDocument();
    expect(screen.getByText("Sep 24")).toBeInTheDocument();
  });

  it("search filters on real state", async () => {
    const user = userEvent.setup();
    renderFeed();

    await user.type(screen.getByLabelText("Search"), "bike");
    expect(screen.getByText("Added to New Bike")).toBeInTheDocument();
    expect(screen.queryByText("Payment to Ananya Iyer")).not.toBeInTheDocument();

    await user.clear(screen.getByLabelText("Search"));
    expect(screen.getByText("Payment to Ananya Iyer")).toBeInTheDocument();
  });

  it("direction filters work on real state", async () => {
    const user = userEvent.setup();
    renderFeed();

    await user.click(screen.getByRole("button", { name: "Money in" }));
    expect(screen.getAllByText("Pocket money").length).toBe(3);
    expect(screen.queryByText("Payment to Ananya Iyer")).not.toBeInTheDocument();
    expect(screen.queryByText("Added to Save")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Money out" }));
    expect(screen.getByText("Payment to Ananya Iyer")).toBeInTheDocument();
    expect(screen.queryByText("Pocket money")).not.toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderFeed();

    await user.type(screen.getByLabelText("Search"), "zzzzz");
    expect(screen.getByText("Nothing matches")).toBeInTheDocument();
  });

  it("opens an immutable transaction detail from a row", async () => {
    const user = userEvent.setup();
    renderFeed();

    // Three "Pocket money" rows exist; the day in the accessible name
    // disambiguates the Sep 25 allowance.
    await user.click(
      screen.getByRole("button", {
        name: /pocket money, sep 25.*open details/i,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Pocket money")).toBeInTheDocument();
    expect(within(dialog).getByText("Completed")).toBeInTheDocument();
    expect(within(dialog).getByText("Sandbox")).toBeInTheDocument();
    expect(within(dialog).getByText(/september 25, 2026/i)).toBeInTheDocument();
    expect(within(dialog).getByText("From")).toBeInTheDocument();
    expect(within(dialog).getByText("Priya")).toBeInTheDocument();
    // Phase 5: a human-facing reference instead of the internal id.
    expect(within(dialog).getByText(/^ALW-[0-9A-Z]{8}$/)).toBeInTheDocument();
    expect(within(dialog).queryByText(/seed_allow_3/)).not.toBeInTheDocument();
    expect(
      within(dialog).getByText(/can.t be edited or deleted/i),
    ).toBeInTheDocument();

    // Escape closes the detail (after its quick exit animation).
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("simulating a request as paid credits the balance and removes it", async () => {
    const user = userEvent.setup();
    renderFeed();

    expect(screen.getByText("Pending requests")).toBeInTheDocument();
    expect(spend()).toBe(1850);

    await user.click(screen.getByRole("button", { name: /simulate paid/i }));
    expect(spend()).toBe(2050); // 1850 + 200
    expect(screen.queryByText("Pending requests")).not.toBeInTheDocument();
  });

  it("cancelling a pending request removes it without ledger effects", async () => {
    const user = userEvent.setup();
    renderFeed();

    expect(spend()).toBe(1850);
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(spend()).toBe(1850);
    expect(screen.queryByText("Pending requests")).not.toBeInTheDocument();
  });
});
