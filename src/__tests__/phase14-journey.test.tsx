import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SESSION_STORAGE_KEY, createSandboxAuthService } from "@/auth/sandbox-service";
import { primaryWalletId } from "@/domain";
import { createAccount } from "@/sandbox/accounts";
import { walletBalance } from "@/sandbox/engine";
import { createMoneyRequestTransition } from "@/sandbox/peer-transitions";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { SANDBOX_KEY, linkedDatabase, preloadDatabase } from "./helpers/fixtures";
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
 * Phase 14 acceptance journey — Teen Safety Shield — through the real
 * provider stack, the real page modules and localStorage. jsdom +
 * Testing Library: an automated UI journey, not a real browser.
 *
 * Aarav meets every layer of the shield in order: the /safety page,
 * the calm pause before a first payment, guardian approval untouched,
 * large-payment review and its optional toggle, a stranger's request,
 * the verify-first QR, the balance wall, and the parent gate — while
 * authorization, limits, balances and the ledger stay in charge of
 * every rupee.
 */
configure({ asyncUtilTimeout: 10000 });

const TEEN_WALLET = primaryWalletId(SEED_TEEN_ID);
const MEERA_WALLET = primaryWalletId(SEED_PEER_ID);

/** Linked family (Priya approves above ₹400) + a stranger teen Kian who asks Aarav for ₹60. */
function journeyDatabase(): SandboxDatabase {
  let db = linkedDatabase({ daily: null, perTx: null, threshold: 400 });
  const made = createAccount(db, { role: "teen", displayName: "Kian Rao", username: "kian" }, NOW);
  if ("code" in made) throw new Error(made.message);
  db = made.db;
  const asked = createMoneyRequestTransition(db, {
    actorId: made.account.id,
    at: NOW,
    payer: "@aarav",
    amount: 60,
    idempotencyKey: "prq_journey_kian",
  });
  if (!asked.result.ok) throw new Error(JSON.stringify(asked.result));
  return asked.db;
}

const NOW = "2026-09-26T06:00:00Z";

const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);

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

async function pickMeera(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("searchbox", { name: /who are you sending to/i }), "mee");
  const list = await screen.findByRole("list", { name: "TeenPay users" });
  await user.click(within(list).getByRole("button", { name: /Meera Kapoor/ }));
}

