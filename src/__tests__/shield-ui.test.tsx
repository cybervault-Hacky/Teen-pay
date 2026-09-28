import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { PeerFlow } from "@/components/peer/peer-flow";
import { PeerRequestCard } from "@/components/peer/peer-request-card";
import { selectIncomingRequests } from "@/sandbox/selectors";
import { createMoneyRequestTransition, sendMoneyTransition } from "@/sandbox/peer-transitions";
import { updateShieldSettingsTransition } from "@/sandbox/shield";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID, buildSeedDatabase } from "@/sandbox/seed";
import { SandboxProvider, useSandbox } from "@/sandbox/store";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { preloadDatabase, storedDatabase } from "./helpers/fixtures";
import { resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

/**
 * Phase 14 UI: the Safety Shield surfaces as calm, keyboard-accessible
 * context — an optional pause before review, inline notices, a
 * premium /safety page, and guidance that never moves money itself.
 * jsdom + Testing Library: an automated UI check, not a real browser.
 */
configure({ asyncUtilTimeout: 8000 });

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

const NOW = new Date().toISOString();

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
});

function renderFlow(db: SandboxDatabase) {
  preloadDatabase(db);
  return render(
    <SandboxProvider viewerId={SEED_TEEN_ID}>
      <PeerFlow mode="send" />
    </SandboxProvider>,
  );
}

async function pickMeera(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("searchbox", { name: /who are you sending to/i }), "mee");
  const list = await screen.findByRole("list", { name: "TeenPay users" });
  await user.click(within(list).getByRole("button", { name: /Meera Kapoor/ }));
}

async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 400)));
}

async function signedIn(accountId: string, role: "teen" | "parent", path: string) {
  const service = createSandboxAuthService();
  await service.signIn({ method: "sandbox", accountId, role }, Date.now());
  resetRouter(path);
  const view = render(<TestApp service={service} />);
  await settle();
  return view;
}

