import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { acceptFriendRequestTransition, sendFriendRequestTransition } from "@/sandbox/friends";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { SANDBOX_KEY } from "./helpers/fixtures";
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
 * Friend Circle UI (Phase 12): the /friends screen, the friend detail
 * screen, the Home and Profile entry points, and the gates — through
 * the real provider stack and page modules.
 */
configure({ asyncUtilTimeout: 5000 });

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const save = (next: SandboxDatabase) => window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(next));

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

function pendingFromAaravSeed(): SandboxDatabase {
  const sent = sendFriendRequestTransition(buildSeedDatabase(), {
    actorId: SEED_TEEN_ID,
    at: new Date().toISOString(),
    teenPayId: "@meera",
    requestId: "frd_ui_gate_a",
  });
  if (!sent.result.ok) throw new Error(sent.result.error.message);
  return sent.db;
}

describe("/friends — empty states", () => {
  it("shows the three calm empty states for a new teen", async () => {
    await signedIn(SEED_TEEN_ID, "teen", "/friends");

    expect(await screen.findByRole("heading", { level: 1, name: "Friend Circle" })).toBeInTheDocument();
    expect(screen.getByText("Your trusted circle is empty")).toBeInTheDocument();
    expect(screen.getByText("Add someone you know by their TeenPay ID.")).toBeInTheDocument();
    expect(screen.getByText("No new friend requests")).toBeInTheDocument();
    expect(screen.getByText("No pending requests")).toBeInTheDocument();
    // No engagement pressure anywhere.
    expect(document.body.textContent).not.toMatch(/missing out|invite 5|streak|leaderboard/i);
  });
});

describe("/friends — discovery & preview", () => {
  it("lookup: self is neutral, unknown is quiet, malformed is guided", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/friends");
    const input = await screen.findByLabelText("TeenPay ID");

    await user.type(input, "@aarav");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("This is your TeenPay ID.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Friend" })).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "@ghost");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("No TeenPay user found.")).toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "!!");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("Enter a TeenPay ID like @meera.")).toBeInTheDocument();
  });

  it("finds Meera, shows only her public profile, adds her, shows pending, cancels", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/friends");
    const input = await screen.findByLabelText("TeenPay ID");
    await user.type(input, "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));

    const preview = await screen.findByText("Meera Kapoor");
    expect(preview).toBeInTheDocument();
    expect(screen.getAllByText("@meera").length).toBeGreaterThan(0);
    // The preview leaks no private data.
    const region = preview.closest("section")!;
    expect(region.textContent).not.toMatch(/usr_meera|wal_|fam_|balance/i);
    expect(within(region).queryByText(/₹/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Add Friend" }));
    expect(await screen.findByText("Friend request sent to @meera.")).toBeInTheDocument();
    // The preview now shows the pending state with a cancel action.
    expect((await screen.findAllByText("Request pending")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Cancel request" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Friend" })).not.toBeInTheDocument();
    expect(db().friendships).toHaveLength(1);

    // Cancelling clears it.
    await user.click(screen.getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText("Your request to @meera was cancelled.")).toBeInTheDocument();
    expect(await screen.findByText("Not connected")).toBeInTheDocument();
  });
});

