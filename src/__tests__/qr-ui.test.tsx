import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { primaryWalletId } from "@/domain";
import { FavouritesClient } from "@/components/contacts/favourites-client";
import { HomeContent } from "@/components/home/home-content";
import { MoneyContent } from "@/components/money/money-content";
import { PeerFlow } from "@/components/peer/peer-flow";
import { ProfileContent } from "@/components/profile/profile-content";
import { MyQr } from "@/components/qr/my-qr";
import { ScanClient } from "@/components/qr/scan-client";
import { addContactTransition } from "@/sandbox/contacts";
import { spaceBalance } from "@/sandbox/engine";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_PEER_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { SandboxProvider, useSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { SandboxDatabase } from "@/sandbox/types";
import { AT, balanceOf, linkedDatabase, preloadDatabase, storedDatabase } from "./helpers/fixtures";
import { nav, resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return { usePathname: router.usePathname, useRouter: router.useRouter, useSearchParams: router.useSearchParams };
});

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

const MEERA_WALLET = primaryWalletId(SEED_PEER_ID);
const TEEN_WALLET = primaryWalletId(SEED_TEEN_ID);

let sandbox: SandboxContextValue | null = null;
beforeEach(() => {
  sandbox = null;
  localStorage.clear();
  resetRouter("/");
});

function Capture() {
  sandbox = useSandbox();
  return null;
}

