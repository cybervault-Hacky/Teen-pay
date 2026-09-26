import { createElement, type ReactNode } from "react";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

/* Testing Library can't auto-register cleanup without globals — wire it up. */
afterEach(() => {
  cleanup();
});

/* Next.js Link renders as a plain anchor outside the App Router. */
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...rest
  }: {
    children: ReactNode;
    href: string;
    [key: string]: unknown;
  }) => createElement("a", { href, ...rest }, children),
}));

/* framer-motion's whileInView needs IntersectionObserver — report visible. */
class MockIntersectionObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

Object.defineProperty(window, "IntersectionObserver", {
  writable: true,
  value: MockIntersectionObserver,
});

/* matchMedia is used by motion feature detection. */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
  }),
});
