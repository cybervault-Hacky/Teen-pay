import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider, useOptionalAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { spaceBalance, walletBalance } from "@/sandbox/engine";
import { acceptMoneyRequestTransition, approveTransferTransition, sendMoneyTransition } from "@/sandbox/peer-transitions";
import { qrIdentityFor } from "@/sandbox/qr";
import { scopeFor } from "@/sandbox/scope";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { SandboxProvider, useOptionalSandbox, type SandboxContextValue } from "@/sandbox/store";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, SANDBOX_KEY, TEEN_WALLET, linkedDatabase } from "./helpers/fixtures";
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
 * Phase 9 acceptance journey — QR Payments, Contacts & Fast Pay — through
 * the real provider stack (AuthProvider → SandboxProvider → AppShell /
 * AuthGate), the real page modules and localStorage. jsdom + Testing
 * Library: an automated UI journey, not a real browser, and no real
 * camera — the QR is entered through the labelled sandbox paste path,
 * exactly as the scanner would hand it over. Real clock.
 */
configure({ asyncUtilTimeout: 5000 });

const MEERA_WALLET = "wal_usr_meera";
const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const save = (next: SandboxDatabase) => window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(next));
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);
const transfers = () => db().operations.filter((op) => op.type === "transfer");
const noticesFor = (to: string, title: string) => db().notifications.filter((n) => n.recipientId === to && n.title === title);
const now = () => new Date().toISOString();

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

