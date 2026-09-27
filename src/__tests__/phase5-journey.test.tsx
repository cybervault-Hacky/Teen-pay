import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href: string; children?: React.ReactNode; [key: string]: unknown }) =>
      React.createElement("a", props, props.children),
  };
});

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
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

import { AuthProvider, useAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { HomeContent } from "@/components/home/home-content";
import { MoneyContent } from "@/components/money/money-content";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import {
  getBalance,
  listTransactions,
  selectMyNotifications,
  selectTeenWallet,
} from "@/sandbox/selectors";
import {
  SandboxProvider,
  useOptionalSandbox,
  type SandboxContextValue,
} from "@/sandbox/store";
import { setWalletStatusTransition } from "@/sandbox/transitions";
import type { SandboxDatabase } from "@/sandbox/types";
import {
  AT,
  linkedState,
  must,
  preloadDatabase,
  SANDBOX_KEY,
  TEEN,
  TEEN_WALLET,
} from "./helpers/fixtures";

let sb: SandboxContextValue | null = null;
let auth: AuthContextValue | null = null;

function Capture() {
  sb = useOptionalSandbox();
  auth = useAuth();
  return null;
}

const cur = (): SandboxContextValue => {
  if (!sb) throw new Error("not signed in");
  return sb;
};

function run<T>(fn: () => T): T {
  let out: T = undefined as unknown as T;
  act(() => {
    out = fn();
  });
  return out;
}

const stored = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const teenEntries = () => stored().ledger.filter((e) => e.walletId === TEEN_WALLET);
const teenBalanceNow = () => getBalance(cur().state, TEEN_WALLET);

describe("Phase 5 money journey (real providers: auth → store → ledger)", () => {
  it("25 steps: pay, reject, approve once, freeze, reset", async () => {
    // 1. Fresh deterministic seed.
    window.localStorage.clear();
    const service = createSandboxAuthService();
    render(
      <AuthProvider service={service}>
        <SandboxProvider>
          <Capture />
        </SandboxProvider>
      </AuthProvider>,
    );
    await waitFor(() => expect(auth?.status).toBe("signed_out"));

    // 2. The teen signs in.
    await act(async () => {
      await auth!.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" });
    });
    await waitFor(() => expect(sb?.viewer.id).toBe(SEED_TEEN_ID));

    // 3. Their wallet exists and is active.
    const wallet = selectTeenWallet(cur().state);
    expect(wallet).toMatchObject({ id: TEEN_WALLET, ownerAccountId: SEED_TEEN_ID, status: "active" });

    // 4. Balance is derived from the ledger.
    expect(teenBalanceNow()).toBe(1850);
    const seedEntries = teenEntries().length;

    // 5. Pay ₹200.
    const paid = run(() => cur().actions.pay({ idempotencyId: "j_pay_1", recipientId: "rec_riya", amount: 200 }));
    expect(paid).toEqual({ ok: true, value: { status: "completed", entryId: "j_pay_1" } });

    // 6. Exactly one ledger entry for it (persisted).
    expect(stored().ledger.filter((e) => e.operationId === "j_pay_1")).toHaveLength(1);
    expect(teenEntries()).toHaveLength(seedEntries + 1);

    // 7. Balance went down.
    expect(teenBalanceNow()).toBe(1650);

    // 8. Activity (central query) leads with it, with a reference.
    const first = listTransactions(cur().state, TEEN_WALLET)[0];
    expect(first).toMatchObject({ id: "j_pay_1", title: "Payment to Riya Patel", amount: -200 });

    // 9. A notification, derived from the payment event.
    expect(selectMyNotifications(cur().state)[0]).toMatchObject({ title: "Payment sent" });

    // 10. Oversized payments are rejected (above balance, above cap).
    const ledgerBefore = JSON.stringify(stored().ledger);
    const tooBig = run(() => cur().actions.pay({ idempotencyId: "j_big", recipientId: "rec_riya", amount: 5000 }));
    expect(tooBig).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
    const overCap = run(() => cur().actions.pay({ idempotencyId: "j_cap", recipientId: "rec_riya", amount: 10_001 }));
    expect(overCap).toMatchObject({ ok: false, error: { code: "exceeds_sandbox_limit" } });

    // 11. The ledger is unchanged.
    expect(JSON.stringify(stored().ledger)).toBe(ledgerBefore);

    // (setup) Connect the family and ask for approval above ₹500.
    const invite = run(() => cur().actions.createFamilyInvite());
    if (!invite.ok) throw new Error("invite failed");
    run(() => auth!.switchAccount({ method: "sandbox", accountId: SEED_PARENT_ID, role: "parent" }));
    await waitFor(() => expect(sb?.viewer.id).toBe(SEED_PARENT_ID));
    expect(run(() => cur().actions.claimFamilyInvite(invite.value.code)).ok).toBe(true);
    expect(run(() => cur().actions.acceptFamilyInvite(SEED_TEEN_ID)).ok).toBe(true);
    expect(
      run(() =>
        cur().actions.updateSpendingRules({
          teenId: SEED_TEEN_ID,
          limits: { dailyLimit: null, perTransactionLimit: null },
          approval: { threshold: 500 },
        }),
      ).ok,
    ).toBe(true);
    run(() => auth!.switchAccount({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }));
    await waitFor(() => expect(sb?.viewer.id).toBe(SEED_TEEN_ID));

    // 12. A ₹600 payment needs approval.
    const asked = run(() => cur().actions.pay({ idempotencyId: "j_pay_2", recipientId: "rec_kabir", amount: 600 }));
    expect(asked).toMatchObject({ ok: true, value: { status: "approval_requested" } });
    const approvalId = asked.ok && asked.value.status === "approval_requested" ? asked.value.approvalId : "";

    // 13. Pending isn't money: balance and ledger unchanged.
    expect(teenBalanceNow()).toBe(1650);
    expect(stored().ledger.some((e) => e.operationId === "j_pay_2")).toBe(false);

    // 14. The parent signs in.
    run(() => auth!.switchAccount({ method: "sandbox", accountId: SEED_PARENT_ID, role: "parent" }));
    await waitFor(() => expect(sb?.viewer.id).toBe(SEED_PARENT_ID));

    // 15. Approves.
    const approved = run(() => cur().actions.decideApproval(approvalId, "approve"));
    expect(approved).toEqual({ ok: true, value: { status: "approved" } });

    // 16. Executes twice (double click / stale screen).
    const again = run(() => cur().actions.decideApproval(approvalId, "approve"));
    expect(again).toEqual({ ok: true, value: { status: "approved" } });

    // 17. Exactly one execution.
    expect(stored().ledger.filter((e) => e.operationId === "j_pay_2")).toHaveLength(1);
    expect(stored().operations.filter((op) => op.id === "j_pay_2")).toHaveLength(1);

    // 18. Final balance, same from the parent's view.
    expect(teenBalanceNow()).toBe(1050);

    // 19. Activity shows it, linked to the approval.
    run(() => auth!.switchAccount({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }));
    await waitFor(() => expect(sb?.viewer.id).toBe(SEED_TEEN_ID));
    expect(teenBalanceNow()).toBe(1050);
    expect(listTransactions(cur().state, TEEN_WALLET)[0]).toMatchObject({
      id: "j_pay_2",
      title: "Payment to Kabir Mehta",
    });
    expect(stored().ledger.find((e) => e.id === "j_pay_2")?.approvalId).toBe(approvalId);

    // 20. The teen is notified once.
    expect(selectMyNotifications(cur().state).filter((n) => n.title === "Payment approved")).toHaveLength(1);

    // 21. The teen freezes their wallet.
    expect(run(() => cur().actions.setWalletFrozen(TEEN_WALLET, true))).toMatchObject({
      ok: true,
      value: { status: "frozen" },
    });

    // 22. …and tries to pay.
    const frozenLedger = JSON.stringify(stored().ledger);
    const blocked = run(() => cur().actions.pay({ idempotencyId: "j_pay_3", recipientId: "rec_riya", amount: 50 }));

    // 23. Rejected, with no mutation; the balance is still visible.
    expect(blocked).toMatchObject({ ok: false, error: { code: "wallet_frozen" } });
    expect(JSON.stringify(stored().ledger)).toBe(frozenLedger);
    expect(teenBalanceNow()).toBe(1050);

    // 24. Unfreeze, then reset the sandbox.
    expect(run(() => cur().actions.setWalletFrozen(TEEN_WALLET, false)).ok).toBe(true);
    expect(selectTeenWallet(cur().state)?.status).toBe("active");
    run(() => cur().actions.resetSandbox());

    // 25. Deterministic: financial records equal a fresh seed.
    await waitFor(() => expect(stored().ledger).toEqual(buildSeedDatabase().ledger));
    const seed = buildSeedDatabase();
    expect(stored().wallets).toEqual(seed.wallets);
    expect(stored().operations).toEqual(seed.operations);
    expect(stored().teenRecords).toEqual(seed.teenRecords);
  }, 30_000);
});

// ── Screens agree, and the wallet UI is safe to double-click ─────

function renderTeen(ui: React.ReactNode, db?: Parameters<typeof preloadDatabase>[0]) {
  window.localStorage.clear();
  if (db) preloadDatabase(db);
  return render(<SandboxProvider viewerId={SEED_TEEN_ID}>{ui}</SandboxProvider>);
}

describe("Phase 5 screens", () => {
  it("Home, Money and Activity all show the same derived balance", () => {
    renderTeen(
      <>
        <section data-testid="home">
          <HomeContent />
        </section>
        <section data-testid="money">
          <MoneyContent />
        </section>
        <section data-testid="activity">
          <ActivityFeed />
        </section>
      </>,
    );
    expect(within(screen.getByTestId("home")).getAllByText("₹1,850").length).toBeGreaterThan(0);
    expect(within(screen.getByTestId("money")).getAllByText("₹1,850").length).toBeGreaterThan(0);
    // Activity rows come from the same ledger (the seed ₹350 payment).
    expect(within(screen.getByTestId("activity")).getByText("Payment to Ananya Iyer")).toBeInTheDocument();
  });

  it("freezing from Money: status in words, double-click safe, announced, and Home shows a banner", async () => {
    const user = userEvent.setup();
    renderTeen(
      <>
        <MoneyContent />
        <HomeContent />
      </>,
      linkedState(),
    );
    expect(screen.getByText("Active")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Freeze wallet" }));
    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "Freeze" });
    await user.dblClick(confirm);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    expect(screen.getByText("Frozen")).toBeInTheDocument();
    expect(screen.getByRole("note", { name: "Wallet frozen" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unfreeze wallet" })).toBeInTheDocument();
    // One freeze, one guardian notification.
    const db = stored();
    expect(db.wallets.find((w) => w.id === TEEN_WALLET)?.status).toBe("frozen");
    expect(db.notifications.filter((n) => n.title === "Wallet frozen")).toHaveLength(1);
  });

  it("a guardian's freeze tells the teen who can lift it (no unfreeze button)", () => {
    const frozen = must(
      setWalletStatusTransition(linkedState(), {
        actorId: SEED_PARENT_ID,
        at: AT,
        walletId: TEEN_WALLET,
        status: "frozen",
      }),
    );
    renderTeen(<MoneyContent />, frozen);
    expect(screen.getByText(/only priya can unfreeze it/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Unfreeze wallet" })).not.toBeInTheDocument();
  });

  it("the balance change is announced to screen readers (not on first render)", async () => {
    const user = userEvent.setup();
    renderTeen(<MoneyContent />);
    const live = () =>
      screen.getAllByRole("status").map((el) => el.textContent ?? "").join(" ");
    expect(live()).not.toMatch(/is now/);
    await user.click(screen.getByRole("button", { name: "Add to Save" }));
    await user.type(await screen.findByLabelText("Amount"), "100");
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(live()).toMatch(/Available balance is now ₹1,750, down ₹100/));
  });

  it("transaction detail shows the reference and a one-time sandbox refund", async () => {
    const user = userEvent.setup();
    renderTeen(<ActivityFeed />);
    await user.click(screen.getByRole("button", { name: /Payment to Ananya Iyer/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/^PAY-[0-9A-Z]{8}$/)).toBeInTheDocument();
    expect(within(dialog).getByText("Completed")).toBeInTheDocument();

    const refund = within(dialog).getByRole("button", { name: /simulate refund/i });
    await user.dblClick(refund);
    expect(await within(dialog).findByText(/Refund recorded · REF-/)).toBeInTheDocument();
    const refunds = stored().ledger.filter((e) => e.type === "refund" && e.relatedEntryId === "seed_pay_1");
    expect(refunds).toHaveLength(1);
    // Status badge and the linked refund row both say so, in words.
    expect(within(dialog).getAllByText("Refunded")).toHaveLength(2);
    expect(within(dialog).queryByRole("button", { name: /simulate refund/i })).not.toBeInTheDocument();
  });

  it("the pay flow explains a frozen wallet up front", async () => {
    const { PayFlow } = await import("@/components/pay/pay-flow");
    const frozen = must(
      setWalletStatusTransition(linkedState(), { ...TEEN, walletId: TEEN_WALLET, status: "frozen" }),
    );
    renderTeen(<PayFlow mode="send" />, frozen);
    expect(screen.getByRole("note", { name: "Wallet frozen" })).toBeInTheDocument();
  });
});
