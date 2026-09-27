import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { spaceBalance, walletBalance } from "@/sandbox/engine";
import {
  acceptMoneyRequestTransition,
  approveTransferTransition,
  createMoneyRequestTransition,
  requestIdFor,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { scopeFor } from "@/sandbox/scope";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, SANDBOX_KEY, TEEN_WALLET, linkedDatabase } from "./helpers/fixtures";
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
 * Phase 8 acceptance journey — Send & Request Money — through the real
 * provider stack (AuthProvider → SandboxProvider → AppShell/AuthGate),
 * the real page modules and localStorage. jsdom + Testing Library: an
 * automated UI journey, not a real browser. Real clock.
 */
configure({ asyncUtilTimeout: 5000 });

const MEERA_WALLET = "wal_usr_meera";
const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const save = (next: SandboxDatabase) => window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(next));
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);
const everything = () => db().ledger.reduce((sum, e) => sum + (e.direction === "credit" ? e.amount : -e.amount), 0);
const transfers = () => db().operations.filter((op) => op.type === "transfer");
const noticesFor = (to: string, title: string) => db().notifications.filter((n) => n.recipientId === to && n.title === title);

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

async function pick(user: ReturnType<typeof userEvent.setup>, question: RegExp, query: string, name: RegExp) {
  await user.type(await screen.findByRole("searchbox", { name: question }), query);
  const list = await screen.findByRole("list", { name: "TeenPay users" });
  await user.click(within(list).getByRole("button", { name }));
}

