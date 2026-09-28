import { act, cleanup, configure, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { primaryWalletId } from "@/domain";
import { sendFriendRequestTransition } from "@/sandbox/friends";
import { walletBalance } from "@/sandbox/engine";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { SANDBOX_KEY } from "./helpers/fixtures";
import { navigate, resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

/**
 * Phase 12 acceptance journey — Friend Circles — through the real
 * provider stack (AuthProvider → SandboxProvider → AppShell/AuthGate),
 * the real page modules and localStorage. jsdom + Testing Library: an
 * automated UI journey, not a real browser. Real clock.
 *
 * Aarav finds Meera by TeenPay ID, sends a request, she accepts; the
 * friendship opens the existing Send / Request flows without moving
 * money; removal, decline and cancel follow; a parent is gated out;
 * reset restores the initial state. Friendship never touches money.
 */
configure({ asyncUtilTimeout: 5000 });

const TEEN_WALLET = primaryWalletId(SEED_TEEN_ID);
const MEERA_WALLET = primaryWalletId(SEED_PEER_ID);

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);
const moneySnapshot = () =>
  JSON.stringify({
    ledger: db().ledger.length,
    operations: db().operations.length,
    peerRequests: db().peerRequests.length,
    spaces: db().spaces.length,
    schedules: db().pocketMoneySchedules.length,
    aarav: aarav(),
    meera: meera(),
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

describe("Phase 12 journey — Friend Circles", () => {
  it("34 steps: discover, request, accept, pay flows, remove, decline, cancel, parent gate, reset", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();

    // 1. Aarav signs in; the seed balances.
    let view = await signedIn(SEED_TEEN_ID, "teen", "/");
    expect(aarav()).toBe(1850);
    expect(meera()).toBe(1200);
    const moneyBefore = moneySnapshot();

    // 2. Open the Friend Circle.
    await go("/friends");
    expect(await screen.findByRole("heading", { level: 1, name: "Friend Circle" })).toBeInTheDocument();

    // 3. Everything starts empty, calmly.
    expect(screen.getByText("Your trusted circle is empty")).toBeInTheDocument();
    expect(screen.getByText("No new friend requests")).toBeInTheDocument();
    expect(screen.getByText("No pending requests")).toBeInTheDocument();

    // 4. Discover Meera through her TeenPay ID only.
    await user.type(await screen.findByLabelText("TeenPay ID"), "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    // 5–6. A safe preview: name + handle + relationship, no private data.
    const preview = await screen.findByText("Meera Kapoor");
    expect(screen.getAllByText("@meera").length).toBeGreaterThan(0);
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    const section = preview.closest("section")!;
    expect(section.textContent).not.toMatch(/usr_meera|wal_|fam_|₹|balance/i);

    // 7. Send the friend request.
    await user.click(screen.getByRole("button", { name: "Add Friend" }));
    expect(await screen.findByText("Friend request sent to @meera.")).toBeInTheDocument();

    // 8. The preview shows the pending state.
    expect((await screen.findAllByText("Request pending")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();

    // 9. A repeated submit (double click / race) creates no duplicate.
    const dupe = sendFriendRequestTransition(db(), {
      actorId: SEED_TEEN_ID,
      at: new Date().toISOString(),
      teenPayId: "@meera",
      requestId: "frd_journey_dup",
    });
    expect(dupe.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(dupe.db.friendships).toHaveLength(1);
    expect(dupe.db.notifications.length).toBe(db().notifications.length);

    // Meera was told once.
    const requests = db().notifications.filter((n) => n.recipientId === SEED_PEER_ID && n.title === "New friend request");
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toBe("@aarav wants to join your Friend Circle.");
    view.unmount();
    cleanup();

    // 10–12. Switch to Meera: the incoming request is waiting.
    view = await signedIn(SEED_PEER_ID, "teen", "/friends");
    const incoming = await screen.findByRole("list", { name: "Incoming requests" });
    expect(within(incoming).getByText("Aarav Sharma")).toBeInTheDocument();
    expect(within(incoming).getByText("@aarav")).toBeInTheDocument();
    expect(incoming.textContent).not.toMatch(/usr_aarav|wal_|₹/);

    // 13. Accept.
    await user.click(within(incoming).getByRole("button", { name: "Accept @aarav" }));
    expect(await screen.findByText("You and @aarav are now friends.")).toBeInTheDocument();

    // 14. Meera's circle shows the friendship; Aarav heard it once.
    expect(await screen.findByRole("list", { name: "Friends" })).toHaveTextContent("Aarav Sharma");
    expect(
      db().notifications.filter((n) => n.recipientId === SEED_TEEN_ID && n.title === "Friend request accepted"),
    ).toHaveLength(1);
    view.unmount();
    cleanup();

    // 15–16. Back to Aarav: Meera is in his circle.
    view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    const friends = await screen.findByRole("list", { name: "Friends" });
    expect(within(friends).getByText("Meera Kapoor")).toBeInTheDocument();

    // 17. Open the friend detail.
    await go("/friends/meera");
    expect(await screen.findByRole("heading", { level: 1, name: "Meera Kapoor" })).toBeInTheDocument();
    expect(screen.getByText("Friends")).toBeInTheDocument();

    // 18–19. Send Money through the friend: the existing flow, preselected.
    expect(screen.getByRole("link", { name: "Send Money" })).toHaveAttribute("href", "/send?to=meera&via=friend");
    await go("/send?to=meera&via=friend");
    expect(await screen.findByRole("heading", { level: 1, name: "Send money" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Send to @meera" })).toBeInTheDocument();
    expect(screen.getByText(/from your Friend Circle/)).toBeInTheDocument();
    // The review step is the existing one (available balance, engine rules)…
    await user.type(screen.getByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Send ₹100" })).toBeInTheDocument();
    expect(screen.getByText("From your available balance")).toBeInTheDocument();
    // …and we return without confirming: nothing moved.
    await go("/friends/meera");
    expect(moneySnapshot()).toBe(moneyBefore);

    // 20. Request Money through the friend: same existing contract.
    await go("/request?to=meera&via=friend");
    expect(await screen.findByRole("heading", { level: 1, name: "Request money" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Request from @meera" })).toBeInTheDocument();
    await user.type(screen.getByLabelText("Amount"), "60");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Request ₹60" })).toBeInTheDocument();
    // Return without sending the request.
    await go("/friends/meera");
    expect(moneySnapshot()).toBe(moneyBefore);
    expect(db().peerRequests).toHaveLength(0);

    // 21–22. Remove the friendship (with confirmation).
    await user.click(screen.getByRole("button", { name: "Remove friend" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove friend" }));
    expect(await screen.findByText(/removed from your Friend Circle/)).toBeInTheDocument();
    expect(db().friendships![0]).toMatchObject({ status: "removed" });
    // Removal touched nothing financial.
    expect(moneySnapshot()).toBe(moneyBefore);
    view.unmount();
    cleanup();

    // 23. A fresh request is possible after removal.
    view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    await user.type(await screen.findByLabelText("TeenPay ID"), "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await user.click(await screen.findByRole("button", { name: "Add Friend" }));
    await screen.findByText("Friend request sent to @meera.");
    view.unmount();
    cleanup();

    // 24–25. Meera declines; the declined state is recorded, quietly.
    view = await signedIn(SEED_PEER_ID, "teen", "/friends");
    await screen.findByRole("list", { name: "Incoming requests" });
    await user.click(screen.getByRole("button", { name: "Decline @aarav" }));
    expect(await screen.findByText("Request from @aarav declined.")).toBeInTheDocument();
    const declinedRecord = db().friendships!.find((f) => f.status === "declined");
    expect(declinedRecord).toMatchObject({ requesterAccountId: SEED_TEEN_ID, recipientAccountId: SEED_PEER_ID });
    view.unmount();
    cleanup();

    // Aarav sees no pending request any more.
    view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    expect(await screen.findByText("No pending requests")).toBeInTheDocument();

    // 26. He can ask again.
    await user.type(await screen.findByLabelText("TeenPay ID"), "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await user.click(await screen.findByRole("button", { name: "Add Friend" }));
    await screen.findByText("Friend request sent to @meera.");

    // 27–28. …and cancels it himself.
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText("Your request to @meera was cancelled.")).toBeInTheDocument();
    expect(db().friendships!.filter((f) => f.status === "cancelled")).toHaveLength(1);
    expect(await screen.findByText("No pending requests")).toBeInTheDocument();

    // 29. Nothing financial changed through any friendship action.
    expect(moneySnapshot()).toBe(moneyBefore);
    view.unmount();
    cleanup();

    // 30. The parent is gated out of the teen's Friend Circle.
    view = await signedIn(SEED_PARENT_ID, "parent", "/friends");
    expect(await screen.findByText(/This is Aarav's space/)).toBeInTheDocument();
    expect(screen.queryByText("Meera Kapoor")).not.toBeInTheDocument();
    view.unmount();
    cleanup();

    // 31–32. Back as the teen: isolation holds — Meera's decline history
    // never appears in Aarav's circle; only his own relationships show.
    view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    await screen.findByRole("heading", { level: 1, name: "Friend Circle" });
    expect(screen.getByText("Your trusted circle is empty")).toBeInTheDocument();
    expect(screen.getByText("No new friend requests")).toBeInTheDocument();
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/usr_meera|wal_usr_meera|fam_kapoor/);

    // 33. Reset the sandbox from Profile; the session ends.
    await go("/profile");
    await user.click(screen.getByRole("button", { name: /^Reset$/ }));
    const confirm = await screen.findByRole("dialog");
    await user.click(within(confirm).getByRole("button", { name: /^Reset$/ }));
    await settle();
    view.unmount();
    cleanup();

    // 34. Friendship state reset: a fresh sign-in starts with an empty
    // circle and untouched money.
    view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    expect(await screen.findByText("Your trusted circle is empty")).toBeInTheDocument();
    expect(db().friendships ?? []).toEqual([]);
    expect(moneySnapshot()).toBe(moneyBefore);
  }, 30000);
});