describe("Send flow — calm context inline on the review", () => {
  it("a first-time send shows its reasons on the review; confirming still moves money exactly once", async () => {
    const user = userEvent.setup();
    renderFlow(buildSeedDatabase());
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // The normal review — with the shield's context inline above it.
    expect(await screen.findByRole("heading", { name: "Send ₹100" })).toBeInTheDocument();
    const note = screen.getByRole("note", { name: "Safety Shield" });
    expect(within(note).getByText("First payment to @meera")).toBeInTheDocument();
    expect(within(note).getByText(/isn't in your Friend Circle/)).toBeInTheDocument();
    expect(
      within(note).getByText(/You're in control — nothing moves until you confirm\./),
    ).toBeInTheDocument();
    // Nothing has moved before confirming.
    expect(storedDatabase().ledger).toHaveLength(buildSeedDatabase().ledger.length);

    await user.click(screen.getByRole("button", { name: "Send ₹100" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    await waitFor(() =>
      expect(storedDatabase().ledger.length).toBe(buildSeedDatabase().ledger.length + 2),
    );
  });

  it("backing out of the review spends nothing", async () => {
    const user = userEvent.setup();
    renderFlow(buildSeedDatabase());
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Send ₹100" });
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByLabelText("Amount")).toBeInTheDocument();
    expect(storedDatabase().ledger).toHaveLength(buildSeedDatabase().ledger.length);
  });

  it("a large first payment shows both reasons together on the review", async () => {
    const user = userEvent.setup();
    renderFlow(buildSeedDatabase());
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "1000");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Send ₹1,000" });
    const note = screen.getByRole("note", { name: "Safety Shield" });
    expect(within(note).getByText("First payment to @meera")).toBeInTheDocument();
    expect(within(note).getByText("A large part of your money")).toBeInTheDocument();
  });

  it("a known recipient gets a clean review — no shield card", async () => {
    const user = userEvent.setup();
    const known = sendMoneyTransition(buildSeedDatabase(), {
      actorId: SEED_TEEN_ID,
      at: NOW,
      recipient: "@meera",
      amount: 50,
      idempotencyKey: "snd_ui_k1",
    });
    if (!known.result.ok) throw new Error("setup");
    renderFlow(known.db);
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "50");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Send ₹50" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "Safety Shield" })).not.toBeInTheDocument();
  });

  it("a switched-off reminder never hides its reason — it stays visible as a notice", async () => {
    const user = userEvent.setup();
    let db = buildSeedDatabase();
    const saved = updateShieldSettingsTransition(db, {
      actorId: SEED_TEEN_ID,
      at: NOW,
      patch: { firstTimeRecipient: false },
    });
    if (!saved.result.ok) throw new Error("setup");
    db = saved.db;
    renderFlow(db);
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // The review shows the reason either way — softened, never removed.
    expect(await screen.findByRole("heading", { name: "Send ₹100" })).toBeInTheDocument();
    const note = screen.getByRole("note", { name: "Safety Shield" });
    expect(within(note).getByText("First payment to @meera")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Send ₹100" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
  });
});

describe("Request cards — calm context on incoming requests", () => {
  function RequestFixture() {
    const { state } = useSandbox();
    const views = selectIncomingRequests(state, NOW);
    if (views.length === 0) return null;
    return <PeerRequestCard request={views[0]!} onOutcome={() => {}} />;
  }

  it("a first request from a stranger shows the gentle notice and keeps the controls", async () => {
    const db = createMoneyRequestTransition(buildSeedDatabase(), {
      actorId: SEED_PEER_ID,
      at: NOW,
      payer: "@aarav",
      amount: 60,
      idempotencyKey: "prq_ui_shd1",
    }).db;
    preloadDatabase(db);
    render(
      <SandboxProvider viewerId={SEED_TEEN_ID}>
        <RequestFixture />
      </SandboxProvider>,
    );
    expect(await screen.findByText(/A request from @meera/)).toBeInTheDocument();
    expect(
      screen.getByText(/You don't need to accept requests from people you don't know/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pay ₹60" })).toBeInTheDocument();
  });

  it("no notice once money has moved between you", async () => {
    let db = sendMoneyTransition(buildSeedDatabase(), {
      actorId: SEED_TEEN_ID,
      at: NOW,
      recipient: "@meera",
      amount: 50,
      idempotencyKey: "snd_ui_shd2",
    }).db;
    db = createMoneyRequestTransition(db, {
      actorId: SEED_PEER_ID,
      at: NOW,
      payer: "@aarav",
      amount: 60,
      idempotencyKey: "prq_ui_shd2",
    }).db;
    preloadDatabase(db);
    render(
      <SandboxProvider viewerId={SEED_TEEN_ID}>
        <RequestFixture />
      </SandboxProvider>,
    );
    await screen.findByRole("button", { name: "Pay ₹60" });
    expect(screen.queryByText(/You don't need to accept requests/)).not.toBeInTheDocument();
  });
});

describe("Scan page — verify before continuing", () => {
  it("a resolved QR keeps its identity-only guidance", async () => {
    const user = userEvent.setup();
    preloadDatabase(buildSeedDatabase());
    resetRouter("/qr/scan");
    const { default: ScanPage } = await import("@/app/qr/scan/page");
    render(
      <SandboxProvider viewerId={SEED_TEEN_ID}>
        <ScanPage />
      </SandboxProvider>,
    );
    const input = await screen.findByLabelText("Use a sandbox QR");
    await user.type(input, "teenpay://user/@meera?v=1");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    expect(await screen.findByText("Meera Kapoor")).toBeInTheDocument();
    expect(
      screen.getByText(/Verify the TeenPay ID before continuing/),
    ).toBeInTheDocument();
    expect(screen.getByText(/nothing is paid, requested or saved by a scan/i)).toBeInTheDocument();
    // Identity only — the actions are still explicit choices.
    expect(screen.getByRole("button", { name: "Pay" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Request" })).toBeInTheDocument();
    expect(storedDatabase().ledger).toHaveLength(buildSeedDatabase().ledger.length);
  });
});

describe("Safety Shield page (/safety)", () => {
  it("shows required protections, optional reminders and the privacy promise", async () => {
    await signedIn(SEED_TEEN_ID, "teen", "/safety");

    expect(await screen.findByRole("heading", { name: "Safety Shield" })).toBeInTheDocument();
    expect(screen.getByText(/You're in control/)).toBeInTheDocument();

    // Required protections are facts — listed, not togglable.
    for (const title of [
      "Guardian approvals",
      "Daily and per-payment limits",
      "Balance and wallet checks",
      "One payment per action",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.getByText(/can't be switched off here — by anyone/)).toBeInTheDocument();

    // Three optional reminder switches, all on by default.
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    for (const sw of switches) expect(sw).toHaveAttribute("aria-checked", "true");

    expect(screen.getByText(/no scoring, no background watching/)).toBeInTheDocument();
  });

  it("toggling a reminder works by keyboard and announces the change", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/safety");
    const switches = await screen.findAllByRole("switch");
    switches[0]!.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(switches[0]).toHaveAttribute("aria-checked", "false"));
    expect(await screen.findByText("First-time recipient checks off.")).toBeInTheDocument();

    // The choice persists — and it's the only shield data stored.
    const stored = JSON.parse(window.localStorage.getItem("teenpay-sandbox-v1") ?? "null") as SandboxDatabase;
    expect(stored.shieldSettings).toHaveLength(1);
    expect(stored.shieldSettings![0]).toMatchObject({
      ownerAccountId: SEED_TEEN_ID,
      firstTimeRecipient: false,
      largePayments: true,
      repeatedPayments: true,
    });
  });

  it("parents see the role gate, not the teen's shield", async () => {
    await signedIn(SEED_PARENT_ID, "parent", "/safety");
    expect(await screen.findByText(/This is .* space/)).toBeInTheDocument();
    expect(screen.queryByText("Optional reminders")).not.toBeInTheDocument();
  });

  it("links from the profile's Safety section", async () => {
    await signedIn(SEED_TEEN_ID, "teen", "/profile");
    const safety = await screen.findByRole("region", { name: "Safety" });
    const link = within(safety).getByRole("link", { name: /Safety Shield/ });
    expect(link).toHaveAttribute("href", "/safety");
  });
});
