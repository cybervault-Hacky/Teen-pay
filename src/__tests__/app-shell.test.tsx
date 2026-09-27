import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/font/local", () => ({
  default: () => ({ className: "inter-mock", variable: "--font-inter" }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href: string;
      children?: React.ReactNode;
      [key: string]: unknown;
    }) => React.createElement("a", props, props.children),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

import { AppShell } from "@/components/layout/app-shell";
import { SandboxProvider } from "@/sandbox/store";
import HomePage from "@/app/page";

/**
 * The shell renders desktop and mobile navigation side by side in
 * the DOM; the sandbox provider wraps content exactly as the root
 * layout does.
 */
function renderHome() {
  return render(
    <SandboxProvider>
      <AppShell>
        <HomePage />
      </AppShell>
    </SandboxProvider>,
  );
}

function desktopNav(): HTMLElement {
  const navs = screen.getAllByRole("navigation");
  const nav = navs[0];
  if (!nav) throw new Error("desktop navigation not found");
  return nav;
}

describe("application boots", () => {
  it("renders the main route with the derived balance", () => {
    renderHome();

    expect(
      screen.getByRole("heading", { name: /hi, aarav/i }),
    ).toBeInTheDocument();
    // Seed ledger: 2500 + 1500 + 500 − 1500 − 800 − 350 = 1850.
    // Phase 6: Home shows the available balance once (the four space
    // tiles, including "Spend", gave way to a compact Spaces summary).
    expect(screen.getAllByText("₹1,850").length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(/aarav.s wallet · ₹4,150 total/i),
    ).toBeInTheDocument();
  });

  it("marks the balance card as a sandbox", () => {
    renderHome();
    expect(screen.getAllByText("Sandbox").length).toBeGreaterThan(0);
  });

  it("renders the core Home sections", () => {
    renderHome();

    for (const section of ["Money Spaces", "Recent activity"]) {
      expect(screen.getByText(section)).toBeInTheDocument();
    }
    // Phase 6: the compact Spaces summary — each Space's balance is
    // derived from the seed ledger; the total set aside is ₹2,300.
    expect(screen.getByText("₹800")).toBeInTheDocument(); // Save
    expect(screen.getByText("₹1,500")).toBeInTheDocument(); // New Bike
    expect(screen.getByText(/₹2,300 set aside in 2 spaces/)).toBeInTheDocument();
    // Upcoming (₹200 pending) is shown by the request teaser, not as money.
    expect(screen.getByText(/₹200 expected/i)).toBeInTheDocument();
  });

  it("shows the pending request teaser and unread bell", () => {
    renderHome();
    expect(screen.getByText(/₹200 expected/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /notifications, 1 unread/i }),
    ).toBeInTheDocument();
  });

  it("exposes every primary navigation destination", () => {
    renderHome();

    const nav = desktopNav();
    for (const label of ["Home", "Pay", "Money", "Activity", "Profile"]) {
      expect(
        within(nav).getByRole("link", {
          name: new RegExp(`^${label}$`, "i"),
        }),
      ).toBeInTheDocument();
    }
  });

  it("marks the current route as the active page", () => {
    renderHome();

    const nav = desktopNav();
    expect(within(nav).getByRole("link", { name: /^home$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(nav).getByRole("link", { name: /^pay$/i }),
    ).not.toHaveAttribute("aria-current");
  });
});