function renderAs(viewerId: string, ui: React.ReactNode, db: SandboxDatabase = buildSeedDatabase()) {
  preloadDatabase(db);
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

const transfers = () => storedDatabase().operations.filter((op) => op.type === "transfer");

function withMeeraSaved(base = buildSeedDatabase()): SandboxDatabase {
  return ok(addContactTransition(base, { actorId: SEED_TEEN_ID, at: AT, teenPayId: "@meera", contactId: "ctc_ui_000001" }));
}

function withAccountStatus(db: SandboxDatabase, id: string, status: "active" | "closed"): SandboxDatabase {
  return { ...db, accounts: db.accounts.map((a) => (a.id === id ? { ...a, status } : a)) };
}

function withWalletStatus(db: SandboxDatabase, walletId: string, status: "active" | "frozen" | "closed"): SandboxDatabase {
  return { ...db, wallets: db.wallets.map((w) => (w.id === walletId ? { ...w, status } : w)) };
}

/** Aarav moves `amount` more into Save (through the real Space transition). */
function withSaved(db: SandboxDatabase, amount: number): SandboxDatabase {
  const scope = scopeFor(db, SEED_TEEN_ID)!;
  const out = moveSpaceMoneyTransition(scope.state, {
    actorId: SEED_TEEN_ID, at: AT, spaceId: SEED_SAVE_SPACE_ID, amount, direction: "add", operationId: "spc_ui_move_1",
  });
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return mergeScope(db, scope.info, scope.state, out.state);
}

async function pasteQr(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByLabelText("Use a sandbox QR");
  await user.clear(input);
  await user.type(input, text);
  await user.click(screen.getByRole("button", { name: "Look up" }));
}

describe("My TeenPay QR", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a real QR of the public identity only — name and @ID, no ids or balance", async () => {
    renderAs(SEED_TEEN_ID, <MyQr />);
    const qr = await screen.findByRole("img", { name: /TeenPay QR code for @aarav/ });
    expect(qr).toHaveAttribute("data-qr-payload", "teenpay://user/@aarav?v=1");
    expect(qr.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(100);
    expect(screen.getByText("Scan to pay me")).toBeInTheDocument();
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("@aarav")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/usr_|wal_|fam_|₹|Sharma family/);
  });

  it("copies the TeenPay ID and announces it", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    renderAs(SEED_TEEN_ID, <MyQr />);
    await user.click(await screen.findByRole("button", { name: "Copy TeenPay ID" }));
    expect(writeText).toHaveBeenCalledWith("@aarav");
    expect(await screen.findByRole("status")).toHaveTextContent("Copied @aarav.");
  });

  it("without a clipboard, says so and shows the ID instead", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    renderAs(SEED_TEEN_ID, <MyQr />);
    await user.click(await screen.findByRole("button", { name: "Copy TeenPay ID" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Copying isn't available here. Your TeenPay ID is @aarav.");
  });

  it("no Web Share → no fake Share button, an honest fallback", async () => {
    renderAs(SEED_TEEN_ID, <MyQr />);
    expect(await screen.findByText(/Sharing isn't available in this browser/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
  });

  it("with Web Share, shares the TeenPay ID (nothing private)", async () => {
    const user = userEvent.setup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    try {
      renderAs(SEED_TEEN_ID, <MyQr />);
      await user.click(await screen.findByRole("button", { name: "Share" }));
      expect(share).toHaveBeenCalledTimes(1);
      const shared = share.mock.calls[0]![0] as { text: string };
      expect(shared.text).toContain("@aarav");
      expect(JSON.stringify(shared)).not.toMatch(/usr_|wal_|₹/);
      expect(await screen.findByRole("status")).toHaveTextContent("Shared.");
    } finally {
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    }
  });

  it("a parent has no TeenPay QR", async () => {
    renderAs(SEED_PARENT_ID, <MyQr />);
    expect(await screen.findByText("No TeenPay QR for this account")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});

describe("Scan to pay — sandbox paste (no camera in this environment)", () => {
  it("says honestly that there's no camera, and offers the labelled sandbox option", async () => {
    renderAs(SEED_TEEN_ID, <ScanClient />);
    expect(await screen.findByText("This browser can't use a camera here.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start camera" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Use a sandbox QR")).toHaveAccessibleDescription(/For testing in this sandbox/);
  });

  it("rejects malformed, tampered, own and unknown codes — nothing resolves", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <ScanClient />);
    const cases: [string, string][] = [
      ["hello world", "This isn't a TeenPay QR code."],
      [`teenpay://user/@${MEERA_WALLET}?v=1`, "This isn't a TeenPay QR code."],
      ["teenpay://user/@meera?v=1&amount=500", "This isn't a TeenPay QR code."],
      ["teenpay://user/@meera?v=9", "This QR code is from a newer version of TeenPay."],
      ["teenpay://user/@aarav?v=1", "This is your own TeenPay QR. You can't pay or request from yourself."],
      ["teenpay://user/@nobody?v=1", "No TeenPay user found."],
    ];
    for (const [text, message] of cases) {
      await pasteQr(user, text);
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(screen.queryByRole("heading", { name: "Pay or request" })).not.toBeInTheDocument();
    }
  });

  it("a valid code shows the safe profile; nothing moves; then Pay / Request open the existing flows", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <ScanClient />);
    await pasteQr(user, "teenpay://user/@meera?v=1");
    const heading = await screen.findByRole("heading", { name: "Pay or request" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText("Meera Kapoor")).toBeInTheDocument();
    expect(screen.getByText("@meera")).toBeInTheDocument();
    expect(screen.getByText(/From a pasted sandbox QR · nothing has moved/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/usr_|wal_|fam_|Kapoor family/);
    expect(storedDatabase().operations).toEqual(buildSeedDatabase().operations);

    await user.click(screen.getByRole("button", { name: "Request" }));
    expect(nav.url).toBe("/request?to=meera&via=qr");
    await user.click(screen.getByRole("button", { name: "Pay" }));
    expect(nav.url).toBe("/send?to=meera&via=qr");
    expect(transfers()).toHaveLength(0);
  });

  it("add the scanned person to favourites (once)", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <ScanClient />);
    await pasteQr(user, "teenpay://user/@meera?v=1");
    await user.click(await screen.findByRole("button", { name: "Add to favourites" }));
    expect(await screen.findByText("@meera added to favourites.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "In favourites" })).toBeDisabled();
    expect(storedDatabase().contacts).toMatchObject([{ ownerAccountId: SEED_TEEN_ID, teenPayId: "meera" }]);
  });
});

describe("Scan to pay — the camera boundary (browser APIs mocked)", () => {
  let stopTrack: ReturnType<typeof vi.fn>;
  let getUserMedia: ReturnType<typeof vi.fn>;
  let detections: string[][];

  beforeEach(() => {
    stopTrack = vi.fn();
    detections = [[], ["teenpay://user/@meera?v=1"]];
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] });
    Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
    class FakeDetector {
      async detect() {
        return (detections.shift() ?? []).map((rawValue) => ({ rawValue }));
      }
    }
    vi.stubGlobal("BarcodeDetector", FakeDetector);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
  });

  it("asks for the camera only on 'Start camera' (video only), reads a code, then stops the camera", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <ScanClient />);
    const start = await screen.findByRole("button", { name: "Start camera" });
    expect(getUserMedia).not.toHaveBeenCalled();
    await user.click(start);
    expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: { ideal: "environment" } }, audio: false });
    expect(await screen.findByRole("heading", { name: "Pay or request" })).toBeInTheDocument();
    expect(screen.getByText(/Scanned with your camera · nothing has moved/)).toBeInTheDocument();
    expect(stopTrack).toHaveBeenCalled();
    expect(transfers()).toHaveLength(0);
  });

  it("a scanned code is still validated: a tampered one is refused", async () => {
    detections = [[`teenpay://user/@meera?v=1&wallet=${MEERA_WALLET}`]];
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <ScanClient />);
    await user.click(await screen.findByRole("button", { name: "Start camera" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This isn't a TeenPay QR code.");
    expect(stopTrack).toHaveBeenCalled();
  });

  it("stops the camera when you stop it, and when you leave", async () => {
    detections = [];
    const user = userEvent.setup();
    const view = renderAs(SEED_TEEN_ID, <ScanClient />);
    await user.click(await screen.findByRole("button", { name: "Start camera" }));
    await user.click(await screen.findByRole("button", { name: "Stop camera" }));
    expect(stopTrack).toHaveBeenCalledTimes(1);
    await user.click(await screen.findByRole("button", { name: "Start camera" }));
    await screen.findByRole("button", { name: "Stop camera" });
    view.unmount();
    expect(stopTrack).toHaveBeenCalledTimes(2);
  });

  it("hiding the tab stops the camera", async () => {
    detections = [];
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <ScanClient />);
    await user.click(await screen.findByRole("button", { name: "Start camera" }));
    await screen.findByRole("button", { name: "Stop camera" });
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(stopTrack).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
    expect(await screen.findByRole("button", { name: "Start camera" })).toBeInTheDocument();
  });

  it("leaving while the permission prompt is open still releases the camera", async () => {
    let grant: (stream: unknown) => void = () => {};
    getUserMedia.mockImplementation(() => new Promise((resolve) => (grant = resolve)));
    const user = userEvent.setup();
    const view = renderAs(SEED_TEEN_ID, <ScanClient />);
    await user.click(await screen.findByRole("button", { name: "Start camera" }));
    view.unmount();
    await act(async () => grant({ getTracks: () => [{ stop: stopTrack }] }));
    await waitFor(() => expect(stopTrack).toHaveBeenCalled());
  });

  it("a refused permission is explained", async () => {
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <ScanClient />);
    await user.click(await screen.findByRole("button", { name: "Start camera" }));
    expect(await screen.findByText(/Camera permission was not given/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try camera again" })).toBeInTheDocument();
  });
});

