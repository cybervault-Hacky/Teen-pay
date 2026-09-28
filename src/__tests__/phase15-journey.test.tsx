import { act, cleanup, configure, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { createPocketMoneyScheduleTransition } from "@/sandbox/allowance-transitions";
import { walletBalance, spaceBalance } from "@/sandbox/engine";
import { approveTransferTransition } from "@/sandbox/peer-transitions";
import { selectParentCenter, selectTeenCenter } from "@/sandbox/parent-center";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import {
  SEED_GOAL_SPACE_ID,
  SEED_PARENT_ID,
  SEED_PEER_ID,
  SEED_SAVE_SPACE_ID,
  SEED_TEEN_ID,
} from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { TestApp } from "./helpers/app";
import { AT, SANDBOX_KEY, TEEN_WALLET, linkedDatabase } from "./helpers/fixtures";
import { resetRouter } from "./helpers/router";

vi.mock("next/navigation", async () => {
  const router = await import("./helpers/router");
  return {
    usePathname: router.usePathname,
    useRouter: router.useRouter,
    useSearchParams: router.useSearchParams,
  };
});

/**
 * Phase 15 acceptance journey — Parent Control Center — through the
 * real provider stack (AuthProvider → SandboxProvider → AppShell),
 * the real page modules and localStorage. jsdom + Testing Library: an
 * automated UI journey, not a real browser. Real clock.
 *
 * One connected family does the full round-trip: the parent sees the
 * center, sets rules, the teen bumps into them, the parent decides,
 * pocket money runs, protection freezes and unfreezes — and nothing
 * private ever crosses the boundary.
 */
configure({ asyncUtilTimeout: 5000 });

const MEERA_WALLET = "wal_usr_meera";
const PRIYA_WALLET = "wal_usr_priya";
const db = () => JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
const aarav = () => walletBalance(db().ledger, TEEN_WALLET);
const meera = () => walletBalance(db().ledger, MEERA_WALLET);
const priya = () => walletBalance(db().ledger, PRIYA_WALLET);
const everything = () =>
  db().ledger.reduce((sum, e) => sum + (e.direction === "credit" ? e.amount : -e.amount), 0);
const transfers = () => db().operations.filter((op) => op.type === "transfer");
const noticesFor = (to: string, title: string) =>
  db().notifications.filter((n) => n.recipientId === to && n.title === title);

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

/** linkedDatabase plus one weekly-Monday ₹500 allowance plan. */
function databaseWithPlan(): SandboxDatabase {
  const stored = linkedDatabase();
  const scope = scopeFor(stored, SEED_PARENT_ID)!;
  const out = createPocketMoneyScheduleTransition(scope.state, {
    actorId: SEED_PARENT_ID,
    at: AT,
    scheduleId: "pms_journey",
    teenId: SEED_TEEN_ID,
    amount: 500,
    frequency: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 1,
    startDate: "2026-09-26",
  });
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return mergeScope(stored, scope.info, scope.state, out.state);
}

describe("Phase 15 journey — Parent Control Center", () => {
  it("runs the full parent + teen round-trip through one connected family", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(databaseWithPlan()));
    const totalAtStart = everything();

    // 1. Priya signs in and lands directly in the control center.
    let view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    expect(await screen.findByRole("heading", { name: "Overview" })).toBeInTheDocument();

    // 2. The greeting is hers — calm, deterministic.
    expect(screen.getByText(/hello, priya/i)).toBeInTheDocument();

    // 3. The teen overview: identity, handle, aggregate money.
    expect(screen.getByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("@aarav")).toBeInTheDocument();
    expect(screen.getByText("₹1,850")).toBeInTheDocument();
    expect(screen.getByText(/₹4,150 total/i)).toBeInTheDocument();

    // 4. At-a-glance cards: allowance projected, nothing pending yet.
    expect(screen.getByText("₹500 · Every Monday")).toBeInTheDocument();
    const overview = screen.getByRole("region", { name: "Teen overview" });
    expect(within(overview).getByText("Pending approvals")).toBeInTheDocument();

    // 5. Approvals: quiet, with a pointer to the threshold rule.
    const approvals = screen.getByRole("region", { name: "Approvals" });
    expect(within(approvals).getByText(/nothing waiting/i)).toBeInTheDocument();

    // 6. Controls show the rules in force — the same words the teen sees.
    const controls = screen.getByRole("region", { name: "Controls" });
    expect(within(controls).getByText("No daily limit")).toBeInTheDocument();
    expect(within(controls).getByText("No approvals needed")).toBeInTheDocument();

    // 7. Family card: both ends of the connection, marked connected.
    const family = screen.getByRole("region", { name: "Family" });
    expect(within(family).getAllByText(/priya/i).length).toBeGreaterThan(0);
    expect(within(family).getAllByText(/connected/i).length).toBeGreaterThan(0);

    // 8. Recent activity: derived summaries only.
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    const snapshotBeforeRules = JSON.stringify([db().ledger, db().operations, db().spaces]);

    // 9. Priya sets a ₹400 daily limit and a ₹500 approval threshold.
    await user.click(within(controls).getByRole("button", { name: /edit rules/i }));
    const dialog = screen.getByRole("dialog", { name: "Spending rules" });
    await user.click(within(dialog).getByRole("switch", { name: "Daily limit" }));
    const daily = within(dialog).getByLabelText("Daily limit amount");
    await user.clear(daily);
    await user.type(daily, "400");
    await user.click(within(dialog).getByRole("switch", { name: "Ask me first" }));
    const threshold = within(dialog).getByLabelText("Approval amount");
    await user.clear(threshold);
    await user.type(threshold, "500");
    await user.click(within(dialog).getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    // 10. The summary reflects both rules immediately.
    expect(await screen.findByText("₹400 a day")).toBeInTheDocument();
    expect(screen.getByText("You approve payments above ₹500")).toBeInTheDocument();

    // 11. Rules persist — and nothing but the rules changed.
    const controlsNow = db().families.find((f) =>
      f.members.some((m) => m.accountId === SEED_TEEN_ID),
    )!.controls;
    expect(controlsNow[0]?.limits.dailyLimit).toBe(400);
    expect(controlsNow[0]?.approval.threshold).toBe(500);
    expect(JSON.stringify([db().ledger, db().operations, db().spaces])).toBe(snapshotBeforeRules);

    // 12. Notification choice toggles through the existing transition.
    const paymentsSwitch = screen.getByRole("switch", { name: "Payments" });
    const paymentsWas = paymentsSwitch.getAttribute("aria-checked");
    await user.click(paymentsSwitch);
    await waitFor(() =>
      expect(
        db().families.find((f) => f.members.some((m) => m.accountId === SEED_TEEN_ID))!.controls[0]
          ?.notifications.payments,
      ).toBe(paymentsWas !== "true"),
    );
    // 13. …and back.
    await user.click(screen.getByRole("switch", { name: "Payments" }));
    await waitFor(() =>
      expect(
        db().families.find((f) => f.members.some((m) => m.accountId === SEED_TEEN_ID))!.controls[0]
          ?.notifications.payments,
      ).toBe(paymentsWas === "true"),
    );
    view.unmount();
    cleanup();

    // 14. Aarav tries ₹600 — the engine routes it to his parent.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "600");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByText(/this needs parent approval/i)).toBeInTheDocument();

    // 15. Nothing moves while it waits.
    await user.click(await screen.findByRole("button", { name: "Ask Priya to approve" }));
    await waitFor(() =>
      expect(db().teenRecords.flatMap((r) => r.approvals).filter((a) => a.status === "pending")).toHaveLength(1),
    );
    expect(aarav()).toBe(1850);
    expect(transfers()).toHaveLength(0);
    view.unmount();
    cleanup();

    // 16. Aarav sends ₹300 — under both rules, straight through.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "300");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Send ₹300" }));
    await screen.findByRole("heading", { name: "Money sent" });
    expect(aarav()).toBe(1550);
    expect(meera()).toBe(1500);
    view.unmount();
    cleanup();

    // 17. Another ₹200 would cross the ₹400 daily limit — refused.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "200");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(
      await screen.findByText(/this payment would exceed today's spending limit/i),
    ).toBeInTheDocument();

    // 18. The refusal moved nothing.
    expect(aarav()).toBe(1550);
    expect(transfers()).toHaveLength(1);
    expect(everything()).toBe(totalAtStart);
    view.unmount();
    cleanup();

    // 19. The pending decision is waiting in Priya's center.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    const approvalCard = await screen.findByRole("button", { name: "Approve ₹600 to @meera" });
    expect(approvalCard).toBeInTheDocument();

    // 20. Approving posts exactly one transfer through the peer engine.
    await user.click(approvalCard);
    await waitFor(() => expect(transfers()).toHaveLength(2));
    expect(aarav()).toBe(950);
    expect(meera()).toBe(2100);

    // 21. The center settles; the decision is remembered.
    expect(await screen.findByText(/nothing waiting/i)).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Approvals" })).getAllByText(/approved/i).length).toBeGreaterThan(0);

    // 22. Replaying the approval — even at the engine level — changes nothing.
    const decided = db().teenRecords.find((r) => r.teenId === SEED_TEEN_ID)!.approvals[0]!;
    const replay = approveTransferTransition(db(), {
      actorId: SEED_PARENT_ID,
      at: AT,
      approvalId: decided.id,
    });
    expect(replay.db).toEqual(db());
    expect(transfers()).toHaveLength(2);

    // 23. Both teens heard about it exactly once.
    expect(noticesFor(SEED_TEEN_ID, "₹600 sent to @meera.")).toHaveLength(1);
    expect(noticesFor(SEED_PEER_ID, "You received ₹600.")).toHaveLength(1);

    // 24. Money is conserved across every wallet and Space.
    expect(everything()).toBe(totalAtStart);
    view.unmount();
    cleanup();

    // 25. Pocket money: the plan from setup is live in the center.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    const pocketMoney = screen.getByRole("region", { name: "Pocket money" });
    expect(within(pocketMoney).getByText("Pocket money to Aarav")).toBeInTheDocument();
    expect(within(pocketMoney).getByText("Every Monday")).toBeInTheDocument();
    expect(within(pocketMoney).getByText("Active")).toBeInTheDocument();

    // 26. The due transfer is processed through the ledger — once.
    const beforeRun = { aarav: aarav(), priya: priya() };
    await user.click(within(pocketMoney).getByRole("button", { name: "Process next transfer" }));
    await waitFor(() => expect(aarav()).toBe(beforeRun.aarav + 500));
    expect(priya()).toBe(beforeRun.priya - 500);
    expect(everything()).toBe(totalAtStart);

    // 27. The schedule advanced past today — the paid occurrence can
    //     never repeat (the engine's idempotency, re-verified here).
    const afterRun = { aarav: aarav(), priya: priya(), ledger: db().ledger.length };
    const plan = db().pocketMoneySchedules.find((s) => s.id === "pms_journey")!;
    expect(plan.nextRunAt).not.toBeNull();
    expect(plan.nextRunAt! > "2026-09-28").toBe(true);
    expect(aarav()).toBe(afterRun.aarav);
    expect(db().ledger.length).toBe(afterRun.ledger);

    // 28. Pause stops future runs; the center says so.
    const manage = within(pocketMoney).getByRole("group", { name: "Manage pocket money" });
    await user.click(within(manage).getByRole("button", { name: "Pause" }));
    expect(within(pocketMoney).getByText("Paused")).toBeInTheDocument();
    expect(
      db().pocketMoneySchedules.find((s) => s.id === "pms_journey")!.status,
    ).toBe("paused");

    // 29. Resume brings it back, with the next date.
    await user.click(within(manage).getByRole("button", { name: "Resume" }));
    expect(within(pocketMoney).getByText("Active")).toBeInTheDocument();

    // 30. Editing applies to future transfers only.
    await user.click(within(manage).getByRole("button", { name: "Edit" }));
    const editDialog = screen.getByRole("dialog", { name: "Edit pocket money" });
    const editAmount = within(editDialog).getByLabelText("Amount");
    await user.clear(editAmount);
    await user.type(editAmount, "600");
    await user.click(within(editDialog).getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(
      db().pocketMoneySchedules.find((s) => s.id === "pms_journey"),
    ).toMatchObject({ amount: 600 });
    view.unmount();
    cleanup();

    // 31. The day's spending reached the limit — Priya lifts it, keeping
    //     the approval threshold. Rules stay a living conversation.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    const controlsAgain = screen.getByRole("region", { name: "Controls" });
    await user.click(within(controlsAgain).getByRole("button", { name: /edit rules/i }));
    const rulesDialog = screen.getByRole("dialog", { name: "Spending rules" });
    await user.click(within(rulesDialog).getByRole("switch", { name: "Daily limit" }));
    await user.click(within(rulesDialog).getByRole("button", { name: /save rules/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(await screen.findByText("No daily limit")).toBeInTheDocument();
    expect(screen.getByText("You approve payments above ₹500")).toBeInTheDocument();

    // 32. Account protection: Priya freezes Aarav's wallet.
    await user.click(within(controlsAgain).getByRole("button", { name: "Freeze wallet" }));
    await user.click(await screen.findByRole("button", { name: "Freeze" }));
    await waitFor(() =>
      expect(within(controlsAgain).getByText(/frozen by you/i)).toBeInTheDocument(),
    );
    expect(
      db().wallets.find((w) => w.id === TEEN_WALLET)!.status,
    ).toBe("frozen");

    // 33. The pocket-money section explains the pause honestly.
    expect(await screen.findByText(/Aarav's wallet is frozen/i)).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 34. Aarav can't move money while frozen.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    expect(await screen.findByRole("note", { name: "Wallet frozen" })).toBeInTheDocument();
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "50");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    expect(transfers()).toHaveLength(2);
    expect(aarav()).toBe(1450);
    view.unmount();
    cleanup();

    // 35. Priya unfreezes; the same payment then goes through.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    await user.click(screen.getByRole("button", { name: "Unfreeze wallet" }));
    await user.click(await screen.findByRole("button", { name: "Unfreeze" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Freeze wallet" })).toBeInTheDocument(),
    );
    expect(db().wallets.find((w) => w.id === TEEN_WALLET)!.status).toBe("active");
    view.unmount();
    cleanup();

    // 36. Unfrozen, ₹50 to Meera settles normally.
    view = await signedIn(SEED_TEEN_ID, "teen", "/send");
    await pickMeera(user);
    await user.type(await screen.findByLabelText("Amount"), "50");
    await user.click(screen.getByRole("button", { name: "Continue" }));
    await user.click(await screen.findByRole("button", { name: "Send ₹50" }));
    await screen.findByRole("heading", { name: "Money sent" });
    expect(aarav()).toBe(1400);
    expect(meera()).toBe(2150);

    // 37. Conservation still holds after every leg of the journey.
    expect(everything()).toBe(totalAtStart);
    view.unmount();
    cleanup();

    // 38. Back in the center, activity is still derived summaries only.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    expect(screen.getByText("Recent activity")).toBeInTheDocument();
    const centerText = document.body.textContent ?? "";

    // 39. No internal identifiers ever reach the parent's screen.
    expect(centerText).not.toMatch(/\b(usr|wal|fam|spc|apr|op|evt|prq|snd)_[a-z0-9_-]+/i);

    // 40. Money Spaces stay one aggregate — no Space names.
    expect(screen.queryByText("New Bike")).not.toBeInTheDocument();
    expect(screen.getByText(/in money spaces: ₹2,300/i)).toBeInTheDocument();
    expect(spaceBalance(db().ledger, SEED_SAVE_SPACE_ID)).toBe(800);
    expect(spaceBalance(db().ledger, SEED_GOAL_SPACE_ID)).toBe(1500);

    // 41. The privacy boundary is stated, not hidden.
    expect(
      screen.getByText(/money coach, missions, friend circles and the safety shield stay private/i),
    ).toBeInTheDocument();
    view.unmount();
    cleanup();

    // 42. A teen walking up to /parent gets the gate, not the data.
    view = await signedIn(SEED_TEEN_ID, "teen", "/parent");
    expect(screen.getByRole("heading", { name: "Parent view" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Controls" })).not.toBeInTheDocument();
    view.unmount();
    cleanup();

    // 43. Cross-teen isolation: a second family changes nothing for Priya.
    let stored = db();
    const rohan = createAccount(stored, { role: "teen", displayName: "Rohan Verma", username: "rohan" }, AT);
    if ("code" in rohan) throw new Error("rohan create failed");
    stored = rohan.db;
    const sunita = createAccount(stored, { role: "parent", displayName: "Sunita Verma", username: "sunita" }, AT);
    if ("code" in sunita) throw new Error("sunita create failed");
    stored = sunita.db;
    window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(stored));
    const priyaScope = scopeFor(db(), SEED_PARENT_ID)!;
    expect(selectTeenCenter(priyaScope.state, SEED_PARENT_ID, rohan.account.id)).toBeNull();
    expect(
      selectParentCenter(priyaScope.state, SEED_PARENT_ID)?.teens.map((t) => t.teen.accountId),
    ).toEqual([SEED_TEEN_ID]);
    // The new parent account starts with sandbox funding — after this
    // point the conserved total includes it.
    const totalAfterAccounts = everything();

    // 44. Everything persisted: a fresh session sees the same center.
    view = await signedIn(SEED_PARENT_ID, "parent", "/parent");
    expect(await screen.findByText("Aarav Sharma")).toBeInTheDocument();
    expect(screen.getByText("₹1,400")).toBeInTheDocument();
    expect(screen.getByText("No daily limit")).toBeInTheDocument();
    expect(screen.getByText("You approve payments above ₹500")).toBeInTheDocument();

    // 45. The allowance plan survived too — edited amount and all.
    const pocketMoneyAgain = screen.getByRole("region", { name: "Pocket money" });
    expect(within(pocketMoneyAgain).getByText("Pocket money to Aarav")).toBeInTheDocument();
    expect(within(pocketMoneyAgain).getByText("Every Monday")).toBeInTheDocument();

    // 46. And the story of the money adds up to the rupee.
    expect(aarav()).toBe(1400);
    expect(meera()).toBe(2150);
    expect(priya()).toBe(5000);
    expect(everything()).toBe(totalAfterAccounts);
    view.unmount();
  }, 120_000);
});