describe("Phase 14 journey — Teen Safety Shield", () => {
  afterEach(() => {
    cleanup();
  });

  it("45 steps: safety page, calm pause, guardian approval, toggles, stranger request, QR, gates", async () => {
    const user = userEvent.setup();
    preloadDatabase(journeyDatabase());
    const ledgerBefore = db().ledger.length;
    const notificationsBefore = db().notifications.length;

    // 1–2. Signed in as Aarav: home shows the balance the shield will reference.
    let view = await signedIn(SEED_TEEN_ID, "teen", "/");
    expect(await screen.findByText(/1,850/)).toBeInTheDocument();

    // 3. The profile's Safety section links to the shield.
    await go("/profile");
    const safetySection = await screen.findByRole("region", { name: "Safety" });
    expect(within(safetySection).getByRole("link", { name: /Safety Shield/ })).toHaveAttribute(
      "href",
      "/safety",
    );
    await go("/safety");

    // 4–6. /safety: required protections, three optional reminders, privacy.
    expect(await screen.findByRole("heading", { name: "Safety Shield" })).toBeInTheDocument();
    for (const title of [
      "Guardian approvals",
      "Daily and per-payment limits",
      "Balance and wallet checks",
      "One payment per action",
    ]) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    const switches = screen.getAllByRole("switch");
    expect(switches).toHaveLength(3);
    expect(switches.every((s) => s.getAttribute("aria-checked") === "true")).toBe(true);
    expect(screen.getByText(/no scoring, no background watching/)).toBeInTheDocument();

    // 7–10. First payment to Meera: search, amount, the calm pause.
    await go("/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "500");
    // The guardian rule speaks on the amount step — the shield adds to it, never replaces it.
    expect(await screen.findByText(/This needs parent approval/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));

    // 8–10. The review carries the shield's context inline — beside the
    // guardian message, never replacing it.
    expect(await screen.findByRole("heading", { name: "Send ₹500" })).toBeInTheDocument();
    const firstPause = screen.getByRole("note", { name: "Safety Shield" });
    expect(within(firstPause).getByText("First payment to @meera")).toBeInTheDocument();
    expect(within(firstPause).getByText(/@meera isn't in your Friend Circle/)).toBeInTheDocument();
    expect(
      within(firstPause).getByText(/You're in control — nothing moves until you confirm\./),
    ).toBeInTheDocument();

    // 11. The context moves nothing.
    expect(db().ledger).toHaveLength(ledgerBefore);
    expect(aarav()).toBe(1850);

    // 12–14. Confirm: the guardian threshold still speaks.
    await user.click(screen.getByRole("button", { name: "Ask Priya to approve" }));
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();
    expect(aarav()).toBe(1850); // approval asked, nothing moved

    // 15–17. Priya approves — exactly the Phase 8 path, shield nowhere in it.
    view.unmount();
    cleanup();
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Approve ₹500 to @meera" }));
    await waitFor(() => expect(aarav()).toBe(1350));
    expect(meera()).toBe(1700);

    // 18–20. Back as Aarav: Meera is now a known recipient — a clean review.
    view.unmount();
    cleanup();
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "250");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Send ₹250" })).toBeInTheDocument();
    expect(screen.queryByRole("note", { name: "Safety Shield" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send ₹250" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    await waitFor(() => expect(aarav()).toBe(1100));

    // 21–22. Two payments already left today — the review says so, calmly.
    await go("/money"); // bounce so /send remounts fresh
    await go("/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "50");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Send ₹50" });
    const repeatPause = screen.getByRole("note", { name: "Safety Shield" });
    expect(within(repeatPause).getByText("Several payments in a short time")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Send ₹50" }));
    await screen.findByRole("heading", { name: "Money sent" });
    await waitFor(() => expect(aarav()).toBe(1050));

    // 25–26. The balance wall is not the shield's job — and it's intact.
    await go("/money");
    await go("/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "2000");
    expect(await screen.findByText(/Not enough available money/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(aarav()).toBe(1050);

    // 27–28. Large-payment context: ₹600 is more than half of ₹1,050.
    await user.clear(screen.getByLabelText("Amount"));
    await user.type(screen.getByLabelText("Amount"), "600");
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Send ₹600" });
    const largePause = screen.getByRole("note", { name: "Safety Shield" });
    expect(within(largePause).getByText("A large part of your money")).toBeInTheDocument();
    expect(within(largePause).getByText("Several payments in a short time")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByLabelText("Amount");
    expect(aarav()).toBe(1050); // backing out spends nothing

    // 29–31. Switch the confirm-reminders off: the context stays, softened.
    await go("/safety");
    const reminderSwitches = await screen.findAllByRole("switch");
    reminderSwitches[1]!.focus(); // "Large payment review"
    await user.keyboard(" ");
    expect(await screen.findByText("Large payment review off.")).toBeInTheDocument();
    reminderSwitches[2]!.focus(); // "Repeated payment review"
    await user.keyboard(" ");
    expect(await screen.findByText("Repeated payment review off.")).toBeInTheDocument();

    await go("/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "600");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Send ₹600" })).toBeInTheDocument();
    const softened = screen.getByRole("note", { name: "Safety Shield" });
    // Never hidden — the same reasons, downgraded from pauses to notices.
    expect(within(softened).getByText("A large part of your money")).toBeInTheDocument();
    expect(within(softened).getByText("Several payments in a short time")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(aarav()).toBe(1050);

    // 32. Switch them back on — the teen stays in control of the reminders.
    await go("/safety");
    const backOn = await screen.findAllByRole("switch");
    backOn[1]!.focus();
    await user.keyboard(" ");
    expect(await screen.findByText("Large payment review on.")).toBeInTheDocument();
    backOn[2]!.focus();
    await user.keyboard(" ");
    expect(await screen.findByText("Repeated payment review on.")).toBeInTheDocument();

    // 32–34. A stranger's request: calm notice, and declining moves nothing.
    await go("/requests");
    const incoming = await screen.findByRole("region", { name: "Incoming" });
    expect(within(incoming).getByText(/₹60 requested by @kian/)).toBeInTheDocument();
    expect(
      within(incoming).getByText(/You don't need to accept requests from people you don't know/),
    ).toBeInTheDocument();
    await user.click(within(incoming).getByRole("button", { name: "Decline" }));
    expect(await screen.findByText(/Declined @kian's ₹60 request\. No money moved\./)).toBeInTheDocument();
    expect(aarav()).toBe(1050);

    // 35–37. QR stays identity-only, with its verify-first line.
    await go("/qr/scan");
    const qrInput = await screen.findByLabelText("Use a sandbox QR");
    await user.type(qrInput, "teenpay://user/@meera?v=1");
    await user.click(screen.getByRole("button", { name: "Look up" }));
    expect(await screen.findByText("Meera Kapoor")).toBeInTheDocument();
    expect(screen.getByText(/Verify the TeenPay ID before continuing/)).toBeInTheDocument();
    expect(screen.getByText(/nothing is paid, requested or saved by a scan/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Pay" }));
    expect(await screen.findByRole("heading", { name: "Send to @meera" })).toBeInTheDocument();

    // 38–40. Signed out, /safety is not reachable.
    view.unmount();
    cleanup();
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    const anonService = createSandboxAuthService();
    resetRouter("/safety");
    view = render(<TestApp service={anonService} />);
    await settle();
    expect(await screen.findByRole("heading", { name: "Welcome to TeenPay" })).toBeInTheDocument();
    expect(screen.queryByText("Optional reminders")).not.toBeInTheDocument();

    // 41–42. Parents see the gate, not the teen's shield.
    view.unmount();
    cleanup();
    view = await signedIn(SEED_PARENT_ID, "parent", "/safety");
    expect(await screen.findByText(/This is .* space/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();

    // 43–45. Invariants: one reminders record, conserved money, no shield chatter anywhere.
    const stored = db();
    expect(stored.shieldSettings).toHaveLength(1);
    expect(stored.shieldSettings![0]).toMatchObject({
      ownerAccountId: SEED_TEEN_ID,
      firstTimeRecipient: true,
      largePayments: true, // switched off and back on
      repeatedPayments: true,
    });
    // Every transfer is balanced: one debit, one credit, same amount.
    for (const op of stored.operations.filter((o) => o.type === "transfer")) {
      const legs = stored.ledger.filter((e) => e.operationId === op.id);
      expect(legs).toHaveLength(2);
      expect(legs[0]!.amount).toBe(legs[1]!.amount);
      expect(legs.map((l) => l.direction).sort()).toEqual(["credit", "debit"]);
    }
    expect(aarav() + meera() + walletBalance(stored.ledger, primaryWalletId("usr_kian"))).toBe(1850 + 1200);
    for (const notification of stored.notifications.slice(notificationsBefore)) {
      expect(`${notification.title} ${notification.body}`).not.toMatch(/shield|safety|first payment|large/i);
    }
    expect(JSON.stringify(stored)).not.toMatch(/"score"|riskScore|trustScore/);
  }, 120000);
});
