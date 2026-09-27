import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SandboxProvider, useSandbox } from "@/sandbox/store";
import { PayFlow } from "@/components/pay/pay-flow";

vi.mock("next/navigation", () => ({
  usePathname: () => "/pay",
  useSearchParams: () => new URLSearchParams(),
}));

// Deterministic flows in jsdom: honor reduced motion so step
// transitions resolve immediately.
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

/** Renders the flow plus a small probe of the ledger state. */
function SpendProbe() {
  const { state } = useSandbox();
  const spend = state.ledger.reduce(
    (sum, e) => (e.direction === "credit" ? sum + e.amount : sum - e.amount),
    0,
  );
  return <span data-testid="spend">{spend}</span>;
}

function renderFlow(mode: "send" | "request" = "send") {
  return render(
    <SandboxProvider>
      <SpendProbe />
      <PayFlow mode={mode} />
    </SandboxProvider>,
  );
}

const spend = () =>
  Number(document.querySelector('[data-testid="spend"]')?.textContent);

describe("pay flow — send", () => {
  it("renders the recipient step with sandbox recipients", async () => {
    const user = userEvent.setup();
    renderFlow();

    expect(
      screen.getByText(/who are you paying/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Riya Patel")).toBeInTheDocument();
    expect(screen.getByText(/@riya/)).toBeInTheDocument();
    expect(screen.getByText(/fictional identities/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    expect(await screen.findByRole("heading", { name: /riya patel/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toBeInTheDocument();
  });

  it("walks a full payment: amount → review → confirm → success", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    await user.type(await screen.findByLabelText("Amount"), "350");
    expect(screen.getByText(/available ₹1,850/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /continue/i }));

    // Review: recipient, amount, sandbox status, cancel + confirm.
    expect(
      await screen.findByRole("heading", { name: /^confirm$/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Sandbox payment")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /confirm payment/i }),
    ).toBeInTheDocument();
    expect(spend()).toBe(1850); // nothing moved yet

    await user.click(screen.getByRole("button", { name: /confirm payment/i }));

    // Success: calm, with Done and View activity.
    expect(
      await screen.findByRole("heading", { name: /payment sent/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/to riya patel/i)).toBeInTheDocument();
    expect(screen.getByText("Sandbox transaction")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /view activity/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^done$/i })).toBeInTheDocument();
    expect(spend()).toBe(1500); // 1850 − 350
  });

  it("keeps continue disabled until a valid amount exists", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    const continueBtn = await screen.findByRole("button", {
      name: /continue/i,
    });
    expect(continueBtn).toBeDisabled();
    expect(screen.getByText("Enter an amount.")).toBeInTheDocument();

    await user.type(screen.getByLabelText("Amount"), "5");
    expect(continueBtn).toBeEnabled();
  });

  it("blocks an amount above the balance with a readable error", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    await user.type(await screen.findByLabelText("Amount"), "5000");
    expect(
      screen.getByText(/you have ₹1,850 available/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });

  it("ignores letters and non-numeric input in the amount field", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    const input = await screen.findByLabelText("Amount");
    await user.type(input, "a5b2");
    expect(input).toHaveValue("52");
  });

  it("double-clicking confirm still creates exactly one payment", async () => {
    renderFlow();

    // Drive the flow synchronously so both confirm clicks land in the
    // same tick — the worst case for double submissions.
    fireEvent.click(screen.getByRole("button", { name: /riya patel/i }));
    const amountInput = await screen.findByLabelText("Amount");
    fireEvent.change(amountInput, { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));
    const confirm = await screen.findByRole("button", {
      name: /confirm payment/i,
    });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    expect(
      await screen.findByRole("heading", { name: /payment sent/i }),
    ).toBeInTheDocument();
    expect(spend()).toBe(1750); // debited exactly once
  });
});

describe("pay flow — request", () => {
  it("walks a request: amount + note → review → sent, balance untouched", async () => {
    const user = userEvent.setup();
    renderFlow("request");

    expect(
      screen.getByText(/who are you requesting from/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /kabir mehta/i }));
    await user.type(await screen.findByLabelText("Amount"), "200");
    await user.type(
      await screen.findByLabelText(/note \(optional\)/i),
      "Café split",
    );
    await user.click(screen.getByRole("button", { name: /continue/i }));

    expect(
      await screen.findByText("Sandbox request — nothing moves yet"),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(
      await screen.findByRole("heading", { name: /request sent/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/from kabir mehta/i)).toBeInTheDocument();
    expect(spend()).toBe(1850); // requests move nothing
  });

  it("cancelling from review returns to the recipient step", async () => {
    const user = userEvent.setup();
    renderFlow();

    await user.click(screen.getByRole("button", { name: /riya patel/i }));
    await user.type(await screen.findByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: /continue/i }));
    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(
      await screen.findByText(/who are you paying/i),
    ).toBeInTheDocument();
    expect(spend()).toBe(1850);
  });
});