describe("/friends — requests between two teens", () => {
  it("Meera sees the incoming request, accepts, and both circles update", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();

    let view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    const input = await screen.findByLabelText("TeenPay ID");
    await user.type(input, "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await user.click(await screen.findByRole("button", { name: "Add Friend" }));
    await screen.findByText("Friend request sent to @meera.");
    view.unmount();
    cleanup();

    view = await signedIn(SEED_PEER_ID, "teen", "/friends");
    const incoming = await screen.findByRole("list", { name: "Incoming requests" });
    expect(within(incoming).getByText("Aarav Sharma")).toBeInTheDocument();
    expect(within(incoming).getByText("@aarav")).toBeInTheDocument();
    await user.click(within(incoming).getByRole("button", { name: "Accept @aarav" }));
    expect(await screen.findByText("You and @aarav are now friends.")).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Friends" })).toHaveTextContent("Aarav Sharma");
    view.unmount();
    cleanup();

    view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    const friends = await screen.findByRole("list", { name: "Friends" });
    expect(within(friends).getByText("Meera Kapoor")).toBeInTheDocument();
    expect(within(friends).getByText("Friends")).toBeInTheDocument();
  });

  it("decline empties the request and lets Aarav try again later", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();

    let view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    const input = await screen.findByLabelText("TeenPay ID");
    await user.type(input, "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await user.click(await screen.findByRole("button", { name: "Add Friend" }));
    await screen.findByText("Friend request sent to @meera.");
    view.unmount();
    cleanup();

    view = await signedIn(SEED_PEER_ID, "teen", "/friends");
    const incoming = await screen.findByRole("list", { name: "Incoming requests" });
    await user.click(within(incoming).getByRole("button", { name: "Decline @aarav" }));
    expect(await screen.findByText("Request from @aarav declined.")).toBeInTheDocument();
    expect(await screen.findByText("No new friend requests")).toBeInTheDocument();
    view.unmount();
    cleanup();

    // Aarav: the request is gone from Sent; he can send a new one.
    view = await signedIn(SEED_TEEN_ID, "teen", "/friends");
    expect(await screen.findByText("No pending requests")).toBeInTheDocument();
    await user.type(await screen.findByLabelText("TeenPay ID"), "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await user.click(await screen.findByRole("button", { name: "Add Friend" }));
    expect(await screen.findByText("Friend request sent to @meera.")).toBeInTheDocument();
  });
});

describe("/friends/[id] — the friend detail screen", () => {
  it("shows Send / Request into the existing flows and removes with confirmation", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    // Pre-seed an accepted friendship.
    let seed = buildSeedDatabase();
    const sent = sendFriendRequestTransition(seed, { actorId: SEED_TEEN_ID, at: new Date().toISOString(), teenPayId: "@meera", requestId: "frd_ui_detail" });
    if (!sent.result.ok) throw new Error(sent.result.error.message);
    seed = acceptFriendRequestTransition(sent.db, { actorId: SEED_PEER_ID, at: new Date().toISOString(), friendshipId: sent.result.value.friendshipId }).db;
    save(seed);

    await signedIn(SEED_TEEN_ID, "teen", "/friends/meera");
    expect(await screen.findByRole("heading", { level: 1, name: "Meera Kapoor" })).toBeInTheDocument();
    expect(screen.getByText("Friends")).toBeInTheDocument();

    const send = screen.getByRole("link", { name: "Send Money" });
    expect(send).toHaveAttribute("href", "/send?to=meera&via=friend");
    const request = screen.getByRole("link", { name: "Request Money" });
    expect(request).toHaveAttribute("href", "/request?to=meera&via=friend");

    // Send Money opens the existing flow, preselected — nothing moves yet.
    await go("/send?to=meera&via=friend");
    expect(await screen.findByRole("heading", { level: 1, name: "Send money" })).toBeInTheDocument();
    expect(screen.getByText(/from your Friend Circle/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Send to @meera" })).toBeInTheDocument();

    // Request Money uses the same existing contract.
    await go("/request?to=meera&via=friend");
    expect(await screen.findByRole("heading", { level: 1, name: "Request money" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Request from @meera" })).toBeInTheDocument();

    await go("/friends/meera");

    // Remove asks first, then removes.
    await user.click(screen.getByRole("button", { name: "Remove friend" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Remove @meera?");
    await user.click(within(dialog).getByRole("button", { name: "Remove friend" }));
    expect(await screen.findByText(/removed from your Friend Circle/)).toBeInTheDocument();
    expect(db().friendships![0]).toMatchObject({ status: "removed" });

    // The detail now offers Add Friend again.
    expect(await screen.findByRole("button", { name: "Add Friend" })).toBeInTheDocument();
  }, 15000);

  it("a stranger's handle shows a calm not-found, and own handle shows self", async () => {
    await signedIn(SEED_TEEN_ID, "teen", "/friends/nobody");
    expect(await screen.findByRole("heading", { level: 1, name: "No TeenPay user found" })).toBeInTheDocument();

    await go("/friends/aarav");
    expect(await screen.findByText("This is your TeenPay ID.")).toBeInTheDocument();
  });
});

describe("gates", () => {
  it("a parent sees the teen gate, not the circle", async () => {
    // Even with a pending request in the data, the parent sees nothing of it.
    window.localStorage.clear();
    save(pendingFromAaravSeed());
    await signedIn(SEED_PARENT_ID, "parent", "/friends");
    expect(await screen.findByText(/This is Aarav's space/)).toBeInTheDocument();
    expect(screen.queryByText("Your trusted circle is empty")).not.toBeInTheDocument();
    expect(screen.queryAllByText("Meera Kapoor")).toHaveLength(0);
  });

  it("signed out, /friends and a friend page go to sign-in", async () => {
    for (const path of ["/friends", "/friends/meera"]) {
      resetRouter(path);
      const view = render(<TestApp service={createSandboxAuthService()} />);
      await settle();
      await waitFor(() => expect(nav.url).toMatch(/^\/sign-in/));
      view.unmount();
      cleanup();
    }
  });
});

describe("entry points", () => {
  it("Home shows the compact Friend Circle card; Profile has Connect (teen only)", async () => {
    let view = await signedIn(SEED_TEEN_ID, "teen", "/");
    const section = await screen.findByRole("region", { name: "Friend Circle" });
    expect(within(section).getByText("Your Circle")).toBeInTheDocument();
    expect(within(section).getByText("Add someone you know by their TeenPay ID")).toBeInTheDocument();
    await go("/profile");
    const connect = await screen.findByRole("region", { name: "Connect" });
    expect(within(connect).getByRole("link", { name: /Friend Circle/ })).toHaveAttribute("href", "/friends");
    view.unmount();
    cleanup();

    view = await signedIn(SEED_PARENT_ID, "parent", "/profile");
    await screen.findByRole("region", { name: "Account" });
    expect(screen.queryByRole("region", { name: "Connect" })).not.toBeInTheDocument();
  });
});
