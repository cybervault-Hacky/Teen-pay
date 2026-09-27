import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { AppShell } from "@/components/layout/app-shell";
import { SandboxProvider } from "@/sandbox/store";
import HomePage from "@/app/page";

function renderHome() {
  render(
    <SandboxProvider>
      <AppShell>
        <HomePage />
      </AppShell>
    </SandboxProvider>,
  );
}

describe("home — notifications", () => {
  it("opens the notification center from the bell", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("button", { name: /notifications/i }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Notifications")).toBeInTheDocument();
    // Seeded events plus their generated kind labels.
    expect(within(dialog).getByText("Pocket money received")).toBeInTheDocument();
    expect(within(dialog).getByText("Request sent")).toBeInTheDocument();
    expect(within(dialog).getByText("Goal update")).toBeInTheDocument();
  });

  it("marks all notifications read and the unread dot disappears", async () => {
    const user = userEvent.setup();
    renderHome();

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(screen.getByRole("button", { name: /mark all read/i }));
    await user.keyboard("{Escape}");

    expect(
      screen.getByRole("button", { name: /^notifications$/i }),
    ).toBeInTheDocument(); // no ", N unread" suffix anymore
  });

  it("links quick actions to the right destinations", () => {
    renderHome();

    const links = screen.getAllByRole("link");
    const pay = links.find((l) => l.textContent === "Pay");
    const request = links.find((l) => l.textContent === "Request");
    const send = links.find((l) => l.textContent === "Send");
    expect(pay?.getAttribute("href")).toBe("/pay");
    // Phase 8: Request asks another TeenPay teen (contacts: /pay's toggle).
    expect(request?.getAttribute("href")).toBe("/request");
    expect(send?.getAttribute("href")).toBe("/send");
  });
});