describe("Favourites page", () => {
  it("search → safe profile → Add; then one-tap Pay / Request links into the existing flows", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <FavouritesClient />);
    expect(await screen.findByText("No favourites yet")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a favourite" }));
    await user.type(await screen.findByRole("searchbox", { name: "Who do you want to add?" }), "mee");
    const results = await screen.findByRole("list", { name: "TeenPay users" });
    await user.click(within(results).getByRole("button", { name: /Meera Kapoor/ }));
    await user.click(await screen.findByRole("button", { name: "Add to favourites" }));
    expect(await screen.findByText("@meera added to favourites.")).toBeInTheDocument();

    const list = screen.getByRole("list", { name: "Favourites" });
    expect(within(list).getByText("Meera Kapoor")).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "Pay @meera" })).toHaveAttribute("href", "/send?to=meera&via=favourite");
    expect(within(list).getByRole("link", { name: "Request from @meera" })).toHaveAttribute("href", "/request?to=meera&via=favourite");
    expect(list.textContent).not.toMatch(/usr_|wal_|fam_|₹/);
    expect(storedDatabase().contacts).toHaveLength(1);
  });

  it("someone already saved can't be added twice", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <FavouritesClient />, withMeeraSaved());
    await user.click(await screen.findByRole("button", { name: "Add a favourite" }));
    await user.type(await screen.findByRole("searchbox", { name: "Who do you want to add?" }), "meera");
    await user.click(within(await screen.findByRole("list", { name: "TeenPay users" })).getByRole("button", { name: /Meera Kapoor/ }));
    expect(await screen.findByRole("button", { name: "In favourites" })).toBeDisabled();
    expect(storedDatabase().contacts).toHaveLength(1);
  });

  it("remove changes only the list — history and balances stay", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <FavouritesClient />, withMeeraSaved());
    const before = storedDatabase();
    await user.click(await screen.findByRole("button", { name: "Remove @meera from favourites" }));
    expect(await screen.findByText(/@meera removed from favourites. Past payments and requests aren't affected./)).toBeInTheDocument();
    expect(await screen.findByText("No favourites yet")).toBeInTheDocument();
    const after = storedDatabase();
    expect(after.contacts).toEqual([]);
    expect(after.ledger).toEqual(before.ledger);
    expect(after.operations).toEqual(before.operations);
  });

  it("a favourite who became unavailable says so in words (no name, no reason)", async () => {
    renderAs(SEED_TEEN_ID, <FavouritesClient />, withAccountStatus(withMeeraSaved(), SEED_PEER_ID, "closed"));
    const list = await screen.findByRole("list", { name: "Favourites" });
    expect(within(list).getByText("Not available right now")).toBeInTheDocument();
    expect(list.textContent).not.toMatch(/Meera Kapoor/);
  });
});