async function amountThenContinue(user: ReturnType<typeof userEvent.setup>, amount: string, note?: string) {
  await user.type(await screen.findByLabelText("Amount"), amount);
  if (note) await user.type(screen.getByLabelText("Note (optional)"), note);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

function cardFor(text: string): HTMLElement {
  const li = screen.getByText(text).closest("li");
  if (!li) throw new Error(`no card for ${text}`);
  return li;
}

describe("Phase 8 journey — Send & Request Money", () => {
  it("34 steps: find & send, request & pay once, decline/cancel, expiry, Spaces, approval, reload, isolation", async () => {
    const user = userEvent.setup();
    window.localStorage.clear();
    // Aarav is connected to Priya, who approves payments over ₹500.
    save(linkedDatabase({ threshold: 500 }));
    const startTotal = everything();

    // 1. Aarav signs in; ₹1,850 available, Meera ₹1,200.
    let view = await signedIn(SEED_TEEN_ID, "teen", "/money");
    expect(aarav()).toBe(1850);
    expect(meera()).toBe(1200);

    // 2. Money shows Send and Request before Spaces.
    const actions = await screen.findByRole("region", { name: "Send and request" });
    expect(within(actions).getByRole("link", { name: "Send" })).toHaveAttribute("href", "/send");
    await go("/send");
    expect(await screen.findByRole("heading", { level: 1, name: "Send money" })).toBeInTheDocument();

    // 3. Search finds Meera — @handle and name only.
    await user.type(await screen.findByRole("searchbox", { name: /who are you sending to/i }), "mee");
    const results = await screen.findByRole("list", { name: "TeenPay users" });
    expect(results).toHaveTextContent("Meera Kapoor");
    expect(results).toHaveTextContent("@meera");
    expect(results.textContent).not.toMatch(/usr_|wal_|fam_/);

    // 4. Pick her; enter ₹100.
    await user.click(within(results).getByRole("button", { name: /Meera Kapoor/ }));
    await amountThenContinue(user, "100");

    // 5. Review: "Send ₹100 / To @meera / From your available balance".
    expect(await screen.findByRole("heading", { name: "Send ₹100" })).toBeInTheDocument();
    expect(screen.getByText("@meera")).toBeInTheDocument();
    expect(screen.getByText("From your available balance")).toBeInTheDocument();
    expect(transfers()).toHaveLength(0);

    // 6. Confirm → "Money sent" with the reference.
    await user.click(screen.getByRole("button", { name: "Send ₹100" }));
    expect(await screen.findByRole("heading", { name: "Money sent" })).toBeInTheDocument();
    const sentRef = (await screen.findByText(/^TRF-/)).textContent!;

    // 7. Balances move; money is conserved.
    expect(aarav()).toBe(1750);
    expect(meera()).toBe(1300);
    expect(everything()).toBe(startTotal);

    // 8. Exactly one transfer, two legs, one reference.
    expect(transfers()).toHaveLength(1);
    const sendOp = transfers()[0]!;
    expect(sendOp.reference).toBe(sentRef);
    expect(db().ledger.filter((e) => e.operationId === sendOp.id).map((e) => e.reference)).toEqual([sentRef, sentRef]);

    // 9. Repeating the same send (retry / stale screen) creates nothing.
    const replay = sendMoneyTransition(db(), {
      actorId: SEED_TEEN_ID, at: new Date().toISOString(), recipient: "@meera", amount: 100, idempotencyKey: sendOp.id,
    });
    expect(replay.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(replay.db).toEqual(db());

    // 10. Notices, once each.
    expect(noticesFor(SEED_TEEN_ID, "₹100 sent to @meera.")).toHaveLength(1);
    expect(noticesFor(SEED_PEER_ID, "You received ₹100.")).toHaveLength(1);

    // 11. Activity: "Money sent", detail with party and reference — no ids.
    await go("/activity");
    const sentRow = (await screen.findAllByRole("button", { name: /Money sent.*open details/i }))[0]!;
    await user.click(sentRow);
    const detail = await screen.findByRole("dialog");
    expect(within(detail).getByText("@meera · Meera Kapoor")).toBeInTheDocument();
    expect(within(detail).getByText(sentRef)).toBeInTheDocument();
    expect(detail.textContent).not.toMatch(/usr_meera|wal_usr_meera/);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // 12. Aarav requests ₹200 from Meera.
    await go("/request");
    await pick(user, /who are you asking/i, "meera", /Meera Kapoor/);
    await amountThenContinue(user, "200", "Snacks");
    await user.click(await screen.findByRole("button", { name: "Send request" }));
    expect(await screen.findByRole("heading", { name: "Request sent" })).toBeInTheDocument();

    // 13. Pending; no money moved.
    expect(db().peerRequests).toMatchObject([{ amount: 200, note: "Snacks", status: "pending" }]);
    expect(aarav()).toBe(1750);
    expect(transfers()).toHaveLength(1);

    // 14. Sent: "₹200 requested from @meera".
    await go("/requests");
    const sent = await screen.findByRole("region", { name: "Sent" });
    expect(within(sent).getByText("₹200 requested from @meera")).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 15. Meera signs in; Incoming: "₹200 requested by @aarav".
    view = await signedIn(SEED_PEER_ID, "teen", "/requests");
    const incoming = await screen.findByRole("region", { name: "Incoming" });
    expect(within(incoming).getByText("₹200 requested by @aarav")).toBeInTheDocument();

    // 16. Pay → confirm.
    await user.click(within(incoming).getByRole("button", { name: "Pay ₹200" }));
    await user.click(within(incoming).getByRole("button", { name: "Confirm ₹200" }));
    expect(await screen.findByText(/^Paid ₹200 to @aarav · TRF-/)).toBeInTheDocument();

    // 17. Exactly one transaction; request accepted with its reference.
    const requestId = db().peerRequests[0]!.requestId;
    const paidOps = transfers().filter((op) => op.requestId === requestId);
    expect(paidOps).toHaveLength(1);
    expect(db().peerRequests[0]).toMatchObject({ status: "accepted", resultingPaymentReference: paidOps[0]!.reference });
    expect(meera()).toBe(1100);
    expect(aarav()).toBe(1950);

    // 18. A second accept (double click / stale tab) posts nothing.
    const again = acceptMoneyRequestTransition(db(), { actorId: SEED_PEER_ID, at: new Date().toISOString(), requestId });
    expect(again.result).toMatchObject({ ok: true, value: { replayed: true } });
    expect(again.db).toEqual(db());

    // 19. Aarav was told once.
    expect(noticesFor(SEED_TEEN_ID, "₹200 request was paid.")).toHaveLength(1);

    // 20. Meera asks Aarav for ₹50, then ₹60.
    await go("/request");
    await pick(user, /who are you asking/i, "aar", /Aarav Sharma/);
    await amountThenContinue(user, "50");
    await user.click(await screen.findByRole("button", { name: "Send request" }));
    await screen.findByRole("heading", { name: "Request sent" });
    await user.click(screen.getByRole("button", { name: "Done" }));
    await pick(user, /who are you asking/i, "aar", /Aarav Sharma/);
    await amountThenContinue(user, "60");
    await user.click(await screen.findByRole("button", { name: "Send request" }));
    await screen.findByRole("heading", { name: "Request sent" });
    expect(db().peerRequests.filter((r) => r.status === "pending")).toHaveLength(2);

    // 21. She cancels the ₹60 one — no money; Aarav told.
    await go("/requests");
    await screen.findByRole("region", { name: "Sent" });
    await user.click(within(cardFor("₹60 requested from @aarav")).getByRole("button", { name: "Cancel request" }));
    expect(await screen.findByText("Cancelled your ₹60 request. No money moved.")).toBeInTheDocument();
    expect(noticesFor(SEED_TEEN_ID, "Money request cancelled.")).toHaveLength(1);
    expect(transfers()).toHaveLength(2);
    view.unmount();
    cleanup();

    // (A request Meera sent 8 days ago, still stored as pending.)
    const eightDaysAgo = new Date(Date.now() - 8 * 86_400_000).toISOString();
    const old = createMoneyRequestTransition(db(), {
      actorId: SEED_PEER_ID, at: eightDaysAgo, payer: "@aarav", amount: 70, idempotencyKey: "prq_old_request",
    });
    if (!old.result.ok) throw new Error("setup failed");
    save(old.db);

    // 22. Aarav declines the ₹50 — no money; Meera told.
    view = await signedIn(SEED_TEEN_ID, "teen", "/requests");
    await screen.findByRole("region", { name: "Incoming" });
    await user.click(within(cardFor("₹50 requested by @meera")).getByRole("button", { name: "Decline" }));
    expect(await screen.findByText("Declined @meera's ₹50 request. No money moved.")).toBeInTheDocument();
    expect(noticesFor(SEED_PEER_ID, "Money request declined.")).toHaveLength(1);
    expect(aarav()).toBe(1950);

    // 23. The 8-day-old request is Expired in History, with no Pay button.
    const history = screen.getByRole("region", { name: "History" });
    const expiredCard = within(history).getByText("₹70 requested by @meera").closest("li")!;
    expect(within(expiredCard).getByText("Expired")).toBeInTheDocument();
    expect(within(expiredCard).queryByRole("button")).not.toBeInTheDocument();

    // 24. And it can never be paid.
    const late = acceptMoneyRequestTransition(db(), {
      actorId: SEED_TEEN_ID, at: new Date().toISOString(), requestId: requestIdFor("prq_old_request"),
    });
    expect(late.result).toMatchObject({ ok: false });
    expect(transfers()).toHaveLength(2);

    // 25. Aarav puts ₹1,000 into Save → ₹950 available.
    await go("/money");
    await user.click(await screen.findByRole("button", { name: "Add to Save" }));
    const add = await screen.findByRole("dialog", { name: "Add to Save" });
    await user.type(within(add).getByLabelText("Amount"), "1000");
    await user.click(within(add).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(aarav()).toBe(950);
    expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(1800);

    // 26. Sending ₹1,000 is refused: Spaces money isn't available.
    await go("/send");
    await pick(user, /who are you sending to/i, "meera", /Meera Kapoor/);
    await user.type(await screen.findByLabelText("Amount"), "1000");
    expect((await screen.findAllByText("Not enough available money. You have ₹950 available.")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(1800);

    // 27. ₹600 is over Priya's ₹500 threshold → asks her.
    await user.clear(screen.getByLabelText("Amount"));
    await user.type(screen.getByLabelText("Amount"), "600");
    expect(await screen.findByText(/This needs parent approval/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Ask Priya to approve" }));
    expect(await screen.findByRole("heading", { name: "Waiting for approval" })).toBeInTheDocument();

    // 28. Nothing moved; one pending transfer approval.
    expect(aarav()).toBe(950);
    expect(transfers()).toHaveLength(2);
    const approval = scopeFor(db(), SEED_PARENT_ID)!.state.approvals.find((a) => a.kind === "transfer" && a.status === "pending")!;
    expect(approval).toMatchObject({ amount: 600, recipientName: "@meera" });
    view.unmount();
    cleanup();

    // 29. Priya approves from the parent page.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Approve ₹600 to @meera" }));
    await waitFor(() => expect(transfers()).toHaveLength(3));

    // 30. Exactly one transfer after approval, through the same path.
    const approvedOp = transfers().find((op) => op.approvalId === approval.id)!;
    expect(approvedOp).toMatchObject({ amount: 600, type: "transfer" });
    expect(aarav()).toBe(350);
    expect(meera()).toBe(1700);
    // Conserved: both wallets plus the ₹1,000 Aarav keeps in Save.
    expect(aarav() + meera() + 1000).toBe(1850 + 1200);
    expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(1800);

    // 31. Approving again never posts twice.
    const twice = approveTransferTransition(db(), { actorId: SEED_PARENT_ID, at: new Date().toISOString(), approvalId: approval.id });
    expect(twice.db).toEqual(db());
    expect(transfers()).toHaveLength(3);

    // 32. Aarav and Meera were told once.
    expect(noticesFor(SEED_TEEN_ID, "₹600 sent to @meera.")).toHaveLength(1);
    expect(noticesFor(SEED_PEER_ID, "You received ₹600.")).toHaveLength(1);
    view.unmount();
    cleanup();

    // 33. Reload as Aarav: everything persisted, no duplicates.
    const ledgerBefore = db().ledger.length;
    view = await signedIn(SEED_TEEN_ID, "teen", "/activity");
    expect((await screen.findAllByRole("button", { name: /Money request paid.*open details/i })).length).toBe(1);
    expect(db().ledger.length).toBe(ledgerBefore);
    expect(db().peerRequests.map((r) => r.status).sort()).toEqual(["accepted", "cancelled", "declined", "expired"]);
    expect(aarav()).toBe(350);
    expect(meera()).toBe(1700);
    view.unmount();
    cleanup();

    // 34. An unrelated teen sees none of it and can't act on it.
    const made = createAccount(db(), { role: "teen", displayName: "Kabir Rao", username: "kabirrao" }, AT);
    if ("code" in made) throw new Error(made.message);
    save(made.db);
    const kabir = scopeFor(db(), made.account.id)!.state;
    expect(kabir.peerRequests).toEqual([]);
    expect(kabir.ledger.some((e) => e.type === "transfer_in" || e.type === "transfer_out")).toBe(false);
    const forged = acceptMoneyRequestTransition(db(), { actorId: made.account.id, at: new Date().toISOString(), requestId });
    expect(forged.result.ok).toBe(false);
    view = await signedIn(made.account.id, "teen", "/requests");
    expect(await screen.findByText("No one has asked you for money")).toBeInTheDocument();
    expect(screen.queryByText(/@meera|@aarav/)).not.toBeInTheDocument();
    view.unmount();
  }, 90_000);
});
