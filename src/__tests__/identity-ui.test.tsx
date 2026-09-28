import { act, cleanup, configure, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { acceptFriendRequestTransition, sendFriendRequestTransition } from "@/sandbox/friends";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
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

/**
 * TeenPay ID UI (Phase 13): the profile identity card (copy, share,
 * change), the /id lookup and the shared /id/[teenPayId] surface —
 * through the real provider stack and page modules.
 */
configure({ asyncUtilTimeout: 5000 });

const save = (next: SandboxDatabase) => window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(next));

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

function mockClipboard() {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  return writeText;
}

function friendsSeed(): SandboxDatabase {
  const at = new Date().toISOString();
  const sent = sendFriendRequestTransition(buildSeedDatabase(), {
    actorId: SEED_TEEN_ID,
    at,
    teenPayId: "@meera",
    requestId: "frd_id_ui_a",
  });
  if (!sent.result.ok) throw new Error(sent.result.error.message);
  const accepted = acceptFriendRequestTransition(sent.db, {
    actorId: SEED_PEER_ID,
    at,
    friendshipId: sent.result.value.friendshipId,
  });
  if (!accepted.result.ok) throw new Error(accepted.result.error.message);
  return accepted.db;
}

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
  Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
});

describe("Profile — the identity card", () => {
  it("shows the teen's ID with copy, share and change", async () => {
    const user = userEvent.setup();
    const writeText = mockClipboard();
    await signedIn(SEED_TEEN_ID, "teen", "/profile");

    expect(await screen.findByRole("heading", { level: 2, name: "TeenPay ID" })).toBeInTheDocument();
    const section = screen.getByRole("region", { name: "TeenPay ID" });
    expect(within(section).getByText("@aarav")).toBeInTheDocument();
    expect(within(section).getByText("Your unique identity on TeenPay")).toBeInTheDocument();

    await user.click(within(section).getByRole("button", { name: "Copy ID" }));
    expect(await within(section).findByRole("status")).toHaveTextContent("Copied @aarav.");
    expect(writeText).toHaveBeenCalledWith("@aarav");

    // The identity surface never leaks internal ids.
    expect(document.body.textContent).not.toMatch(/usr_|wal_|fam_/);
  }, 15000);

  it("shares only the identity when the browser offers sharing", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    await signedIn(SEED_TEEN_ID, "teen", "/profile");

    await userEvent.setup().click(await screen.findByRole("button", { name: "Share ID" }));
    expect(share).toHaveBeenCalledTimes(1);
    const shared = share.mock.calls[0]![0] as { text: string };
    expect(shared.text).toContain("@aarav");
    expect(JSON.stringify(shared)).not.toMatch(/usr_|wal_|₹/);
  });

  it("parents get no identity card and no change action", async () => {
    await signedIn(SEED_PARENT_ID, "parent", "/profile");
    await screen.findByRole("heading", { level: 2, name: "Account" });
    expect(screen.queryByRole("button", { name: "Change TeenPay ID" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy ID" })).not.toBeInTheDocument();
  });
});

describe("Profile — changing the TeenPay ID", () => {
  it("validates live and refuses reserved, taken and malformed IDs", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/profile");
    await user.click(await screen.findByRole("button", { name: "Change TeenPay ID" }));
    const dialog = await screen.findByRole("dialog");

    const input = within(dialog).getByLabelText("New TeenPay ID");
    const saveButton = within(dialog).getByRole("button", { name: "Save new ID" });

    await user.type(input, "admin");
    expect(within(dialog).getByRole("status")).toHaveTextContent("That ID is reserved. Try another.");
    expect(saveButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "meera");
    expect(within(dialog).getByRole("status")).toHaveTextContent("That ID is already taken in this sandbox.");
    expect(saveButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "ab");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Use at least 3 characters.");
    expect(saveButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "@aarav");
    expect(within(dialog).getByRole("status")).toHaveTextContent("That's already your TeenPay ID.");
  });

  it("saves an available ID and the whole profile follows", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/profile");
    await user.click(await screen.findByRole("button", { name: "Change TeenPay ID" }));
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByLabelText("New TeenPay ID"), "rohan");
    expect(within(dialog).getByRole("status")).toHaveTextContent("@rohan is available.");
    await user.click(within(dialog).getByRole("button", { name: "Save new ID" }));

    const section = await screen.findByRole("region", { name: "TeenPay ID" });
    expect(within(section).getByText("@rohan")).toBeInTheDocument();
    expect(within(section).queryByText("@aarav")).not.toBeInTheDocument();
    expect(await within(section).findByRole("status")).toHaveTextContent("You're now @rohan.");
    // The stored account really changed — alias only.
    const stored = JSON.parse(window.localStorage.getItem(SANDBOX_KEY)!) as SandboxDatabase;
    const aarav = stored.accounts.find((a) => a.id === SEED_TEEN_ID)!;
    expect(aarav.username).toBe("rohan");
    expect(aarav.identifier).toBe("sandbox:rohan");
  }, 15000);
});

