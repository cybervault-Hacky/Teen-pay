import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SANDBOX_SESSION_TTL_MS,
  SESSION_STORAGE_KEY,
  createSandboxAuthService,
} from "@/auth/sandbox-service";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { SANDBOX_KEY } from "./helpers/fixtures";
import { nav, resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

const T0 = Date.parse("2026-09-26T06:00:00Z");

function storedDb(): SandboxDatabase | null {
  const raw = window.localStorage.getItem(SANDBOX_KEY);
  return raw ? (JSON.parse(raw) as SandboxDatabase) : null;
}

function storedSession(): Record<string, unknown> | null {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

beforeEach(() => {
  resetRouter("/");
});

// ── The auth service on its own ──────────────────────────────────

describe("sandbox auth service", () => {
  it("restores as signed out when nothing is stored", () => {
    const service = createSandboxAuthService();
    expect(service.restore(T0)).toEqual({ kind: "signed_out", notice: null });
    expect(service.provider).toMatchObject({
      label: "Sandbox session",
      isRealAuthentication: false,
      usesCredentials: false,
    });
  });

  it("opens a typed session with an 8-hour expiry and stores no secrets", async () => {
    const service = createSandboxAuthService({ newSessionId: () => "ses_test" });
    const session = await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, T0);
    expect(session).toEqual({
      sessionId: "ses_test",
      accountId: SEED_TEEN_ID,
      role: "teen",
      provider: "sandbox",
      assurance: "sandbox_unverified",
      createdAt: new Date(T0).toISOString(),
      expiresAt: new Date(T0 + SANDBOX_SESSION_TTL_MS).toISOString(),
    });
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY) ?? "";
    expect(raw).not.toMatch(/password|token|secret|key"|credential|hash/i);
    // A reload restores the same session.
    expect(createSandboxAuthService().restore(T0 + 1000)).toEqual({ kind: "authenticated", session });
  });

  it("sign-out clears only the session", async () => {
    window.localStorage.setItem(SANDBOX_KEY, "{}");
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, T0);
    service.signOut("user");
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    expect(window.localStorage.getItem(SANDBOX_KEY)).toBe("{}");
    expect(service.restore(T0).kind).toBe("signed_out");
  });

  it("an expired session restores as expired (once), then the notice can be cleared", async () => {
    const service = createSandboxAuthService({ newSessionId: () => "ses_old" });
    await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, T0);
    const later = T0 + SANDBOX_SESSION_TTL_MS + 1;
    expect(service.restore(later)).toEqual({
      kind: "expired",
      accountId: SEED_TEEN_ID,
      sessionId: "ses_old",
      alreadyNoted: false,
    });
    // After a reload the message still shows, without re-recording the event.
    expect(service.restore(later)).toMatchObject({ kind: "expired", alreadyNoted: true });
    service.clearNotice();
    expect(service.restore(later).kind).toBe("signed_out");
  });

  it("treats malformed or foreign session data as signed out", () => {
    for (const bad of ["not json", '{"version":2}', '{"version":1,"session":{"accountId":1}}']) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, bad);
      expect(createSandboxAuthService().restore(T0).kind).toBe("signed_out");
    }
  });

  it("rejects unsupported methods and empty accounts with friendly errors", async () => {
    const service = createSandboxAuthService();
    const bad = await service.signIn({ method: "password" as never, accountId: "x", role: "teen" }, T0);
    expect(bad).toMatchObject({ code: "unsupported_method" });
    const empty = await service.signIn({ method: "sandbox", accountId: "", role: "teen" }, T0);
    expect(empty).toMatchObject({ code: "sign_in_failed" });
  });
});

// ── The app: gate, sign-in, sign-out, expiry, create account ─────

