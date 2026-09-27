import { act, cleanup, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { teenBalance, teenLedger } from "./helpers/fixtures";
import { buildSeedState } from "@/sandbox/seed";
import {
  selectMyNotifications,
  selectSession,
  selectSpendingStatus,
  selectTeen,
} from "@/sandbox/selectors";
import {
  SandboxProvider,
  useSandbox,
  type SandboxContextValue,
} from "@/sandbox/store";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

/**
 * The Phase 3 acceptance journey, end to end through the real
 * provider, actions, and localStorage persistence:
 *
 * teen invites → parent accepts → parent sets ₹500/day and approval
 * above ₹500 → teen pays Riya ₹200 (ok) → ₹400 (over today's limit)
 * → ₹750 (approval) → parent approves (twice — executes once) →
 * refresh keeps everything → reset returns to the seed.
 */
let sb: SandboxContextValue | null = null;
function Capture() {
  sb = useSandbox();
  return null;
}
function mount() {
  sb = null;
  render(
    <SandboxProvider>
      <Capture />
    </SandboxProvider>,
  );
}
function cur(): SandboxContextValue {
  if (!sb) throw new Error("not mounted");
  return sb;
}
function run<T>(fn: () => T): T {
  let out: T = undefined as unknown as T;
  act(() => {
    out = fn();
  });
  return out;
}
// Phase 5: views may hold the parent's own wallet — probe the teen's.
const balance = () => teenBalance(cur().state);
const teenEntries = () => teenLedger(cur().state);

describe("Phase 3 journey", () => {
  it("links, limits, approves once, persists, and resets", async () => {
    mount();
    const seedLedger = teenEntries().length;
    expect(balance()).toBe(1850);

    // Teen: generate an invite.
    const invite = run(() => cur().actions.createFamilyInvite());
    expect(invite.ok).toBe(true);
    if (!invite.ok) return;
    expect(invite.value.code).toMatch(/^TEEN-\d{4}$/);

    // Switch to parent (same family, same ledger), enter code, connect.
    run(() => cur().actions.switchRole("parent"));
    expect(selectSession(cur().state).role).toBe("parent");
    // Phase 4: a parent who isn't connected yet can't see the teen's
    // money at all (the ledger itself is untouched — checked below).
    expect(teenEntries().length).toBe(0);
    const claim = run(() => cur().actions.claimFamilyInvite(invite.value.code));
    expect(claim.ok).toBe(true);
    if (!claim.ok) return;
    expect(run(() => cur().actions.acceptFamilyInvite(claim.value.teenId)).ok).toBe(true);
    expect(teenEntries().length).toBe(seedLedger); // connected: same ledger
    const teenId = selectTeen(cur().state).id;
    expect(cur().state.family.links.find((l) => l.teenId === teenId)?.status).toBe(
      "linked",
    );

    // Parent: daily ₹500, approvals above ₹500.
    const rules = run(() =>
      cur().actions.updateSpendingRules({
        teenId,
        limits: { dailyLimit: 500, perTransactionLimit: null },
        approval: { threshold: 500 },
      }),
    );
    expect(rules.ok).toBe(true);

    // Teen: ₹200 to Riya completes.
    run(() => cur().actions.switchRole("teen"));
    const p1 = run(() => cur().actions.pay({ recipientId: "rec_riya", amount: 200 }));
    expect(p1.ok && p1.value.status).toBe("completed");
    expect(balance()).toBe(1650);
    expect(selectSpendingStatus(cur().state, teenId).remainingToday).toBe(300);

    // ₹400 would exceed today's limit: rejected, ledger unchanged.
    const ledgerBefore = teenEntries().length;
    const p2 = run(() => cur().actions.pay({ recipientId: "rec_riya", amount: 400 }));
    expect(p2.ok).toBe(false);
    if (!p2.ok) {
      expect(p2.error.message).toMatch(/would exceed today's spending limit/i);
      expect(p2.error.message).not.toMatch(/exceeds_daily_limit/);
    }
    expect(teenEntries().length).toBe(ledgerBefore);
    expect(balance()).toBe(1650);

    // ₹750 is above the threshold: an approval, no money moved.
    const p3 = run(() =>
      cur().actions.pay({ idempotencyId: "pay_bike_lock", recipientId: "rec_riya", amount: 750 }),
    );
    expect(p3.ok && p3.value.status).toBe("approval_requested");
    expect(balance()).toBe(1650);
    expect(teenEntries().length).toBe(ledgerBefore);
    const approval = cur().state.approvals.find((a) => a.status === "pending");
    expect(approval?.amount).toBe(750);

    // Parent sees the request, approves — twice. Executes once.
    run(() => cur().actions.switchRole("parent"));
    expect(
      selectMyNotifications(cur().state).some((n) => n.title === "New approval request"),
    ).toBe(true);
    const a1 = run(() => cur().actions.decideApproval(approval!.id, "approve"));
    const a2 = run(() => cur().actions.decideApproval(approval!.id, "approve"));
    expect(a1.ok).toBe(true);
    expect(a2.ok).toBe(true); // idempotent replay, not an error
    expect(balance()).toBe(900);
    expect(teenEntries().length).toBe(ledgerBefore + 1);
    expect(cur().state.approvals.find((a) => a.id === approval!.id)?.status).toBe(
      "approved",
    );

    // Teen: balance, activity, notification.
    run(() => cur().actions.switchRole("teen"));
    const newest = [...teenEntries()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    )[0];
    expect(newest?.type).toBe("payment_sent");
    expect(newest?.amount).toBe(750);
    const mine = selectMyNotifications(cur().state).map((n) => n.title);
    expect(mine).toContain("Payment approved");
    expect(mine).not.toContain("New approval request"); // that one is the parent's

    // Refresh: remount from localStorage.
    await act(async () => {
      await Promise.resolve();
    });
    const snapshot = JSON.stringify(cur().state);
    cleanup();
    mount();
    expect(JSON.stringify(cur().state)).toBe(snapshot);
    expect(balance()).toBe(900);
    expect(selectSession(cur().state).role).toBe("teen");

    // Reset: deterministic seed, Phase 2 still works.
    run(() => cur().actions.resetSandbox());
    const seed = buildSeedState();
    expect(teenEntries()).toEqual(teenLedger(seed));
    expect(cur().state.family).toEqual(seed.family);
    expect(cur().state.approvals).toEqual([]);
    expect(balance()).toBe(1850);
    const phase2 = run(() => cur().actions.pay({ recipientId: "rec_riya", amount: 100 }));
    expect(phase2.ok && phase2.value.status).toBe("completed");
    expect(balance()).toBe(1750);
  });
});
