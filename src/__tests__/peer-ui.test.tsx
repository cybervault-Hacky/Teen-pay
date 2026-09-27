import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { HomeContent } from "@/components/home/home-content";
import { MoneyContent } from "@/components/money/money-content";
import { PeerFlow } from "@/components/peer/peer-flow";
import { RequestsCenter } from "@/components/peer/requests-center";
import {
  acceptMoneyRequestTransition,
  createMoneyRequestTransition,
  requestIdFor,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { buildSeedDatabase, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { AuthProvider, useOptionalAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { SandboxProvider, useOptionalSandbox, useSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { SandboxDatabase } from "@/sandbox/types";
import { balanceOf, preloadDatabase, storedDatabase } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/requests",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
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

// Real clock: preloaded requests are created "now" so they're open.
const now = () => new Date().toISOString();

let sandbox: SandboxContextValue | null = null;
beforeEach(() => {
  sandbox = null;
  localStorage.clear();
});

function Capture() {
  sandbox = useSandbox();
  return null;
}

function renderAs(viewerId: string, ui: React.ReactNode, db?: SandboxDatabase) {
  if (db) preloadDatabase(db);
  return render(
    <SandboxProvider viewerId={viewerId}>
      <Capture />
      {ui}
    </SandboxProvider>,
  );
}

function ok(out: { db: SandboxDatabase; result: { ok: boolean } }): SandboxDatabase {
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.db;
}

/** Aarav asked Meera for ₹300 ("Movie tickets"), just now. */
function withRequest(base = buildSeedDatabase(), at = now()): SandboxDatabase {
  return ok(
    createMoneyRequestTransition(base, {
      actorId: SEED_TEEN_ID,
      at,
      payer: "@meera",
      amount: 300,
      note: "Movie tickets",
      idempotencyKey: "prq_ui_000001",
    }),
  );
}

async function pickMeera(user: ReturnType<typeof userEvent.setup>, question: RegExp) {
  await user.type(await screen.findByRole("searchbox", { name: question }), "mee");
  const list = await screen.findByRole("list", { name: "TeenPay users" });
  await user.click(within(list).getByRole("button", { name: /Meera Kapoor/ }));
}

describe("Send money flow", () => {
  it("recipient → amount → review → 'Money sent' with amount, recipient, reference and time", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" />, buildSeedDatabase());
    await pickMeera(user, /who are you sending to/i);

    expect(await screen.findByRole("heading", { name: "Send to @meera" })).toHaveFocus();
    expect(screen.getByText(/Available ₹1,850/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "250");
    await user.click(screen.getByRole("button", { name: "Continue" }));

    expect(await screen.findByRole("heading", { name: "Send ₹250" })).toBeInTheDocument();
    expect(screen.getByText("@meera")).toBeInTheDocument();
    expect(screen.getByText("From your available balance")).toBeInTheDocument();
    // Nothing moved before confirming.
    expect(storedDatabase().ledger).toHaveLength(buildSeedDatabase().ledger.length);

    await user.click(screen.getByRole("button", { name: "Send ₹250" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    expect(screen.getByText("to @meera")).toBeInTheDocument();
    expect(screen.getByText(/^TRF-/)).toBeInTheDocument();

    await waitFor(() => expect(balanceOf(storedDatabase(), SEED_PEER_ID)).toBe(1450));
    expect(balanceOf(storedDatabase(), SEED_TEEN_ID)).toBe(1600);
    expect(storedDatabase().operations.filter((o) => o.type === "transfer" && !o.requestId)).toHaveLength(1);
  });

  it("the key made at review is reused: repeating the confirm never sends twice", async () => {
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" />, buildSeedDatabase());
    await screen.findByRole("searchbox");
    const input = { recipient: "@meera", amount: 120, idempotencyKey: "snd_ui_repeat1" };
    const first = sandbox!.actions.sendMoney(input);
    const second = sandbox!.actions.sendMoney(input); // double click / retry, same tick
    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.value.status === "completed" && second.value.replayed).toBe(true);
    await waitFor(() => expect(balanceOf(storedDatabase(), SEED_TEEN_ID)).toBe(1730));
    expect(storedDatabase().operations.filter((o) => o.id === "snd_ui_repeat1")).toHaveLength(1);
  });

  it("search shows 'No TeenPay user found.' for unknown users and for yourself", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" />, buildSeedDatabase());
    const search = await screen.findByRole("searchbox", { name: /who are you sending to/i });
    await user.type(search, "zzzz");
    expect(await screen.findByText("No TeenPay user found.")).toBeInTheDocument();
    await user.clear(search);
    await user.type(search, "@aarav");
    expect(await screen.findByText("No TeenPay user found.")).toBeInTheDocument();
    // Only display-safe details on screen.
    await user.clear(search);
    await user.type(search, "meera");
    const list = await screen.findByRole("list", { name: "TeenPay users" });
    expect(list.textContent).not.toMatch(/usr_|wal_|fam_|Kapoor family/);
  });

  it("blocks more than the available balance with the engine's message (Spaces are protected)", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" />, buildSeedDatabase());
    await pickMeera(user, /who are you sending to/i);
    await user.type(await screen.findByLabelText("Amount"), "1900");
    expect(await screen.findAllByText("Not enough available money. You have ₹1,850 available.")).not.toHaveLength(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
  });

  it("a failure on confirm shows the error and no success", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" />, buildSeedDatabase());
    await pickMeera(user, /who are you sending to/i);
    await user.type(await screen.findByLabelText("Amount"), "1800");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Send ₹1,800" });
    // Meanwhile the money is spent elsewhere (another tab / stale screen).
    sandbox!.actions.sendMoney({ recipient: "@meera", amount: 1000, idempotencyKey: "snd_ui_elsewhere" });
    await user.click(await screen.findByRole("button", { name: "Send ₹1,800" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/^Not enough available money\./);
    expect(screen.queryByRole("heading", { name: "Money sent" })).not.toBeInTheDocument();
  });
});

describe("Request money flow", () => {
  it("creates a pending request with a note; no money moves", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="request" />, buildSeedDatabase());
    await pickMeera(user, /who are you asking/i);
    await user.type(await screen.findByLabelText("Amount"), "300");
    await user.type(screen.getByLabelText("Note (optional)"), "Movie tickets");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Request ₹300" })).toBeInTheDocument();
    expect(screen.getByText(/Nothing moves until @meera pays/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument();

    await waitFor(() => expect(storedDatabase().peerRequests).toHaveLength(1));
    expect(storedDatabase().peerRequests[0]).toMatchObject({ amount: 300, note: "Movie tickets", status: "pending" });
    expect(storedDatabase().ledger).toHaveLength(buildSeedDatabase().ledger.length);
  });
});

describe("Requests center", () => {
  it("Incoming: '₹300 requested by @aarav' → Pay → confirm → paid once, moved to History", async () => {
    const user = userEvent.setup();
    renderAs(SEED_PEER_ID, <RequestsCenter />, withRequest());
    const incoming = await screen.findByRole("region", { name: "Incoming" });
    expect(within(incoming).getByText("₹300 requested by @aarav")).toBeInTheDocument();
    expect(within(incoming).getByText("“Movie tickets”")).toBeInTheDocument();

    await user.click(within(incoming).getByRole("button", { name: "Pay ₹300" }));
    expect(within(incoming).getByText("Pay ₹300 to @aarav from your available balance?")).toBeInTheDocument();
    await user.click(within(incoming).getByRole("button", { name: "Confirm ₹300" }));

    expect(await screen.findByText(/^Paid ₹300 to @aarav · TRF-/)).toBeInTheDocument();
    const history = screen.getByRole("region", { name: "History" });
    expect(within(history).getByText("Accepted")).toBeInTheDocument();
    await waitFor(() => expect(storedDatabase().peerRequests[0]!.status).toBe("accepted"));
    expect(balanceOf(storedDatabase(), SEED_PEER_ID)).toBe(900);
    expect(balanceOf(storedDatabase(), SEED_TEEN_ID)).toBe(2150);
    expect(storedDatabase().operations.filter((o) => o.requestId)).toHaveLength(1);
  });

  it("Incoming: Decline → declined, no money", async () => {
    const user = userEvent.setup();
    renderAs(SEED_PEER_ID, <RequestsCenter />, withRequest());
    const incoming = await screen.findByRole("region", { name: "Incoming" });
    await user.click(within(incoming).getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Declined @aarav's ₹300 request. No money moved.")).toBeInTheDocument();
    await waitFor(() => expect(storedDatabase().peerRequests[0]!.status).toBe("declined"));
    expect(storedDatabase().ledger).toHaveLength(buildSeedDatabase().ledger.length);
  });

  it("Sent: '₹300 requested from @meera' → Cancel → cancelled; the requester has no Pay button", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <RequestsCenter />, withRequest());
    const sent = await screen.findByRole("region", { name: "Sent" });
    expect(within(sent).getByText("₹300 requested from @meera")).toBeInTheDocument();
    expect(within(sent).queryByRole("button", { name: /Pay/ })).not.toBeInTheDocument();
    await user.click(within(sent).getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText("Cancelled your ₹300 request. No money moved.")).toBeInTheDocument();
    await waitFor(() => expect(storedDatabase().peerRequests[0]!.status).toBe("cancelled"));
  });

  it("an expired request shows in History as Expired and can't be paid", async () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    renderAs(SEED_PEER_ID, <RequestsCenter />, withRequest(buildSeedDatabase(), eightDaysAgo));
    const history = await screen.findByRole("region", { name: "History" });
    expect(within(history).getByText("Expired")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Pay/ })).not.toBeInTheDocument();
    // Opening the center records the expiry (no money involved).
    await waitFor(() => expect(storedDatabase().peerRequests[0]!.status).toBe("expired"));
    expect(storedDatabase().ledger).toHaveLength(buildSeedDatabase().ledger.length);
  });

  it("empty states are calm and explain what goes where", async () => {
    renderAs(SEED_TEEN_ID, <RequestsCenter />, buildSeedDatabase());
    expect(await screen.findByText("No one has asked you for money")).toBeInTheDocument();
    expect(screen.getByText("No open requests")).toBeInTheDocument();
    expect(screen.getByText("Nothing settled yet")).toBeInTheDocument();
  });
});

describe("Activity, Home and Money", () => {
  it("Activity: 'Money sent' / 'Money received' rows and open requests listed apart from transactions", async () => {
    let db = ok(sendMoneyTransition(buildSeedDatabase(), {
      actorId: SEED_TEEN_ID, at: now(), recipient: "@meera", amount: 250, idempotencyKey: "snd_ui_activity",
    }));
    db = withRequest(db);
    const { unmount } = renderAs(SEED_TEEN_ID, <ActivityFeed />, db);
    const requests = await screen.findByRole("region", { name: "Money requests" });
    expect(within(requests).getByText("₹300 requested from @meera")).toBeInTheDocument();
    expect(screen.getAllByText("Money sent").length).toBeGreaterThan(0);
    expect(screen.getAllByText("To @meera").length).toBeGreaterThan(0);
    unmount();

    renderAs(SEED_PEER_ID, <ActivityFeed />);
    expect(await screen.findAllByText("Money received")).not.toHaveLength(0);
    expect(screen.getAllByText("From @aarav").length).toBeGreaterThan(0);
    expect(screen.getByText("₹300 requested by @aarav")).toBeInTheDocument();
  });

  it("Activity: a paid request reads 'Money request paid' for the requester; detail shows the party and request", async () => {
    const user = userEvent.setup();
    const db = ok(acceptMoneyRequestTransition(withRequest(), { actorId: SEED_PEER_ID, at: now(), requestId: requestIdFor("prq_ui_000001") }));
    renderAs(SEED_TEEN_ID, <ActivityFeed />, db);
    const row = (await screen.findAllByText("Money request paid"))[0]!;
    await user.click(row);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("@meera · Meera Kapoor")).toBeInTheDocument();
    expect(within(dialog).getByText(/You asked · Accepted · “Movie tickets”/)).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/usr_|wal_usr|fam_/);
  });

  it("Home: Send/Request quick actions and a pointer to incoming requests", async () => {
    const db = ok(createMoneyRequestTransition(buildSeedDatabase(), {
      actorId: SEED_PEER_ID, at: now(), payer: "@aarav", amount: 200, idempotencyKey: "prq_ui_home01",
    }));
    renderAs(SEED_TEEN_ID, <HomeContent />, db);
    const card = await screen.findByRole("region", { name: "Money requests" });
    expect(within(card).getByText("₹200 requested by @meera")).toBeInTheDocument();
    expect(within(card).getByRole("link")).toHaveAttribute("href", "/requests");
    const links = screen.getAllByRole("link");
    expect(links.find((l) => l.textContent === "Send")).toHaveAttribute("href", "/send");
    expect(links.find((l) => l.textContent === "Request")).toHaveAttribute("href", "/request");
  });

  it("Money: Send and Request sit between available money and Spaces", async () => {
    renderAs(SEED_TEEN_ID, <MoneyContent />, withRequest());
    const actions = await screen.findByRole("region", { name: "Send and request" });
    expect(within(actions).getByRole("link", { name: "Send" })).toHaveAttribute("href", "/send");
    expect(within(actions).getByRole("link", { name: "Request" })).toHaveAttribute("href", "/request");
    expect(within(actions).getByRole("link", { name: "Requests · 1 open" })).toHaveAttribute("href", "/requests");
    const spaces = screen.getByRole("region", { name: "Money Spaces" });
    expect(actions.compareDocumentPosition(spaces) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("stale screens can't act", () => {
  it("after sign-out, captured actions (send, pay, cancel) are refused and nothing changes", async () => {
    preloadDatabase(withRequest());
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_PEER_ID, role: "teen" }, Date.now());
    let auth: AuthContextValue | null = null;
    let live: SandboxContextValue | null = null;
    function CaptureBoth() {
      auth = useOptionalAuth();
      live = useOptionalSandbox();
      return null;
    }
    render(
      <AuthProvider service={service}>
        <SandboxProvider>
          <CaptureBoth />
        </SandboxProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(live).not.toBeNull());
    const stale = live!.actions;
    const before = JSON.stringify(storedDatabase());
    act(() => auth!.signOut("user"));
    await waitFor(() => expect(live).toBeNull());

    const send = stale.sendMoney({ recipient: "@aarav", amount: 50, idempotencyKey: "snd_stale_0001" });
    const pay = stale.acceptMoneyRequest(requestIdFor("prq_ui_000001"));
    const decline = stale.declineMoneyRequest(requestIdFor("prq_ui_000001"));
    for (const result of [send, pay, decline]) {
      expect(result).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    }
    const after = storedDatabase();
    expect(JSON.stringify([after.ledger, after.operations, after.peerRequests])).toBe(
      JSON.stringify([JSON.parse(before).ledger, JSON.parse(before).operations, JSON.parse(before).peerRequests]),
    );
  });
});
