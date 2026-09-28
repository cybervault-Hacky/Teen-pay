import { act, cleanup, configure, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService, SESSION_STORAGE_KEY } from "@/auth/sandbox-service";
import { primaryWalletId } from "@/domain";
import { walletBalance } from "@/sandbox/engine";
import { sendFriendRequestTransition } from "@/sandbox/friends";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { SANDBOX_KEY, linkedDatabase } from "./helpers/fixtures";
import { nav, navigate, resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

/**
 * Phase 13 acceptance journey — TeenPay ID — through the real
 * provider stack (AuthProvider → SandboxProvider → AppShell/AuthGate),
 * the real page modules and localStorage. jsdom + Testing Library: an
 * automated UI journey, not a real browser. Real clock.
 *
 * Identity first: Aarav's ID is copied and shared safely, @meera is
 * found through the canonical lookup, favourite + friendship follow,
 * money flows use the ID with guardian rules intact, the QR stays
 * identity-only, the ID is changed to @rohan without breaking a
 * single reference, freed IDs never inherit anything, parents are
 * gated, and Reset restores the seed identity.
 */
configure({ asyncUtilTimeout: 5000 });

const TEEN_WALLET = primaryWalletId(SEED_TEEN_ID);
const MEERA_WALLET = primaryWalletId(SEED_PEER_ID);

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);
const moneySnapshot = () =>
  JSON.stringify({ ledger: db().ledger.length, operations: db().operations.length, aarav: aarav(), meera: meera() });

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

async function pasteQr(user: ReturnType<typeof userEvent.setup>, text: string) {
  const input = await screen.findByLabelText("Use a sandbox QR");
  await user.clear(input);
  await user.type(input, text);
  await user.click(screen.getByRole("button", { name: "Look up" }));
}