describe("Quick pay / quick request — preselected, still amount → review → confirm", () => {
  it("favourite → Pay: preselected, reviewed, and a double confirm sends once", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" initialRecipient="meera" origin="favourite" />, withMeeraSaved());
    expect(await screen.findByRole("heading", { name: "Send to @meera" })).toBeInTheDocument();
    expect(screen.getByText("Meera Kapoor · from your favourites")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "250");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Send ₹250" })).toBeInTheDocument();
    expect(screen.getByText("From your available balance")).toBeInTheDocument();
    expect(transfers()).toHaveLength(0);
    const confirm = screen.getByRole("button", { name: "Send ₹250" });
    await user.dblClick(confirm);
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    await waitFor(() => expect(transfers()).toHaveLength(1));
    expect(balanceOf(storedDatabase(), SEED_TEEN_ID)).toBe(1600);
    expect(balanceOf(storedDatabase(), SEED_PEER_ID)).toBe(1450);
    // Same notifications as any send — no QR/favourite-specific ones.
    const titles = storedDatabase().notifications.map((n) => n.title);
    expect(titles.filter((t) => t === "₹250 sent to @meera.")).toHaveLength(1);
    expect(titles.filter((t) => t === "You received ₹250.")).toHaveLength(1);
    expect(titles.some((t) => /QR|favourite/i.test(t))).toBe(false);
  });

  it("QR → Request: preselected, note, review, one pending request, no money", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="request" initialRecipient="meera" origin="qr" />);
    expect(await screen.findByRole("heading", { name: "Request from @meera" })).toBeInTheDocument();
    expect(screen.getByText("Meera Kapoor · from a TeenPay QR")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "200");
    await user.type(screen.getByLabelText("Note (optional)"), "Snacks");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument();
    expect(storedDatabase().peerRequests).toMatchObject([{ amount: 200, note: "Snacks", status: "pending", payerHandle: "@meera" }]);
    expect(JSON.stringify(storedDatabase().peerRequests)).not.toMatch(/teenpay:\/\/|qr/i);
    expect(balanceOf(storedDatabase(), SEED_TEEN_ID)).toBe(1850);
    expect(transfers()).toHaveLength(0);
  });

  it("a stale favourite (account closed) can't be paid: the flow says so and falls back to search", async () => {
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" initialRecipient="meera" origin="favourite" />, withAccountStatus(withMeeraSaved(), SEED_PEER_ID, "closed"));
    expect(await screen.findByRole("alert")).toHaveTextContent("No TeenPay user found. Nothing was sent");
    expect(screen.getByRole("searchbox", { name: /who are you sending to/i })).toBeInTheDocument();
    expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
    expect(transfers()).toHaveLength(0);
  });

  it("an injected id or your own ID in the link preselects nobody", async () => {
    for (const injected of [SEED_PEER_ID, MEERA_WALLET, "aarav", "sandbox:usr_meera"]) {
      const view = renderAs(SEED_TEEN_ID, <PeerFlow mode="send" initialRecipient={injected} origin="qr" />);
      expect(await screen.findByRole("alert")).toHaveTextContent("No TeenPay user found.");
      expect(screen.queryByLabelText("Amount")).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("'Change' drops the preselection and goes back to search", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" initialRecipient="meera" origin="qr" />);
    await user.click(await screen.findByRole("button", { name: "Change" }));
    expect(await screen.findByRole("searchbox", { name: /who are you sending to/i })).toBeInTheDocument();
  });

  it("QR pay can't touch Money Spaces: ₹900 with ₹850 available is refused", async () => {
    const user = userEvent.setup();
    const db = withSaved(buildSeedDatabase(), 1000); // total ₹4,150 · Spaces ₹3,300 (Save ₹1,800 + Bike ₹1,500) · available ₹850
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" initialRecipient="meera" origin="qr" />, db);
    await user.type(await screen.findByLabelText("Amount"), "900");
    expect((await screen.findAllByText("Not enough available money. You have ₹850 available.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    // The engine refuses it too, and Save is untouched.
    const direct = sandbox!.actions.sendMoney({ recipient: "@meera", amount: 900, idempotencyKey: "snd_ui_space_1" });
    expect(direct).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(spaceBalance(storedDatabase().ledger, SEED_SAVE_SPACE_ID)).toBe(1800);
    expect(transfers()).toHaveLength(0);
  });

  it("QR pay over the guardian's threshold asks for approval — nothing moves", async () => {
    const user = userEvent.setup();
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" initialRecipient="meera" origin="qr" />, linkedDatabase({ threshold: 500 }));
    await user.type(await screen.findByLabelText("Amount"), "600");
    expect(await screen.findByText(/This needs parent approval/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Ask Priya to approve" }));
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(transfers()).toHaveLength(0);
    expect(balanceOf(storedDatabase(), SEED_TEEN_ID)).toBe(1850);
    const approvals = scopeFor(storedDatabase(), SEED_PARENT_ID)!.state.approvals.filter((a) => a.kind === "transfer");
    expect(approvals).toMatchObject([{ amount: 600, status: "pending", recipientName: "@meera" }]);
  });

  it("a frozen sender can't pay a favourite", async () => {
    renderAs(SEED_TEEN_ID, <PeerFlow mode="send" initialRecipient="meera" origin="favourite" />, withWalletStatus(withMeeraSaved(), TEEN_WALLET, "frozen"));
    await screen.findByRole("heading", { name: "Send to @meera" });
    const result = sandbox!.actions.sendMoney({ recipient: "@meera", amount: 100, idempotencyKey: "snd_ui_frozen_1" });
    expect(result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    expect(transfers()).toHaveLength(0);
  });
});

describe("Money and Home entry points", () => {
  it("Money: Scan & Pay and My QR next to Send/Request; Favourites before Spaces", async () => {
    renderAs(SEED_TEEN_ID, <MoneyContent />);
    const actions = await screen.findByRole("region", { name: "Send and request" });
    expect(within(actions).getByRole("link", { name: "Scan & Pay" })).toHaveAttribute("href", "/qr/scan");
    expect(within(actions).getByRole("link", { name: "My QR" })).toHaveAttribute("href", "/qr");
    const favourites = screen.getByRole("region", { name: "Favourites" });
    expect(within(favourites).getByRole("link", { name: "Add" })).toHaveAttribute("href", "/contacts");
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions.indexOf("Favourites")).toBeLessThan(regions.indexOf("Money Spaces"));
    expect(regions.indexOf("Send and request")).toBeLessThan(regions.indexOf("Favourites"));
  });

  it("Money: saved favourites get one-tap Pay", async () => {
    renderAs(SEED_TEEN_ID, <MoneyContent />, withMeeraSaved());
    const favourites = await screen.findByRole("region", { name: "Favourites" });
    expect(within(favourites).getByRole("link", { name: "Pay @meera" })).toHaveAttribute("href", "/send?to=meera&via=favourite");
    expect(within(favourites).getByRole("link", { name: "Manage" })).toHaveAttribute("href", "/contacts");
  });

  it("Profile: a TeenPay ID section links to My QR and Favourites (teens only)", async () => {
    const view = renderAs(SEED_TEEN_ID, <ProfileContent />, withMeeraSaved());
    const section = await screen.findByRole("region", { name: "TeenPay ID" });
    expect(within(section).getByRole("link", { name: /My TeenPay QR/ })).toHaveAttribute("href", "/qr");
    expect(within(section).getByRole("link", { name: /Favourites.*1 saved/ })).toHaveAttribute("href", "/contacts");
    expect(section.textContent).not.toMatch(/usr_|wal_/);
    view.unmount();
    renderAs(SEED_PARENT_ID, <ProfileContent />);
    await screen.findAllByRole("region");
    expect(screen.queryByRole("region", { name: "TeenPay ID" })).not.toBeInTheDocument();
  });

  it("Home: a compact Scan & Pay entry; Send and Request stay", async () => {
    renderAs(SEED_TEEN_ID, <HomeContent />);
    expect(await screen.findByRole("link", { name: "Scan & Pay" })).toHaveAttribute("href", "/qr/scan");
    const links = screen.getAllByRole("link");
    expect(links.find((l) => l.textContent === "Send")).toHaveAttribute("href", "/send");
    expect(links.find((l) => l.textContent === "Request")).toHaveAttribute("href", "/request");
  });
});
