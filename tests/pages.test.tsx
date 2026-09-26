import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import ActivityPage from "@/app/activity/page";
import { createSeedState, SandboxProvider, type SandboxState } from "@/sandbox";

function renderPage(page: ReactNode, state?: SandboxState) {
  return render(
    <SandboxProvider initialState={state ?? createSeedState(new Date())}>
      {page}
    </SandboxProvider>,
  );
}

function seedWithRequest(): SandboxState {
  const seed = createSeedState(new Date());
  return {
    ...seed,
    requests: [
      {
        id: "req_test",
        requesterId: seed.teenId,
        targetName: "Meera Sharma",
        targetKind: "parent",
        amountPaise: 20_000,
        note: "Books",
        status: "pending",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

describe("Home", () => {
  it("renders balance, shortcuts, spaces, goal and recent activity", () => {
    renderPage(<HomePage />);

    expect(screen.getByText("Available balance")).toBeInTheDocument();
    expect(screen.getByText("₹2,450")).toBeInTheDocument();

    const actions = screen.getByRole("list", { name: "Quick actions" });
    expect(within(actions).getByRole("link", { name: "Pay" })).toHaveAttribute("href", "/pay");
    expect(within(actions).getByRole("link", { name: "Request" })).toHaveAttribute(
      "href",
      "/pay?mode=request",
    );

    expect(screen.getByText("Money Spaces")).toBeInTheDocument();
    expect(screen.getByText("₹850")).toBeInTheDocument();

    expect(screen.getByText("Saving for")).toBeInTheDocument();
    expect(screen.getByText("Noise Buds Pro")).toBeInTheDocument();

    expect(screen.getByText("Monthly pocket money")).toBeInTheDocument();
    expect(screen.getByText(/TeenPay Sandbox · Simulated money/)).toBeInTheDocument();
  });

  it("teases pending requests only when they exist", () => {
    renderPage(<HomePage />);
    expect(screen.queryByText("Pending requests")).not.toBeInTheDocument();
    cleanup();

    renderPage(<HomePage />, seedWithRequest());
    expect(screen.getByText("Pending requests")).toBeInTheDocument();
    expect(screen.getByText("Meera Sharma")).toBeInTheDocument();
  });
});

describe("Activity", () => {
  it("renders the ledger with filters and day groups", () => {
    renderPage(<ActivityPage />);
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pending" })).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("filters to money-in only", () => {
    renderPage(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: "In" }));
    expect(screen.getByText("Monthly pocket money")).toBeInTheDocument();
    expect(screen.queryByText("Crossword Bookstore")).not.toBeInTheDocument();
  });

  it("opens a detail sheet with type, ID and sandbox marker", () => {
    renderPage(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Monthly pocket money/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const month = new Date().toLocaleDateString("en-IN", { month: "long" });
    expect(screen.getByText(`${month} allowance`)).toBeInTheDocument();
    expect(screen.getByText("Transaction ID")).toBeInTheDocument();
    expect(screen.getByText("seed_11")).toBeInTheDocument();
    expect(screen.getByText("Pocket money")).toBeInTheDocument();
  });

  it("cancels a request from its detail sheet", async () => {
    renderPage(<ActivityPage />, seedWithRequest());
    fireEvent.click(screen.getByRole("button", { name: "Pending" }));
    fireEvent.click(screen.getByRole("button", { name: /Money request/ }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
    await waitFor(() => {
      expect(screen.queryByText("Money request")).not.toBeInTheDocument();
    });
    expect(screen.getByText("Split from Diya")).toBeInTheDocument();
  });
});