describe("auth gate and screens", () => {
  it("starts signed out: protected screens send you to sign in, nothing protected renders", async () => {
    resetRouter("/parent");
    render(<TestApp />);
    expect(await screen.findByRole("heading", { name: "Welcome to TeenPay" })).toBeInTheDocument();
    expect(nav.url).toBe("/sign-in?next=%2Fparent");
    expect(screen.queryAllByRole("navigation", { name: "Primary" })).toHaveLength(0);
    expect(screen.queryByRole("heading", { name: "Overview" })).not.toBeInTheDocument();
    expect(screen.getByText("Sandbox session — not real sign-in")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue as teen/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /continue as parent/i })).toBeInTheDocument();
    // No fake security claims.
    expect(document.body.textContent).not.toMatch(/bank-grade|kyc verified|guardian verified/i);
  });

  it("sandbox sign-in, restore on reload, then sign-out keeps the data", async () => {
    const user = userEvent.setup();
    resetRouter("/sign-in");
    const view = render(<TestApp />);
    await user.click(await screen.findByRole("button", { name: /continue as teen/i }));
    await waitFor(() => expect(nav.url).toBe("/"));
    expect(storedSession()?.session).toMatchObject({ accountId: SEED_TEEN_ID, role: "teen" });

    // Reload on Profile: the session is restored, not re-created.
    view.unmount();
    resetRouter("/profile");
    render(<TestApp />);
    expect(await screen.findByRole("heading", { name: "Security" })).toBeInTheDocument();
    expect(screen.getByText(/^Sandbox session · started/)).toBeInTheDocument();
    expect(screen.getAllByText("Aarav Sharma").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /^sign out$/i }));
    await waitFor(() => expect(nav.url).toBe("/sign-in"));
    expect(await screen.findByRole("heading", { name: "Welcome to TeenPay" })).toBeInTheDocument();
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    const db = storedDb();
    expect(db?.accounts.length).toBe(3); // data kept (Aarav, Priya, Meera)
    const types = db?.securityEvents.filter((e) => e.accountId === SEED_TEEN_ID).map((e) => e.type);
    expect(types).toEqual(expect.arrayContaining(["sign_in", "sign_out"]));
  });

  it("session expiry sends you to sign in with a friendly message and no data loss", async () => {
    const user = userEvent.setup();
    let clock = T0;
    resetRouter("/sign-in?next=%2Fprofile");
    render(<TestApp now={() => clock} />);
    await user.click(await screen.findByRole("button", { name: /continue as parent/i }));
    await waitFor(() => expect(nav.url).toBe("/profile"));
    expect(await screen.findByRole("heading", { name: "Security" })).toBeInTheDocument();
    const before = JSON.stringify(storedDb()?.wallets);

    // Time passes beyond the session's life; the tab regains focus.
    clock = T0 + SANDBOX_SESSION_TTL_MS + 1000;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session has expired. Please sign in again.",
    );
    expect(nav.url).toBe("/sign-in?next=%2Fprofile");
    expect(JSON.stringify(storedDb()?.wallets)).toBe(before);
    expect(
      storedDb()?.securityEvents.some(
        (e) => e.type === "session_expired" && e.accountId === SEED_PARENT_ID,
      ),
    ).toBe(true);
    // No internals leak into the message.
    expect(document.body.textContent).not.toMatch(/ses_|token|stack|undefined/i);

    // Signing in again works and clears the message.
    await user.click(screen.getByRole("button", { name: /continue as parent/i }));
    await waitFor(() => expect(nav.url).toBe("/profile"));
  });

  it("the sandbox 'expire session now' control behaves like a real expiry", async () => {
    const user = userEvent.setup();
    resetRouter("/sign-in?next=%2Fprofile");
    render(<TestApp />);
    await user.click(await screen.findByRole("button", { name: /continue as teen/i }));
    await user.click(await screen.findByRole("button", { name: /sandbox: expire session now/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/session has expired/i);
    expect(storedDb()?.accounts.length).toBe(3);
  });

  it("an expired session found on reload shows the expiry message", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        session: {
          sessionId: "ses_old",
          accountId: SEED_TEEN_ID,
          role: "teen",
          provider: "sandbox",
          assurance: "sandbox_unverified",
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-01-01T08:00:00.000Z",
        },
      }),
    );
    resetRouter("/money");
    render(<TestApp />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/session has expired/i);
    expect(nav.url).toBe("/sign-in?next=%2Fmoney");
  });

  it("a session for an account that no longer exists signs out safely", async () => {
    window.localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        session: {
          sessionId: "ses_ghost",
          accountId: "usr_ghost",
          role: "parent",
          provider: "sandbox",
          assurance: "sandbox_unverified",
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        },
      }),
    );
    resetRouter("/parent");
    render(<TestApp />);
    expect(await screen.findByText(/isn't available on this device any more/i)).toBeInTheDocument();
    expect(nav.url.startsWith("/sign-in")).toBe(true);
    expect(screen.queryByRole("heading", { name: "Overview" })).not.toBeInTheDocument();
  });

  it("a signed-in person visiting /sign-in goes to their home", async () => {
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_PARENT_ID, role: "parent" }, Date.now());
    resetRouter("/sign-in");
    render(<TestApp />);
    await waitFor(() => expect(nav.url).toBe("/parent"));
  });

  it("ignores unsafe ?next= values (no open redirects)", async () => {
    const user = userEvent.setup();
    resetRouter("/sign-in?next=%2F%2Fevil.example");
    render(<TestApp />);
    await user.click(await screen.findByRole("button", { name: /continue as teen/i }));
    await waitFor(() => expect(nav.url).toBe("/"));
  });

  it("the 404 works while signed out, without app navigation", async () => {
    resetRouter("/nope");
    render(<TestApp />);
    expect(await screen.findByText("This page doesn't exist")).toBeInTheDocument();
    expect(screen.queryAllByRole("navigation", { name: "Primary" })).toHaveLength(0);
    expect(nav.url).toBe("/nope");
  });
});

