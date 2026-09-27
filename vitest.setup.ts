import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";

// Each test starts from a clean DOM and an empty sandbox store, so
// persistence can never leak state between tests.
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

// ────────────────────────────────────────────────────────────────────
// jsdom shims — test environment only.
// jsdom is missing a few browser APIs that framer-motion and layout
// code expect. We install minimal, inert implementations so tests run
// deterministically.
// ────────────────────────────────────────────────────────────────────

window.matchMedia = (query: string): MediaQueryList =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (typeof window.ResizeObserver === "undefined") {
  window.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

// jsdom does not implement scrolling; silence the not-implemented error.
window.scrollTo = () => {};
