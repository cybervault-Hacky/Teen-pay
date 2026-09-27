import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ParentContent } from "@/components/parent/parent-content";
import { SandboxProvider, useSandbox } from "@/sandbox/store";
import { SEED_PARENT_ID } from "@/sandbox/seed";
import { preloadDatabase, linkedState, teenLedger } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/parent",
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
  // Phase 5: the parent's view also holds their own wallet — probe the teen's.
  const spend = teenLedger(state).reduce(
    (sum, e) => (e.direction === "credit" ? sum + e.amount : sum - e.amount),
    0,
  );
  return <span data-testid="spend">{spend}</span>;
}

/**
 * Phase 3: the dashboard is for a connected guardian. Seed the
 * store with the linked family (built by the real transitions)
 * and the parent role active.
 */
function renderParent() {
  // Phase 4: stored as a v3 database; the viewer comes from the session.
  preloadDatabase(linkedState());
  render(
    <SandboxProvider viewerId={SEED_PARENT_ID}>
      <SpendProbe />
      <ParentContent />
    </SandboxProvider>,
  );
}

const spend = () =>
  Number(document.querySelector('[data-testid="spend"]')?.textContent);

describe("parent view", () => {
  it("shows the teen's name, derived balance, and total", () => {
    renderParent();

    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("Teen")).toBeInTheDocument();
    expect(screen.getByText("₹1,850")).toBeInTheDocument();
    expect(screen.getByText(/₹4,150 total/i)).toBeInTheDocument();
  });

  it("shows recent activity and a basic in/out overview", () => {
    renderParent();

    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
    expect(screen.getByText("Money in")).toBeInTheDocument();
    expect(screen.getByText("Money out")).toBeInTheDocument();
    expect(screen.getByText(/set aside/i)).toBeInTheDocument();
  });

  it("sending allowance credits the teen balance through the ledger", async () => {
    const user = userEvent.setup();
    renderParent();
    expect(spend()).toBe(1850);

    await user.type(screen.getByLabelText("Amount"), "500");
    const sendBtn = screen.getByRole("button", { name: /send ₹500/i });
    expect(sendBtn).toBeEnabled();
    await user.click(sendBtn);

    expect(screen.getByText(/₹500 sent to aarav/i)).toBeInTheDocument();
    expect(spend()).toBe(2350);
    expect(
      screen.getByText(/available balance updated instantly/i),
    ).toBeInTheDocument();

    // "Send more" re-opens the form without losing state.
    await user.click(screen.getByRole("button", { name: /send more/i }));
    expect(screen.getByRole("button", { name: /send pocket money/i })).toBeInTheDocument();
  });

  it("blocks invalid amounts before sending", async () => {
    const user = userEvent.setup();
    renderParent();

    const sendBtn = screen.getByRole("button", { name: /send pocket money/i });
    expect(sendBtn).toBeDisabled(); // empty amount

    await user.type(screen.getByLabelText("Amount"), "15000");
    expect(
      screen.getByText(/capped at ₹10,000/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /send ₹15,000/i })).toBeDisabled();
  });
});
