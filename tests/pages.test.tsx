import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "@/app/page";
import ActivityPage from "@/app/activity/page";

describe("Home", () => {
  it("renders balance, shortcuts, spaces, goal and recent activity", () => {
    render(<HomePage />);

    expect(screen.getByText("Available balance")).toBeInTheDocument();
    expect(screen.getByText("₹2,450")).toBeInTheDocument();

    const actions = screen.getByRole("list", { name: "Quick actions" });
    expect(within(actions).getByRole("link", { name: "Pay" })).toHaveAttribute("href", "/pay");
    expect(within(actions).getByRole("button", { name: "Request" })).toBeInTheDocument();

    expect(screen.getByText("Money Spaces")).toBeInTheDocument();
    expect(screen.getByText("₹850")).toBeInTheDocument();

    expect(screen.getByText("Saving for")).toBeInTheDocument();
    expect(screen.getByText("Noise Buds Pro")).toBeInTheDocument();

    expect(screen.getByText("Monthly pocket money")).toBeInTheDocument();
    expect(
      screen.getByText(/Figures shown are sample data/),
    ).toBeInTheDocument();
  });
});

describe("Activity", () => {
  it("renders the ledger with filters and day groups", () => {
    render(<ActivityPage />);
    expect(screen.getByText("Activity")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pending" })).toBeInTheDocument();
    expect(screen.getByText("Today")).toBeInTheDocument();
  });

  it("filters to money-in only", () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: "In" }));
    expect(screen.getByText("Monthly pocket money")).toBeInTheDocument();
    expect(screen.queryByText("Crossword Bookstore")).not.toBeInTheDocument();
  });

  it("opens a detail sheet for a transaction", () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole("button", { name: /Monthly pocket money/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("September allowance")).toBeInTheDocument();
  });
});
