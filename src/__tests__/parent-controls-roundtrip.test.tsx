import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { walletBalance } from "@/sandbox/engine";
import { approveTransferTransition } from "@/sandbox/peer-transitions";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, linkedDatabase, preloadDatabase, SANDBOX_KEY, TEEN_WALLET } from "./helpers/fixtures";
import { resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

const MEERA_WALLET = "wal_usr_meera";
const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);
const transfers = () => db().operations.filter((op) => op.type === "transfer");

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

async function pickMeera(user: ReturnType<typeof userEvent.setup>) {
  await user.type(await screen.findByRole("searchbox", { name: /who are you sending to/i }), "mee");
  const list = await screen.findByRole("list", { name: "TeenPay users" });
  await user.click(within(list).getByRole("button", { name: /Meera Kapoor/ }));
}

async function amountThenContinue(user: ReturnType<typeof userEvent.setup>, amount: string) {
  await user.type(await screen.findByLabelText("Amount"), amount);
  await user.click(screen.getByRole("button", { name: "Continue" }));
}

/**
 * Every control in the Parent Control Center round-trips through the
 * existing engine: the rule set in the UI is the rule the payment
 * engine enforces, and every decision posts through the same ledger.
 */
describe("parent controls round-trip", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.removeItem(SANDBOX_KEY);
  });

  it("an approval threshold set in the center routes the next big payment to approval, and approving posts exactly once", async () => {
    const user = userEvent.setup();
    preloadDatabase(linkedDatabase());

    // 1. Priya turns on "Ask me first" above ₹500 — in the center.
    let view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(screen.getByRole("button", { name: /edit rules/i }));
    const dialog = screen.getByRole("dialog", { name: "Spending rules" });
    await user.click(within(dialog).getByRole("switch", { name: "Ask me first" }));
    const approvalAmount = within(dialog).getByLabelText("Approval amount");
    await user.clear(approvalAmount);
    await user.type(approvalAmount, "500");
    await user.click(within(dialog).getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("You approve payments above ₹500")).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 2. Aarav sends ₹600 — the engine routes it to approval.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await amountThenContinue(user, "600");
    expect(await screen.findByText(/this needs parent approval/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Ask Priya to approve" }));
    const before = aarav();
    view.unmount();
    cleanup();

    // 3. Priya's center shows the pending decision; approving posts once.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(await screen.findByRole("button", { name: "Approve ₹600 to @meera" }));
    await waitFor(() => expect(transfers()).toHaveLength(1));
    expect(aarav()).toBe(before - 600);
    expect(meera()).toBe(1200 + 600);
    // The center settles back to "nothing waiting".
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 4. Replaying the same approval never posts twice.
    const approval = db().teenRecords.find((r) => r.teenId === SEED_TEEN_ID)!.approvals[0]!;
    const replay = approveTransferTransition(db(), {
      actorId: SEED_PARENT_ID,
      at: AT,
      approvalId: approval.id,
    });
    expect(replay.db).toEqual(db());
    expect(transfers()).toHaveLength(1);
  }, 120_000);

  it("a daily limit set in the center blocks the teen's overspend and keeps the money put", async () => {
    const user = userEvent.setup();
    preloadDatabase(linkedDatabase());

    // 1. Priya sets a ₹500 daily limit.
    let view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(screen.getByRole("button", { name: /edit rules/i }));
    const dialog = screen.getByRole("dialog", { name: "Spending rules" });
    await user.click(within(dialog).getByRole("switch", { name: "Daily limit" }));
    const dailyAmount = within(dialog).getByLabelText("Daily limit amount");
    await user.clear(dailyAmount);
    await user.type(dailyAmount, "500");
    await user.click(within(dialog).getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByText("₹500 a day")).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 2. ₹200 goes through; a further ₹400 would exceed ₹500 today.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await amountThenContinue(user, "200");
    await user.click(await screen.findByRole("button", { name: "Send ₹200" }));
    await screen.findByRole("heading", { name: "Money sent" });
    const afterFirst = aarav();

    view.unmount();
    cleanup();
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await amountThenContinue(user, "400");
    expect(
      await screen.findByText(/this payment would exceed today's spending limit/i),
    ).toBeInTheDocument();
    // Nothing moved: the engine refused before any ledger write.
    expect(transfers()).toHaveLength(1);
    expect(aarav()).toBe(afterFirst);
  }, 120_000);

  it("freezing the account in the center pauses the teen's money, and unfreezing restores it", async () => {
    const user = userEvent.setup();
    preloadDatabase(linkedDatabase());

    // 1. Priya freezes Aarav's wallet from Account protection.
    let view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    const controlsSection = screen.getByRole("region", { name: "Controls" });
    await user.click(within(controlsSection).getByRole("button", { name: "Freeze wallet" }));
    await user.click(await screen.findByRole("button", { name: "Freeze" }));
    // The account protection card shows the freeze, with the button flipped.
    await waitFor(() =>
      expect(within(controlsSection).getByText(/frozen by you/i)).toBeInTheDocument(),
    );
    expect(within(controlsSection).getByRole("button", { name: "Unfreeze wallet" })).toBeInTheDocument();
    // The pocket money section explains the pause too.
    expect(await screen.findByText(/Aarav's wallet is frozen/i)).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 2. Aarav can't send while frozen — the flow says so up front.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    expect(await screen.findByRole("note", { name: "Wallet frozen" })).toBeInTheDocument();
    expect(await screen.findByText(/your wallet is frozen by priya/i)).toBeInTheDocument();
    await pickMeera(user);
    await amountThenContinue(user, "100");
    expect(transfers()).toHaveLength(0);
    const held = aarav();
    view.unmount();
    cleanup();

    // 3. Priya unfreezes; the same payment goes through.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(screen.getByRole("button", { name: "Unfreeze wallet" }));
    await user.click(await screen.findByRole("button", { name: "Unfreeze" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Freeze wallet" })).toBeInTheDocument(),
    );
    view.unmount();
    cleanup();

    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await amountThenContinue(user, "100");
    await user.click(await screen.findByRole("button", { name: "Send ₹100" }));
    await screen.findByRole("heading", { name: "Money sent" });
    expect(transfers()).toHaveLength(1);
    expect(aarav()).toBe(held - 100);
    expect(meera()).toBe(1200 + 100);
    void SEED_PEER_ID;
  }, 120_000);
});
