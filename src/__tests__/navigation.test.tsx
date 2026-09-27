import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

let currentPathname = "/";

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
  usePathname: () => currentPathname,
}));

import { SideNav } from "@/components/layout/side-nav";
import { TabBar } from "@/components/layout/tab-bar";
import { SandboxProvider } from "@/sandbox/store";

beforeEach(() => {
  currentPathname = "/";
});

/** SideNav reads the family from the sandbox store. */
function renderSideNav() {
  render(
    <SandboxProvider>
      <SideNav />
    </SandboxProvider>,
  );
}

describe("navigation", () => {
  it("desktop rail links to all destinations with the right hrefs", () => {
    renderSideNav();

    const expected: [string, string][] = [
      ["/", "home"],
      ["/pay", "pay"],
      ["/money", "money"],
      ["/activity", "activity"],
      ["/profile", "profile"],
    ];

    for (const [href, label] of expected) {
      const link = screen.getByRole("link", {
        name: new RegExp(`^${label}$`, "i"),
      });
      expect(link).toHaveAttribute("href", href);
    }
  });

  it("desktop rail highlights the active route", () => {
    currentPathname = "/activity";
    renderSideNav();

    expect(screen.getByRole("link", { name: /^activity$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: /^home$/i })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("mobile tab bar mirrors the same destinations", () => {
    currentPathname = "/pay";
    render(<TabBar />);

    for (const label of ["Home", "Pay", "Money", "Activity", "Profile"]) {
      expect(
        screen.getByRole("link", { name: new RegExp(`^${label}$`, "i") }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: /^pay$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