describe("Phase 13 journey — TeenPay ID", () => {
  afterEach(() => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
  });

  it("42 steps: identity card, copy/share, lookup, friend, money with rules, QR, change-ID, gates, reset", async () => {
    const user = userEvent.setup();
    // Clipboard + share spies must exist before first render (the
    // identity card detects Web Share support on mount).
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });

    // 1. Clean sandbox, linked family with a ₹50 approval threshold.
    window.localStorage.clear();
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(linkedDatabase({ threshold: 50 })));
    let view = await signedIn(SEED_TEEN_ID, "teen", "/profile");
    expect(aarav()).toBe(1850);
    expect(meera()).toBe(1200);

    // 2. Profile shows the identity card.
    const identitySection = await screen.findByRole("region", { name: "TeenPay ID" });
    expect(within(identitySection).getByText("@aarav")).toBeInTheDocument();
    expect(within(identitySection).getByText("Your unique identity on TeenPay")).toBeInTheDocument();

    // 3. Copy carries only the handle.
    await user.click(within(identitySection).getByRole("button", { name: "Copy ID" }));
    expect(await within(identitySection).findByRole("status")).toHaveTextContent("Copied @aarav.");
    expect(writeText).toHaveBeenCalledWith("@aarav");

    // 4. Share carries only the identity.
    await user.click(within(identitySection).getByRole("button", { name: "Share ID" }));
    expect(share).toHaveBeenCalledTimes(1);
    const shared = share.mock.calls[0]![0] as { text: string };
    expect(shared.text).toContain("@aarav");
    expect(JSON.stringify(shared)).not.toMatch(/usr_|wal_|₹|balance/i);

    // 5. The canonical identity page.
    await go("/id");
    expect(await screen.findByRole("heading", { level: 1, name: "TeenPay ID" })).toBeInTheDocument();

    // 6. Search @meera → the shared identity surface.
    await user.type(screen.getByRole("textbox", { name: "Find someone" }), "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await settle();
    expect(nav.url).toBe("/id/meera");

    // 7–8. Safe profile only — no internal ids, no money.
    expect(await screen.findByRole("heading", { level: 1, name: "Meera Kapoor" })).toBeInTheDocument();
    expect(screen.getByText("@meera")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/usr_meera|wal_usr|₹|balance/i);

    // 9. Favourite her.
    await user.click(screen.getByRole("button", { name: "Add favourite" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added @meera to your favourites.");

    // 10. Send a friend request — and a repeat adds nothing.
    await user.click(screen.getByRole("button", { name: "Add friend" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Friend request sent to @meera.");
    const dupe = sendFriendRequestTransition(db(), {
      actorId: SEED_TEEN_ID,
      at: new Date().toISOString(),
      teenPayId: "@meera",
      requestId: "frd_journey_dup",
    });
    expect(dupe.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(dupe.db.friendships).toEqual(db().friendships);
    expect(dupe.db.notifications).toEqual(db().notifications);
    view.unmount();
    cleanup();

    // 11–12. Meera accepts.
    view = await signedIn(SEED_PEER_ID, "teen", "/friends");
    const incoming = await screen.findByRole("list", { name: "Incoming requests" });
    expect(within(incoming).getByText("@aarav")).toBeInTheDocument();
    await user.click(within(incoming).getByRole("button", { name: "Accept @aarav" }));
    expect(await screen.findByText("You and @aarav are now friends.")).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 13. Back to Aarav: the identity surface knows the friendship.
    view = await signedIn(SEED_TEEN_ID, "teen", "/id/meera");
    expect(await screen.findByText("Friend")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send Money" })).toHaveAttribute("href", "/send?to=meera&via=friend");
    expect(screen.getByRole("link", { name: "Request Money" })).toHaveAttribute(
      "href",
      "/request?to=meera&via=friend",
    );

    // 14. Send ₹40 through the friend flow: existing engine, real move.
    await go("/send?to=meera&via=friend");
    expect(await screen.findByRole("heading", { name: "Send to @meera" })).toBeInTheDocument();
    expect(screen.getByText(/from your Friend Circle/)).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "40");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Send ₹40" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send ₹40" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    expect(aarav()).toBe(1810);
    expect(meera()).toBe(1240);

    // 15. Guardian rules still bind: ₹100 is above the ₹50 threshold.
    // (Bounce through the friend page so the flow remounts cleanly.)
    await go("/friends/meera");
    await go("/send?to=meera&via=friend");
    await user.type(await screen.findByLabelText("Amount"), "100");
    expect(await screen.findByText(/This needs parent approval/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Send ₹100" })).toBeInTheDocument();
    expect(screen.getByText("Approval required")).toBeInTheDocument();
    const beforeApproval = moneySnapshot();
    await user.click(screen.getByRole("button", { name: /to approve/ }));
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(moneySnapshot()).toBe(beforeApproval);

    // 16. Request ₹60 from @meera through the friend flow.
    await go("/request?to=meera&via=friend");
    expect(await screen.findByRole("heading", { name: "Request from @meera" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "60");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument();
    expect(db().peerRequests).toMatchObject([{ amount: 60, status: "pending" }]);
    view.unmount();
    cleanup();

    // 17. Meera pays it: the lifecycle is untouched by identity.
    view = await signedIn(SEED_PEER_ID, "teen", "/requests");
    const requestIncoming = await screen.findByRole("region", { name: "Incoming" });
    expect(within(requestIncoming).getByText("₹60 requested by @aarav")).toBeInTheDocument();
    await user.click(within(requestIncoming).getByRole("button", { name: "Pay ₹60" }));
    await user.click(within(requestIncoming).getByRole("button", { name: "Confirm ₹60" }));
    expect(await screen.findByText(/^Paid ₹60 to @aarav · TRF-/)).toBeInTheDocument();
    expect(aarav()).toBe(1870);
    expect(meera()).toBe(1180);
    view.unmount();
    cleanup();

    // 18. QR stays identity-only: Aarav's code carries @aarav and nothing else.
    view = await signedIn(SEED_TEEN_ID, "teen", "/qr");
    const qr = await screen.findByRole("img", { name: /TeenPay QR code for @aarav/ });
    expect(qr).toHaveAttribute("data-qr-payload", "teenpay://user/@aarav?v=1");

    // 19–20. Scanning Meera's code resolves her identity — no automatic payment.
    await go("/qr/scan");
    const beforeScan = moneySnapshot();
    await pasteQr(user, "teenpay://user/@meera?v=1");
    expect(await screen.findByText("Meera Kapoor")).toBeInTheDocument();
    expect(screen.getAllByText("@meera").length).toBeGreaterThan(0);
    expect(screen.getByText(/nothing has moved/i)).toBeInTheDocument();
    expect(moneySnapshot()).toBe(beforeScan);

    // 21. Change the TeenPay ID: @aarav → @rohan.
    await go("/profile");
    await user.click(
      within(await screen.findByRole("region", { name: "TeenPay ID" })).getByRole("button", {
        name: "Change TeenPay ID",
      }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("New TeenPay ID"), "rohan");
    expect(within(dialog).getByRole("status")).toHaveTextContent("@rohan is available.");
    await user.click(within(dialog).getByRole("button", { name: "Save new ID" }));
    expect(await screen.findByText("@rohan")).toBeInTheDocument();

    // 22–23. The friendship and the QR follow the alias, keyed by account.
    await go("/id/meera");
    expect(await screen.findByText("Friend")).toBeInTheDocument();
    await go("/qr");
    expect(
      await screen.findByRole("img", { name: /TeenPay QR code for @rohan/ }),
    ).toHaveAttribute("data-qr-payload", "teenpay://user/@rohan?v=1");
    view.unmount();
    cleanup();

    // 24–25. Meera pays the NEW ID; money reaches the SAME account.
    view = await signedIn(SEED_PEER_ID, "teen", "/send?to=rohan");
    expect(await screen.findByRole("heading", { name: "Send to @rohan" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "30");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Send ₹30" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    expect(aarav()).toBe(1900);
    expect(meera()).toBe(1150);

    // 26. The OLD ID resolves to nobody — no silent inheritance.
    await go("/id");
    await user.type(screen.getByRole("textbox", { name: "Find someone" }), "@aarav");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(
      await within(screen.getByRole("region", { name: "Find someone" })).findByRole("status"),
    ).toHaveTextContent("No TeenPay user found.");

    // 27–28. Malformed and reserved inputs stay safe.
    const findBox = screen.getByRole("textbox", { name: "Find someone" });
    await user.clear(findBox);
    await user.type(findBox, "usr_rohan");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(
      await within(screen.getByRole("region", { name: "Find someone" })).findByRole("status"),
    ).toHaveTextContent("Enter a TeenPay ID like @meera.");
    await user.clear(findBox);
    await user.type(findBox, "admin");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(
      await within(screen.getByRole("region", { name: "Find someone" })).findByRole("status"),
    ).toHaveTextContent("No TeenPay user found.");
    expect(nav.url).toBe("/id");
    view.unmount();
    cleanup();

    // 29. A new teen can claim the freed @aarav — as a different person.
    view = await signedIn(SEED_PEER_ID, "teen", "/id");
    await user.type(await screen.findByRole("textbox", { name: "Find someone" }), "@rohan");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await settle();
    expect(nav.url).toBe("/id/rohan");
    expect(await screen.findByRole("heading", { level: 1, name: "Aarav Sharma" })).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 30–31. Parents are gated out of identity features entirely.
    view = await signedIn(SEED_PARENT_ID, "parent", "/id");
    expect(await screen.findByText(/This is Aarav's space/)).toBeInTheDocument();
    await go("/profile");
    expect(screen.queryByRole("button", { name: "Change TeenPay ID" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy ID" })).not.toBeInTheDocument();
    view.unmount();
    cleanup();

    // 32–34. Identity isolation: Meera never sees Aarav's money anywhere
    // on the identity surfaces.
    view = await signedIn(SEED_PEER_ID, "teen", "/id/rohan");
    expect(await screen.findByRole("heading", { level: 1, name: "Aarav Sharma" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/₹\s?1|balance|usr_aarav|wal_usr/i);
    view.unmount();
    cleanup();

    // 35. Signed-out protection on the identity routes.
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    resetRouter("/id");
    view = render(<TestApp />);
    await settle();
    expect(nav.url).toBe("/sign-in?next=%2Fid");
    view.unmount();
    cleanup();

    // 36. Reset the sandbox from Profile.
    view = await signedIn(SEED_TEEN_ID, "teen", "/profile");
    await user.click(await screen.findByRole("button", { name: /^Reset$/ }));
    const confirm = await screen.findByRole("dialog");
    await user.click(within(confirm).getByRole("button", { name: /^Reset$/ }));
    await settle();
    view.unmount();
    cleanup();

    // 37–42. Seed identity restored: @aarav is back, the circle is empty,
    // favourites and money are reset — identity is deterministic.
    view = await signedIn(SEED_TEEN_ID, "teen", "/profile");
    const restored = await screen.findByRole("region", { name: "TeenPay ID" });
    expect(within(restored).getByText("@aarav")).toBeInTheDocument();
    await go("/id");
    await user.type(await screen.findByRole("textbox", { name: "Find someone" }), "@rohan");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(
      await within(screen.getByRole("region", { name: "Find someone" })).findByRole("status"),
    ).toHaveTextContent("No TeenPay user found.");
    await go("/friends");
    expect(await screen.findByText("Your trusted circle is empty")).toBeInTheDocument();
    await go("/contacts");
    expect(await screen.findByRole("heading", { name: "No favourites yet" })).toBeInTheDocument();
    expect(aarav()).toBe(1850);
    expect(meera()).toBe(1200);
    view.unmount();
    cleanup();
  }, 40000);
});
