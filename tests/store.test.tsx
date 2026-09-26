import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { mockRecipients } from "@/data/mock";
import {
  createMemoryStorage,
  createSeedState,
  loadPersistedState,
  newOperationKey,
  SandboxProvider,
  useSandbox,
} from "@/sandbox";

const NOW = new Date(Date.now() - 60_000);

function harness() {
  const storage = createMemoryStorage();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <SandboxProvider initialState={createSeedState(NOW)} storage={storage}>
      {children}
    </SandboxProvider>
  );
  return { storage, ...renderHook(() => useSandbox(), { wrapper }) };
}

describe("sandbox store", () => {
  it("opens on the seed with one unread welcome", () => {
    const { result } = harness();
    expect(result.current.ready).toBe(true);
    expect(result.current.wallet.availablePaise).toBe(245_000);
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.notifications[0].kind).toBe("system");
  });

  it("sends payments, notifies, and replays idempotency keys", () => {
    const { result, storage } = harness();
    const recipient = mockRecipients[1];
    let first: ReturnType<typeof result.current.sendPayment> = { ok: false, error: "unset" };
    act(() => {
      first = result.current.sendPayment({
        recipient,
        amountPaise: 20_000,
        note: "Movie",
        idempotencyKey: "op_store_pay",
      });
    });
    expect(first.ok).toBe(true);
    expect(result.current.wallet.availablePaise).toBe(225_000);
    expect(result.current.notifications[0]).toMatchObject({
      kind: "money_out",
      read: false,
    });
    expect(result.current.notifications).toHaveLength(2);

    // Same key again: success, but no new entries or notifications.
    act(() => {
      const replay = result.current.sendPayment({
        recipient,
        amountPaise: 20_000,
        idempotencyKey: "op_store_pay",
      });
      expect(replay.ok).toBe(true);
    });
    expect(result.current.wallet.availablePaise).toBe(225_000);
    expect(result.current.notifications).toHaveLength(2);

    // Commits persist to the injected storage.
    expect(loadPersistedState(storage).state?.entries).toHaveLength(12);
  });

  it("refuses payments to unapproved recipients", () => {
    const { result } = harness();
    act(() => {
      const outcome = result.current.sendPayment({
        recipient: { ...mockRecipients[1], parentApproved: false },
        amountPaise: 1_000,
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.error).toContain("needs parent approval");
    });
    expect(result.current.wallet.availablePaise).toBe(245_000);
  });

  it("creates requests that affect Upcoming but never the balance", () => {
    const { result } = harness();
    act(() => {
      const outcome = result.current.createRequest({
        targetName: "Meera Sharma",
        targetKind: "parent",
        amountPaise: 20_000,
        note: "Books",
      });
      expect(outcome.ok).toBe(true);
    });
    expect(result.current.pendingRequests).toHaveLength(1);
    expect(result.current.wallet.availablePaise).toBe(245_000);
    expect(result.current.wallet.upcomingPaise).toBe(35_000);
    expect(result.current.transactions.find((t) => t.source === "request")).toMatchObject({
      title: "Money request",
      status: "pending",
    });
  });

  it("cancels pending requests exactly once", () => {
    const { result } = harness();
    let requestId = "";
    act(() => {
      const created = result.current.createRequest({
        targetName: "Meera Sharma",
        targetKind: "parent",
        amountPaise: 20_000,
      });
      if (created.ok) requestId = created.request.id;
    });
    act(() => {
      expect(result.current.cancelRequest(requestId).ok).toBe(true);
    });
    expect(result.current.pendingRequests).toHaveLength(0);
    expect(result.current.wallet.upcomingPaise).toBe(15_000);
    act(() => {
      const again = result.current.cancelRequest(requestId);
      expect(again.ok).toBe(false);
    });
  });

  it("fulfills requests with allowance and pays only once", () => {
    const { result } = harness();
    let requestId = "";
    act(() => {
      const created = result.current.createRequest({
        targetName: "Meera Sharma",
        targetKind: "parent",
        amountPaise: 20_000,
      });
      if (created.ok) requestId = created.request.id;
    });
    act(() => {
      expect(result.current.fulfillRequest(requestId).ok).toBe(true);
    });
    expect(result.current.wallet.availablePaise).toBe(265_000);
    expect(result.current.pendingRequests).toHaveLength(0);
    expect(result.current.requests.find((r) => r.id === requestId)?.status).toBe("paid");
    expect(result.current.notifications[0]).toMatchObject({
      kind: "money_in",
      body: expect.stringContaining("request paid") as string,
    });
    act(() => {
      expect(result.current.fulfillRequest(requestId).ok).toBe(false);
    });
    expect(result.current.wallet.availablePaise).toBe(265_000);
  });

  it("moves money between spaces without notifications", () => {
    const { result } = harness();
    const before = result.current.notifications.length;
    act(() => {
      const outcome = result.current.moveBetweenSpaces({
        fromSpace: "spend",
        toSpace: "save",
        amountPaise: 10_000,
        idempotencyKey: newOperationKey(),
      });
      expect(outcome.ok).toBe(true);
    });
    expect(result.current.wallet.availablePaise).toBe(245_000);
    expect(result.current.wallet.spaces.spend.balancePaise).toBe(75_000);
    expect(result.current.wallet.spaces.save.balancePaise).toBe(130_000);
    expect(result.current.notifications).toHaveLength(before);
  });

  it("funds goals and fires a milestone only when newly complete", () => {
    const { result } = harness();
    act(() => {
      const partial = result.current.contributeToGoal({
        goalId: "goal_buds",
        fromSpace: "spend",
        amountPaise: 5_000,
        idempotencyKey: newOperationKey(),
      });
      expect(partial.ok).toBe(true);
    });
    expect(result.current.goals[0].savedPaise).toBe(45_000);
    expect(result.current.notifications.some((n) => n.kind === "goal_milestone")).toBe(false);

    // Fund the rest via allowance, then complete the goal.
    act(() => {
      result.current.sendAllowance({ amountPaise: 254_900, idempotencyKey: newOperationKey() });
    });
    act(() => {
      const complete = result.current.contributeToGoal({
        goalId: "goal_buds",
        fromSpace: "spend",
        amountPaise: 254_900,
        idempotencyKey: newOperationKey(),
      });
      expect(complete.ok).toBe(true);
    });
    expect(result.current.goals[0].savedPaise).toBe(299_900);
    expect(result.current.notifications[0]).toMatchObject({
      kind: "goal_milestone",
      title: "Goal reached",
    });
  });

  it("marks notifications read, individually and all at once", () => {
    const { result } = harness();
    const id = result.current.notifications[0].id;
    act(() => {
      result.current.markNotificationRead(id);
    });
    expect(result.current.unreadCount).toBe(0);
    act(() => {
      result.current.createRequest({
        targetName: "Meera Sharma",
        targetKind: "parent",
        amountPaise: 1_000,
      });
    });
    expect(result.current.unreadCount).toBe(1);
    act(() => {
      result.current.markAllNotificationsRead();
    });
    expect(result.current.unreadCount).toBe(0);
  });

  it("resets to a fresh seed", () => {
    const { result } = harness();
    act(() => {
      result.current.sendPayment({ recipient: mockRecipients[1], amountPaise: 20_000 });
    });
    expect(result.current.wallet.availablePaise).toBe(225_000);
    act(() => {
      result.current.resetSandbox();
    });
    expect(result.current.wallet.availablePaise).toBe(245_000);
    expect(result.current.requests).toHaveLength(0);
    expect(result.current.notifications).toHaveLength(1);
  });
});
