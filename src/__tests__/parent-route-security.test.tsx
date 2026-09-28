import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { TestApp } from "./helpers/app";
import { linkedDatabase, preloadDatabase, SANDBOX_KEY } from "./helpers/fixtures";
import { navigate, resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

async function go(path: string) {
  act(() => navigate(path));
  await settle();
}

async function signedIn(accountId: string, role: "teen" | "parent", path: string) {
  const service = createSandboxAuthService();
  await service.signIn({ method: "sandbox", accountId, role }, Date.now());
  resetRouter(path);
  const view = render(<TestApp service={service} />);
  await settle();
  return view;
}

afterEach(() => {
  cleanup();
  window.localStorage.removeItem(SANDBOX_KEY);
});

/**
 * The /parent route is parent-only, and nothing about the parent
 * surface renders before authentication completes. The gate is the
 * existing one (RoleGate + the auth gate) — Phase 15 adds no second
 * permission system, and these tests pin that down.
 */
describe("/parent route protection", () => {
  it("explains the parent view to a teen and shows none of the control center", async () => {
    preloadDatabase(linkedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/parent");

    // The gate explains instead of exposing.
    expect(screen.getByRole("heading", { name: "Parent view" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /switch to parent/i })).toBeInTheDocument();

    // Nothing from the control center leaks into the teen view.
    // (Aarav's own name appears in the app shell — it's his account.)
    expect(screen.queryByText(/Hello, Priya/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit rules/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Approvals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Controls" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Pocket money" })).not.toBeInTheDocument();
    expect(screen.queryByText("₹1,850")).not.toBeInTheDocument();
  });

  it("shows the sign-in screen to a signed-out visitor — no parent data before auth", async () => {
    preloadDatabase(linkedDatabase());
    resetRouter("/parent");
    render(<TestApp />);
    await settle();

    expect(await screen.findByRole("heading", { name: "Welcome to TeenPay" })).toBeInTheDocument();
    // The stored database holds the linked family; none of it renders.
    expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument();
    expect(screen.queryByText("Priya")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Approvals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Controls" })).not.toBeInTheDocument();
  });

  it("never renders parent data while authentication is still settling", async () => {
    preloadDatabase(linkedDatabase());
    const service = createSandboxAuthService();
    // Sign in but land on the page immediately — the first paints must
    // not flash the control center for an unauthenticated visitor.
    await service.signIn({ method: "sandbox", accountId: SEED_PARENT_ID, role: "parent" }, Date.now());
    await service.signOut("user");
    resetRouter("/parent");
    render(<TestApp service={service} />);
    await settle();

    expect(screen.getByRole("heading", { name: "Welcome to TeenPay" })).toBeInTheDocument();
    expect(screen.queryByText("Aarav Sharma")).not.toBeInTheDocument();
  });

  it("a direct /parent visit as parent reaches the control center through the real gate", async () => {
    preloadDatabase(linkedDatabase());
    await signedIn(SEED_PARENT_ID, "parent", "/parent");

    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Approvals" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Controls" })).toBeInTheDocument();
  });

  it("navigating to /parent as teen after sign-in stays gated", async () => {
    preloadDatabase(linkedDatabase());
    await signedIn(SEED_TEEN_ID, "teen", "/");
    await go("/parent");

    expect(screen.getByRole("heading", { name: "Parent view" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Controls" })).not.toBeInTheDocument();
  });
});