async function amountThenContinue(user: ReturnType<typeof userEvent.setup>, amount: string, note?: string) {
  await user.type(await screen.findByLabelText("Amount"), amount);
  if (note) await user.type(screen.getByLabelText("Note (optional)"), note);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

describe("Phase 9 journey — QR Payments, Contacts & Fast Pay", () => {
  it("43 steps: my QR, scan, favourite, quick pay & request, remove, Spaces, freeze, approval, reload, sign-out", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    // Aarav is connected to Priya, who approves payments over ₹500.
    save(linkedDatabase({ threshold: 500 }));
    // What Meera's own "My QR" screen encodes (her public identity only).
    const meeraQr = qrIdentityFor(db(), SEED_PEER_ID);
    if (!meeraQr.ok) throw new Error("no QR for Meera");
    const MEERA_CODE = meeraQr.value.payload;

    // 1. Aarav signs in; Money shows Scan & Pay and My QR with Send/Request, and Favourites before Spaces.
    let view = await signedIn(SEED_TEEN_ID, "teen", "/money");
    const actions = await screen.findByRole("region", { name: "Send and request" });
    expect(within(actions).getByRole("link", { name: "Scan & Pay" })).toHaveAttribute("href", "/qr/scan");
    expect(within(actions).getByRole("link", { name: "My QR" })).toHaveAttribute("href", "/qr");
    const regions = screen.getAllByRole("region").map((r) => r.getAttribute("aria-label"));
    expect(regions.indexOf("Favourites")).toBeGreaterThan(regions.indexOf("Send and request"));
    expect(regions.indexOf("Favourites")).toBeLessThan(regions.indexOf("Money Spaces"));

    // 2. My QR: a real QR, name, @aarav and "Scan to pay me".
    await go("/qr");
    expect(await screen.findByRole("heading", { level: 1, name: "My TeenPay QR" })).toBeInTheDocument();
    const myQr = screen.getByRole("img", { name: /TeenPay QR code for @aarav/ });
    expect(screen.getByText("Scan to pay me")).toBeInTheDocument();

    // 3. It encodes only the public TeenPay ID — no ids, balance, token or time.
    expect(myQr).toHaveAttribute("data-qr-payload", "teenpay://user/@aarav?v=1");
    expect(myQr.getAttribute("data-qr-payload")).not.toMatch(/usr_|wal_|fam_|\d{4}-|token|session/);
    expect(document.querySelector("main")?.textContent).not.toMatch(/usr_|wal_|fam_|₹/);

    // 4. Scanning your own code is blocked.
    await go("/qr/scan");
    expect(await screen.findByRole("heading", { level: 1, name: "Scan to pay" })).toBeInTheDocument();
    await pasteQr(user, "teenpay://user/@aarav?v=1");
    expect(await screen.findByRole("alert")).toHaveTextContent("This is your own TeenPay QR.");

    // 5. A tampered code (an internal wallet id) is refused.
    await pasteQr(user, `teenpay://user/@${MEERA_WALLET}?v=1`);
    expect(await screen.findByRole("alert")).toHaveTextContent("This isn't a TeenPay QR code.");

    // 6. Meera's code resolves to her safe profile.
    await pasteQr(user, MEERA_CODE);
    expect(await screen.findByRole("heading", { name: "Pay or request" })).toBeInTheDocument();
    expect(screen.getByText("Meera Kapoor")).toBeInTheDocument();
    expect(screen.getByText("@meera")).toBeInTheDocument();

    // 7. Scanning moved nothing.
    expect(transfers()).toHaveLength(0);
    expect(aarav()).toBe(1850);

    // 8. Save her as a favourite: one record, TeenPay ID only.
    await user.click(screen.getByRole("button", { name: "Add to favourites" }));
    expect(await screen.findByText("@meera added to favourites.")).toBeInTheDocument();
    expect(db().contacts).toHaveLength(1);
    expect(Object.keys(db().contacts[0]!).sort()).toEqual(["contactId", "createdAt", "ownerAccountId", "teenPayId", "updatedAt"]);
    expect(db().contacts[0]).toMatchObject({ ownerAccountId: SEED_TEEN_ID, teenPayId: "meera" });

    // 9. Favourites lists her with one-tap Pay / Request.
    await go("/contacts");
    const favs = await screen.findByRole("list", { name: "Favourites" });
    expect(within(favs).getByText("Meera Kapoor")).toBeInTheDocument();
    const payLink = within(favs).getByRole("link", { name: "Pay @meera" });
    expect(payLink).toHaveAttribute("href", "/send?to=meera&via=favourite");

    // 10. Quick Pay opens the normal Send flow with Meera preselected.
    await go(payLink.getAttribute("href")!);
    expect(await screen.findByRole("heading", { name: "Send to @meera" })).toBeInTheDocument();
    expect(screen.getByText("Meera Kapoor · from your favourites")).toBeInTheDocument();

    // 11. Amount → review; still nothing moved.
    await amountThenContinue(user, "100");
    expect(await screen.findByRole("heading", { name: "Send ₹100" })).toBeInTheDocument();
    expect(screen.getByText("From your available balance")).toBeInTheDocument();
    expect(transfers()).toHaveLength(0);

    // 12. A double confirm → "Money sent" with a reference.
    await user.dblClick(screen.getByRole("button", { name: "Send ₹100" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    const sentRef = (await screen.findByText(/^TRF-/)).textContent!;

    // 13. Exactly one transfer; balances move.
    expect(transfers()).toHaveLength(1);
    expect(transfers()[0]!.reference).toBe(sentRef);
    expect(aarav()).toBe(1750);
    expect(meera()).toBe(1300);

    // 14. The same notifications as any send, once each.
    expect(noticesFor(SEED_TEEN_ID, "₹100 sent to @meera.")).toHaveLength(1);
    expect(noticesFor(SEED_PEER_ID, "You received ₹100.")).toHaveLength(1);

    // 15. Activity shows it like any send — party and reference, no ids.
    await go("/activity");
    await user.click((await screen.findAllByRole("button", { name: /Money sent.*open details/i }))[0]!);
    const detail = await screen.findByRole("dialog");
    expect(within(detail).getByText("@meera · Meera Kapoor")).toBeInTheDocument();
    expect(within(detail).getByText(sentRef)).toBeInTheDocument();
    expect(detail.textContent).not.toMatch(/usr_meera|wal_usr_meera|ctc_/);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // 16. Quick Request from the favourite opens the normal Request flow.
    await go("/request?to=meera&via=favourite");
    expect(await screen.findByRole("heading", { name: "Request from @meera" })).toBeInTheDocument();

    // 17. ₹200 "Snacks" → request sent; pending; no balance change.
    await amountThenContinue(user, "200", "Snacks");
    await user.click(await screen.findByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument();
    expect(db().peerRequests).toMatchObject([{ amount: 200, note: "Snacks", status: "pending" }]);
    expect(aarav()).toBe(1750);
    expect(transfers()).toHaveLength(1);
    view.unmount();
    cleanup();

    // 18. Meera sees it incoming.
    view = await signedIn(SEED_PEER_ID, "teen", "/requests");
    const incoming = await screen.findByRole("region", { name: "Incoming" });
    expect(within(incoming).getByText("₹200 requested by @aarav")).toBeInTheDocument();

    // 19. She pays it.
    await user.click(within(incoming).getByRole("button", { name: "Pay ₹200" }));
    await user.click(within(incoming).getByRole("button", { name: "Confirm ₹200" }));
    expect(await screen.findByText(/^Paid ₹200 to @aarav · TRF-/)).toBeInTheDocument();

    // 20. Exactly one transfer for the request.
    const requestId = db().peerRequests[0]!.requestId;
    expect(transfers().filter((op) => op.requestId === requestId)).toHaveLength(1);
    expect(meera()).toBe(1100);
    expect(aarav()).toBe(1950);

    // 21. Accepting again posts nothing.
    const again = acceptMoneyRequestTransition(db(), { actorId: SEED_PEER_ID, at: now(), requestId });
    expect(again.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(again.db).toEqual(db());

    // 22. Aarav was told once.
    expect(noticesFor(SEED_TEEN_ID, "₹200 request was paid.")).toHaveLength(1);

    // 23. Aarav's favourites are his alone: Meera's list is empty.
    await go("/contacts");
    expect(await screen.findByText("No favourites yet")).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 24. Aarav removes Meera from favourites.
    view = await signedIn(SEED_TEEN_ID, "teen", "/contacts");
    await user.click(await screen.findByRole("button", { name: "Remove @meera from favourites" }));
    expect(await screen.findByText(/@meera removed from favourites. Past payments and requests aren't affected./)).toBeInTheDocument();
    expect(db().contacts).toEqual([]);

    // 25. History is untouched.
    expect(transfers()).toHaveLength(2);
    expect(db().peerRequests).toMatchObject([{ status: "accepted" }]);
    await go("/activity");
    expect((await screen.findAllByRole("button", { name: /Money sent.*open details/i })).length).toBeGreaterThan(0);

    // 26. He adds her back by search.
    await go("/contacts");
    await user.click(await screen.findByRole("button", { name: "Add a favourite" }));
    await user.type(await screen.findByRole("searchbox", { name: "Who do you want to add?" }), "meera");
    await user.click(within(await screen.findByRole("list", { name: "TeenPay users" })).getByRole("button", { name: /Meera Kapoor/ }));
    await user.click(await screen.findByRole("button", { name: "Add to favourites" }));
    expect(await screen.findByText("@meera added to favourites.")).toBeInTheDocument();
    expect(db().contacts).toHaveLength(1);

    // 27. He puts ₹1,000 into Save → ₹950 available.
    await go("/money");
    await user.click(await screen.findByRole("button", { name: "Add to Save" }));
    const addSheet = await screen.findByRole("dialog", { name: "Add to Save" });
    await user.type(within(addSheet).getByLabelText("Amount"), "1000");
    await user.click(within(addSheet).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(aarav()).toBe(950);
    expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(1800);

    // 28. Scan → Pay ₹1,000 is refused: Spaces money isn't available.
    await go("/qr/scan");
    await pasteQr(user, MEERA_CODE);
    await user.click(await screen.findByRole("button", { name: "Pay" }));
    await settle();
    expect(nav.url).toBe("/send?to=meera&via=qr");
    expect(await screen.findByText("Meera Kapoor · from a TeenPay QR")).toBeInTheDocument();
    await user.type(await screen.findByLabelText("Amount"), "1000");
    expect((await screen.findAllByText("Not enough available money. You have ₹950 available.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();

    // 29. …and the engine refuses it too; Save untouched.
    const over = sendMoneyTransition(db(), { actorId: SEED_TEEN_ID, at: now(), recipient: "@meera", amount: 1000, idempotencyKey: "snd_journey_over" });
    expect(over.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(1800);
    expect(transfers()).toHaveLength(2);

    // 30. Aarav freezes his wallet from Money.
    await go("/money");
    await user.click(await screen.findByRole("button", { name: "Freeze wallet" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Freeze" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(db().wallets.find((w) => w.id === TEEN_WALLET)?.status).toBe("frozen");

    // 31. A favourite payment is blocked while frozen; nothing moves.
    await go("/send?to=meera&via=favourite");
    expect(await screen.findByRole("note", { name: "Wallet frozen" })).toBeInTheDocument();
    const frozen = sendMoneyTransition(db(), { actorId: SEED_TEEN_ID, at: now(), recipient: "@meera", amount: 100, idempotencyKey: "snd_journey_frozen" });
    expect(frozen.result).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    expect(frozen.db).toEqual(db());
    expect(transfers()).toHaveLength(2);

    // 32. He unfreezes.
    await go("/money");
    await user.click(await screen.findByRole("button", { name: "Unfreeze wallet" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Unfreeze" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(db().wallets.find((w) => w.id === TEEN_WALLET)?.status).toBe("active");

    // 33. Scan → Pay ₹600: over Priya's threshold, so he asks her.
    await go("/qr/scan");
    await pasteQr(user, MEERA_CODE);
    await user.click(await screen.findByRole("button", { name: "Pay" }));
    await settle();
    await user.type(await screen.findByLabelText("Amount"), "600");
    expect(await screen.findByText(/This needs parent approval/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Ask Priya to approve" }));
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();

    // 34. Nothing moved before approval.
    expect(aarav()).toBe(950);
    expect(transfers()).toHaveLength(2);

    // 35. One pending transfer approval, for @meera.
    const approval = scopeFor(db(), SEED_PARENT_ID)!.state.approvals.find((a) => a.kind === "transfer" && a.status === "pending")!;
    expect(approval).toMatchObject({ amount: 600, recipientName: "@meera" });
    view.unmount();
    cleanup();

    // 36. Priya approves → exactly one transfer, through the same path.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Approve ₹600 to @meera" }));
    await waitFor(() => expect(transfers()).toHaveLength(3));
    expect(transfers().filter((op) => op.approvalId === approval.id)).toHaveLength(1);

    // 37. Balances; conserved with the ₹1,000 Aarav keeps in Save.
    expect(aarav()).toBe(350);
    expect(meera()).toBe(1700);
    expect(aarav() + meera() + 1000).toBe(1850 + 1200);

    // 38. Approving again never posts twice.
    const twice = approveTransferTransition(db(), { actorId: SEED_PARENT_ID, at: now(), approvalId: approval.id });
    expect(twice.db).toEqual(db());

    // 39. Both teens were told once.
    expect(noticesFor(SEED_TEEN_ID, "₹600 sent to @meera.")).toHaveLength(1);
    expect(noticesFor(SEED_PEER_ID, "You received ₹600.")).toHaveLength(1);
    view.unmount();
    cleanup();

    // 40. Reload as Aarav: the favourite is still there, once.
    const ledgerBefore = db().ledger.length;
    view = await signedIn(SEED_TEEN_ID, "teen", "/contacts");
    const reloaded = await screen.findByRole("list", { name: "Favourites" });
    expect(within(reloaded).getAllByRole("listitem")).toHaveLength(1);
    expect(within(reloaded).getByText("Meera Kapoor")).toBeInTheDocument();

    // 41. Everything else persisted too, with no duplicates; the QR is the same.
    expect(db().ledger.length).toBe(ledgerBefore);
    expect(transfers()).toHaveLength(3);
    expect(db().peerRequests.map((r) => r.status)).toEqual(["accepted"]);
    expect(aarav()).toBe(350);
    await go("/qr");
    expect(await screen.findByRole("img", { name: /TeenPay QR code for @aarav/ })).toHaveAttribute(
      "data-qr-payload",
      "teenpay://user/@aarav?v=1",
    );
    view.unmount();
    cleanup();

    // 42. After sign-out, a stale screen's QR and favourite actions are refused.
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, Date.now());
    let auth: AuthContextValue | null = null;
    let live: SandboxContextValue | null = null;
    function CaptureBoth() {
      auth = useOptionalAuth();
      live = useOptionalSandbox();
      return null;
    }
    view = render(
      <AuthProvider service={service}>
        <SandboxProvider>
          <CaptureBoth />
        </SandboxProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(live).not.toBeNull());
    const stale = live!.actions;
    act(() => auth!.signOut("user"));
    await waitFor(() => expect(live).toBeNull());
    const before = db();
    for (const result of [
      stale.startQrPayment(MEERA_CODE),
      stale.startQrRequest(MEERA_CODE),
      stale.resolveQrIdentity(MEERA_CODE),
      stale.addContact("@meera"),
      stale.removeContact("@meera"),
      stale.sendMoney({ recipient: "@meera", amount: 100, idempotencyKey: "snd_journey_stale" }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    }
    expect(db()).toEqual(before);
    view.unmount();
    cleanup();

    // 43. An unrelated teen sees none of Aarav's favourites and can't reach them.
    const made = createAccount(db(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    save(made.db);
    expect(scopeFor(db(), made.account.id)!.state.contacts).toEqual([]);
    expect(scopeFor(db(), SEED_TEEN_ID)!.state.contacts).toHaveLength(1);
  }, 120_000);
});