describe("create account", () => {
  it("validates the TeenPay ID live, rejects a taken one, then creates and signs in", async () => {
    const user = userEvent.setup();
    resetRouter("/create-account");
    render(<TestApp />);
    expect(await screen.findByRole("heading", { name: "Create a sandbox account" })).toBeInTheDocument();
    // Collects only role, name and ID.
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /^teen/i })).toHaveAttribute("aria-checked", "true");

    // Submitting empty shows field errors and focuses the first one.
    await user.click(screen.getByRole("button", { name: "Create account" }));
    expect(screen.getByText("Enter a name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Your name")).toHaveFocus();

    await user.type(screen.getByLabelText("Your name"), "Kabir Mehta");
    await user.type(screen.getByLabelText("TeenPay ID"), "AARAV");
    expect(screen.getByText("That ID is already taken in this sandbox.")).toBeInTheDocument();
    expect(screen.getByLabelText("TeenPay ID")).toHaveAttribute("aria-invalid", "true");

    await user.clear(screen.getByLabelText("TeenPay ID"));
    await user.type(screen.getByLabelText("TeenPay ID"), "@Kabir");
    expect(screen.getByText("Available — you'll be @kabir")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(nav.url).toBe("/"));
    const db = storedDb();
    const kabir = db?.accounts.find((a) => a.username === "kabir");
    expect(kabir).toMatchObject({ role: "teen", name: "Kabir Mehta", status: "active" });
    expect(storedSession()?.session).toMatchObject({ accountId: kabir?.id, role: "teen" });
    // A brand-new teen's wallet is empty — no money appears from nowhere.
    // Phase 5: Kabir owns an explicit wallet with no entries in it.
    expect(db?.wallets.find((w) => w.ownerAccountId === kabir?.id)?.status).toBe("active");
    expect(db?.ledger.filter((e) => e.accountId === kabir?.id)).toEqual([]);
    // Aarav's wallet is untouched and invisible to Kabir.
    expect(db?.ledger.filter((e) => e.accountId === SEED_TEEN_ID).length).toBe(6);
  });

  it("creates a parent account that lands on the parent overview", async () => {
    const user = userEvent.setup();
    resetRouter("/create-account");
    render(<TestApp />);
    await user.click(await screen.findByRole("radio", { name: /^parent/i }));
    await user.type(screen.getByLabelText("Your name"), "Neha Mehta");
    await user.type(screen.getByLabelText("TeenPay ID"), "neha");
    await user.click(screen.getByRole("button", { name: "Create account" }));
    await waitFor(() => expect(nav.url).toBe("/parent"));
    // Not connected to anyone yet: no teen money shown.
    expect(storedDb()?.accounts.find((a) => a.username === "neha")?.role).toBe("parent");
  });
});