describe("/id — the canonical lookup", () => {
  it("shows the identity card and resolves a known ID to /id/<handle>", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/id");

    expect(await screen.findByRole("heading", { level: 1, name: "TeenPay ID" })).toBeInTheDocument();
    const identitySection = screen.getByRole("region", { name: "Your TeenPay ID" });
    expect(within(identitySection).getByText("@aarav")).toBeInTheDocument();

    await user.type(screen.getByRole("textbox", { name: "Find someone" }), "@meera");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    await settle();
    expect(nav.url).toBe("/id/meera");
  }, 15000);

  it("unknown, reserved-looking and malformed IDs get safe errors", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/id");
    const input = await screen.findByRole("textbox", { name: "Find someone" });
    const lookUp = screen.getByRole("button", { name: "Look up" });
    const section = screen.getByRole("region", { name: "Find someone" });

    await user.type(input, "@nobody");
    await user.click(lookUp);
    expect(await within(section).findByRole("status")).toHaveTextContent("No TeenPay user found.");
    expect(nav.url).toBe("/id");

    await user.clear(input);
    await user.type(input, "usr_meera");
    await user.click(lookUp);
    expect(await within(section).findByRole("status")).toHaveTextContent(
      "Enter a TeenPay ID like @meera.",
    );
    expect(nav.url).toBe("/id");
  }, 15000);

  it("parents are gated", async () => {
    await signedIn(SEED_PARENT_ID, "parent", "/id");
    expect(await screen.findByText(/This is Aarav's space/)).toBeInTheDocument();
  });
});

describe("/id/[teenPayId] — the shared identity surface", () => {
  it("shows the safe profile with the money, favourite and friend actions", async () => {
    const user = userEvent.setup();
    await signedIn(SEED_TEEN_ID, "teen", "/id/meera");

    expect(await screen.findByRole("heading", { level: 1, name: "Meera Kapoor" })).toBeInTheDocument();
    expect(screen.getByText("@meera")).toBeInTheDocument();
    expect(screen.getByText("Not connected")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/usr_meera|wal_|₹|balance/i);

    // Money actions reuse the existing flows; no automatic payment.
    expect(screen.getByRole("link", { name: "Send Money" })).toHaveAttribute("href", "/send?to=meera");
    expect(screen.getByRole("link", { name: "Request Money" })).toHaveAttribute("href", "/request?to=meera");

    await user.click(screen.getByRole("button", { name: "Add favourite" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Added @meera to your favourites.");
    expect(screen.getByText("Favourite")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add friend" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Friend request sent to @meera.");
  });

  it("uses the friend origin once the friendship exists", async () => {
    save(friendsSeed());
    await signedIn(SEED_TEEN_ID, "teen", "/id/meera");

    expect(await screen.findByText("Friend")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Send Money" })).toHaveAttribute("href", "/send?to=meera&via=friend");
    expect(screen.getByRole("link", { name: "Request Money" })).toHaveAttribute(
      "href",
      "/request?to=meera&via=friend",
    );
    expect(screen.getByRole("link", { name: "View in Friend Circle" })).toHaveAttribute(
      "href",
      "/friends/meera",
    );
  });

  it("your own ID opens the identity card, not an action surface", async () => {
    await signedIn(SEED_TEEN_ID, "teen", "/id/aarav");
    expect(await screen.findByRole("heading", { level: 1, name: "Your TeenPay ID" })).toBeInTheDocument();
    expect(screen.getByText("Your unique identity on TeenPay")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Send Money" })).not.toBeInTheDocument();
  });

  it("rejects internal-id-shaped route parameters safely", async () => {
    await signedIn(SEED_TEEN_ID, "teen", "/id/usr_meera");
    expect(await screen.findByText("That doesn't look like a TeenPay ID")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/Meera Kapoor/);
  });
});

describe("route protection", () => {
  it("signed-out visitors are sent to sign-in from /id", async () => {
    resetRouter("/id");
    render(<TestApp />);
    await settle();
    expect(nav.url).toBe("/sign-in?next=%2Fid");
  });
});
