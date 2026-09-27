import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards the design-token contract: semantic raw variables, their
 * mapping into Tailwind utilities, and the light-theme override.
 * If these disappear, the whole system degrades to hard-coded colors.
 */
const css = readFileSync(
  path.resolve(process.cwd(), "src/app/globals.css"),
  "utf8",
);

describe("design tokens", () => {
  it("defines semantic surface, line, text, brand, and state variables", () => {
    const required = [
      "--bg",
      "--surface",
      "--surface-2",
      "--surface-3",
      "--line",
      "--line-strong",
      "--ink",
      "--ink-muted",
      "--ink-faint",
      "--accent",
      "--accent-strong",
      "--on-accent",
      "--success",
      "--warning",
      "--danger",
    ];

    for (const token of required) {
      expect(css, `missing token ${token}`).toContain(`${token}:`);
    }
  });

  it("maps tokens to Tailwind utilities via @theme", () => {
    expect(css).toMatch(/@theme inline/);
    expect(css).toContain("--color-surface: var(--surface)");
    expect(css).toContain("--color-ink: var(--ink)");
    expect(css).toContain("--color-accent: var(--accent)");
    expect(css).toContain("--font-sans:");
  });

  it("is dark-first and provides a light theme override", () => {
    expect(css).toContain("color-scheme: dark");
    expect(css).toContain('[data-theme="light"]');
    expect(css).toContain("color-scheme: light");
  });

  it("respects reduced motion at the base layer", () => {
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
