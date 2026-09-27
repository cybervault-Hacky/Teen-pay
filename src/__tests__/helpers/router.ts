import { useSyncExternalStore } from "react";

/**
 * A tiny in-memory stand-in for the Next.js App Router, so UI tests
 * can run the real AppShell/AuthGate/pages and follow redirects.
 * Tests use it via `vi.mock("next/navigation", ...)`.
 */
const listeners = new Set<() => void>();
export const nav = { url: "/", history: [] as string[] };

export function navigate(to: string): void {
  nav.url = to;
  nav.history.push(to);
  for (const listener of listeners) listener();
}

export function resetRouter(to = "/"): void {
  nav.url = to;
  nav.history = [to];
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function currentPath(): string {
  return nav.url.split(/[?#]/)[0] ?? "/";
}

export function usePathname(): string {
  return useSyncExternalStore(subscribe, currentPath, currentPath);
}

export function useSearchParams(): URLSearchParams {
  const url = useSyncExternalStore(subscribe, () => nav.url, () => nav.url);
  return new URLSearchParams(url.split("?")[1] ?? "");
}

const router = {
  push: (to: string) => navigate(to),
  replace: (to: string) => navigate(to),
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  prefetch: () => undefined,
};

export function useRouter() {
  return router;
}
