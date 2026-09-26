import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import MoneyPage from "@/app/money/page";
import NotificationsPage from "@/app/notifications/page";
import ParentPage from "@/app/parent/page";
import PayPage from "@/app/pay/page";
import ProfilePage from "@/app/profile/page";
import { ThemeProvider } from "@/app/providers";
import { createSeedState, SandboxProvider, type SandboxState } from "@/sandbox";

const navState = vi.hoisted(() => ({ search: "" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(navState.search),
  usePathname: () => "/",
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

afterEach(() => {
  navState.search = "";
});

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

describe("Pay", () => {
  it("sends money through amount → review → success", async () => {
    renderPage(<PayPage />);
    expect(screen.getByRole("heading", { name: "Pay" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Diya Patel/ }));
    expect(screen.getByRole("dialog", { name: "Pay Diya" })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("How much for Diya?"), { target: { value: "200" } });
    expect(screen.getByText("₹850 in Spend")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));

    expect(screen.getByRole("dialog", { name: "Review payment" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Pay ₹200" }));

    expect(screen.getByRole("dialog", { name: "Payment sent" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("rejects amounts it cannot afford with guidance", () => {
    renderPage(<PayPage />);
    fireEvent.click(screen.getByRole("button", { name: /Diya Patel/ }));
    fireEvent.change(screen.getByLabelText("How much for Diya?"), { target: { value: "900" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Only ₹850 in Spend");
  });

  it("opens in request mode from ?mode=request and hides places", () => {
    navState.search = "mode=request";
    renderPage(<PayPage />);
    expect(screen.getByRole("heading", { name: "Request" })).toBeInTheDocument();
    expect(screen.queryByText("Blue Tokai")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Meera Sharma/ }));
    fireEvent.change(screen.getByLabelText("How much from Meera?"), { target: { value: "500" } });
    fireEvent.click(screen.getByRole("button", { name: "Send request" }));
    expect(screen.getByRole("dialog", { name: "Request sent" })).toBeInTheDocument();
    expect(screen.getByText("₹500")).toBeInTheDocument();
  });
});

describe("Money", () => {
  it("moves money between spaces", () => {
    renderPage(<MoneyPage />);
    expect(screen.getByText("Available across Spaces")).toBeInTheDocument();
    expect(screen.getByText("Noise Buds Pro")).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Move" })[0]);
    fireEvent.change(screen.getByLabelText("How much?"), { target: { value: "100" } });
    const moveDialog = screen.getByRole("dialog", { name: "Move money" });
    fireEvent.click(within(moveDialog).getByRole("button", { name: "Move money" }));
    expect(screen.getByRole("dialog", { name: "Moved" })).toBeInTheDocument();
    expect(screen.getByText("₹100")).toBeInTheDocument();
  });

  it("tops up a goal from Spend", () => {
    renderPage(<MoneyPage />);
    fireEvent.click(screen.getAllByRole("button", { name: "Add money" })[0]);
    const dialog = screen.getByRole("dialog", { name: "Add to Noise Buds Pro" });
    fireEvent.change(within(dialog).getByLabelText("How much?"), { target: { value: "50" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Add money" }));
    expect(screen.getByRole("dialog", { name: "Added" })).toBeInTheDocument();
    expect(screen.getByText("₹50")).toBeInTheDocument();
  });
});

describe("Parent view", () => {
  it("sends pocket money with a suggestion chip", () => {
    renderPage(<ParentPage />);
    expect(screen.getByText("For parents")).toBeInTheDocument();
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Send pocket money" }));
    fireEvent.click(screen.getByRole("button", { name: "₹200" }));
    expect(screen.getByLabelText("How much for Aarav?")).toHaveValue("200");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(screen.getByRole("dialog", { name: "Sent" })).toBeInTheDocument();
  });

  it("fulfills a pending request into the teen balance", () => {
    renderPage(<ParentPage />, seedWithRequest());
    expect(screen.getByText("Asked you directly")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Send ₹200 for this request" }));
    expect(screen.queryByText("Asked you directly")).not.toBeInTheDocument();
    expect(screen.getByText("₹2,650")).toBeInTheDocument();
  });
});

describe("Notifications", () => {
  it("marks everything read", () => {
    renderPage(<NotificationsPage />);
    expect(screen.getByText("1 unread")).toBeInTheDocument();
    expect(screen.getByText("Welcome to your sandbox")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark all read" }));
    expect(screen.getByText("You're all caught up.")).toBeInTheDocument();
  });
});

describe("Profile", () => {
  it("shows identity, parent entry and a confirmed reset", async () => {
    renderPage(
      <ThemeProvider>
        <ProfilePage />
      </ThemeProvider>,
    );
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("Meera Sharma")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open parent view" })).toHaveAttribute("href", "/parent");

    fireEvent.click(screen.getByRole("button", { name: "Reset sandbox data" }));
    expect(screen.getByRole("dialog", { name: "Reset sandbox data?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reset everything" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
