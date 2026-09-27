import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  SandboxProvider,
  useSandbox,
  type SandboxContextValue,
} from "@/sandbox/store";
import type { MoneyOperation } from "@/domain";
import type { SandboxDatabase } from "@/sandbox/types";
import { teenLedger } from "./helpers/fixtures";
import { SEED_SAVE_SPACE_ID } from "@/sandbox/seed";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
}));

const STORAGE_KEY = "teenpay-sandbox-v1";

/** Payment operations made after the seed. */
function sessionPayments(operations: MoneyOperation[]): number {
  return operations.filter((op) => op.type === "payment" && !op.id.startsWith("seed_")).length;
}

function readStore(): unknown {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

/**
 * A live handle to the sandbox context, updated by a component
 * rendered inside the real provider.
 */
let sb: SandboxContextValue | null = null;

function Capture() {
  sb = useSandbox();
  return null;
}

/** Run a store action inside `act` and return its result. */
function run<T>(fn: () => T): T {
  let result: T = undefined as unknown as T;
  act(() => {
    result = fn();
  });
  return result;
}

function renderProbe(): SandboxContextValue {
  sb = null;
  render(
    <SandboxProvider>
      <Capture />
      <Probe />
    </SandboxProvider>,
  );
  if (!sb) throw new Error("probe did not capture the sandbox context");
  return sb;
}

function current(): SandboxContextValue {
  if (!sb) throw new Error("no rendered probe");
  return sb;
}

function testid(name: string): number {
  return Number(document.querySelector(`[data-testid="${name}"]`)?.textContent);
}

function titles(): string[] {
  return Array.from(
    document.querySelectorAll('[data-testid="notification-titles"] li'),
  ).map((li) => li.textContent ?? "");
}

/** Renders the derived numbers as queryable text. */
function Probe() {
  const { state } = useSandbox();
  // Phase 5: a parent's view also holds their own wallet — probe the teen's.
  const ledger = teenLedger(state);
  const spend = ledger.reduce(
    (sum, e) => (e.direction === "credit" ? sum + e.amount : sum - e.amount),
    0,
  );
  // Phase 6: Save and goals are Money Spaces — balance = in − back.
  const inSpace = (match: (spaceId: string) => boolean) =>
    ledger
      .filter((e) => e.spaceId !== undefined && match(e.spaceId))
      .reduce((s, e) => s + (e.type === "space_allocation" ? e.amount : -e.amount), 0);
  const save = inSpace((id) => id === SEED_SAVE_SPACE_ID);
  const goals = inSpace((id) => id !== SEED_SAVE_SPACE_ID);
  const upcoming = state.requests
    .filter((r) => r.status === "pending")
    .reduce((s, r) => s + r.amount, 0);

  return (
    <div>
      <span data-testid="spend">{spend}</span>
      <span data-testid="save">{save}</span>
      <span data-testid="goals">{goals}</span>
      <span data-testid="upcoming">{upcoming}</span>
      <span data-testid="pending">
        {state.requests.filter((r) => r.status === "pending").length}
      </span>
      {/* Phase 5: payment records are operations of type "payment";
          count the ones made here (the seed's ₹350 is history). */}
      <span data-testid="payment-count">{sessionPayments(state.operations)}</span>
      <span data-testid="unread">
        {state.notifications.filter((n) => !n.read).length}
      </span>
      <ul data-testid="notification-titles">
        {state.notifications.map((n) => (
          <li key={n.id}>{n.title}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Phase 3: pocket money needs a connected guardian. Runs the real
 * linking journey through the store and leaves the parent role
 * active.
 */
function linkFamilyAsParent(): void {
  const invite = run(() => current().actions.createFamilyInvite());
  if (!invite.ok) throw new Error("invite failed");
  run(() => current().actions.switchRole("parent"));
  const claim = run(() => current().actions.claimFamilyInvite(invite.value.code));
  if (!claim.ok) throw new Error("claim failed");
  const accepted = run(() => current().actions.acceptFamilyInvite(claim.value.teenId));
  if (!accepted.ok) throw new Error("accept failed");
}

/** Seed: 2500 + 1500 + 500 − 1500 − 800 − 350 = 1850. */
describe("sandbox store — derived balance", () => {
  it("starts from the seed state (balance derived, never stored)", () => {
    renderProbe();
    expect(testid("spend")).toBe(1850);
    expect(testid("save")).toBe(800);
    expect(testid("goals")).toBe(1500);
    expect(testid("upcoming")).toBe(200);
    expect(testid("payment-count")).toBe(0);
  });
});

describe("sandbox store — pay", () => {
  it("a successful payment debits the balance, records the payment, and notifies", () => {
    renderProbe();
    expect(testid("spend")).toBe(1850);
    const unreadBefore = testid("unread");

    const res = run(() =>
      current().actions.pay({ recipientId: "rec_riya", amount: 300 }),
    );
    expect(res.ok).toBe(true);

    expect(testid("spend")).toBe(1550);
    expect(testid("payment-count")).toBe(1);
    expect(testid("unread")).toBe(unreadBefore + 1);
    expect(titles()[0]).toBe("Payment sent");
  });

  it("rejects a payment larger than the balance without changing state", () => {
    renderProbe();
    const before = current().state;
    const res = run(() =>
      current().actions.pay({ recipientId: "rec_riya", amount: 5000 }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("insufficient_balance");
    expect(testid("spend")).toBe(1850);
    expect(testid("payment-count")).toBe(0);
    expect(current().state).toBe(before); // no state change at all
  });

  it("rejects zero and fractional amounts with human-readable errors", () => {
    renderProbe();
    const zero = run(() =>
      current().actions.pay({ recipientId: "rec_riya", amount: 0 }),
    );
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.error.message).toMatch(/above zero/i);
    const frac = run(() =>
      current().actions.pay({ recipientId: "rec_riya", amount: 12.5 }),
    );
    expect(frac.ok).toBe(false);
    if (!frac.ok) expect(frac.error.message).toMatch(/whole-rupee/i);
    expect(testid("spend")).toBe(1850);
  });

  it("double-confirming with the same idempotency id creates exactly one payment", () => {
    renderProbe();
    const id = "pay_test-idem";
    const first = run(() =>
      current().actions.pay({
        idempotencyId: id,
        recipientId: "rec_riya",
        amount: 250,
      }),
    );
    const second = run(() =>
      current().actions.pay({
        idempotencyId: id,
        recipientId: "rec_riya",
        amount: 250,
      }),
    );
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(testid("payment-count")).toBe(1);
    expect(testid("spend")).toBe(1600); // debited exactly once
  });

  it("rejects an unknown recipient", () => {
    renderProbe();
    const res = run(() =>
      current().actions.pay({ recipientId: "rec_gone", amount: 100 }),
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("unknown_recipient");
  });
});

describe("sandbox store — requests", () => {
  it("creating a request moves nothing but adds a pending request", () => {
    renderProbe();
    run(() =>
      current().actions.createRequest({
        recipientId: "rec_kabir",
        amount: 120,
        note: "Snacks",
      }),
    );
    expect(testid("spend")).toBe(1850);
    expect(testid("upcoming")).toBe(320); // 200 seed + 120
    expect(titles()[0]).toBe("Request sent");
  });

  it("marking a request paid credits the balance exactly once", () => {
    renderProbe();
    const res = run(() =>
      current().actions.respondToRequest("seed_req_1", "paid"),
    );
    expect(res.ok).toBe(true);
    expect(testid("spend")).toBe(2050); // 1850 + 200
    expect(testid("upcoming")).toBe(0);

    const again = run(() =>
      current().actions.respondToRequest("seed_req_1", "paid"),
    );
    expect(again.ok).toBe(false);
    expect(testid("spend")).toBe(2050);
  });

  it("cancelling a request keeps it out of the ledger", () => {
    renderProbe();
    run(() =>
      current().actions.createRequest({
        recipientId: "rec_kabir",
        amount: 75,
      }),
    );
    const created = current().state.requests.find((r) => r.amount === 75);
    expect(created).toBeDefined();
    expect(testid("upcoming")).toBe(275);

    run(() => current().actions.respondToRequest(created!.id, "cancelled"));
    expect(
      current().state.requests.find((r) => r.id === created!.id)?.status,
    ).toBe("cancelled");
    expect(testid("upcoming")).toBe(200);
    expect(testid("spend")).toBe(1850);
  });
});

describe("sandbox store — allowance and allocations", () => {
  it("parent allowance credits the teen balance through the same ledger", () => {
    renderProbe();
    linkFamilyAsParent();
    const res = run(() => current().actions.sendAllowance({ amount: 500 }));
    expect(res.ok).toBe(true);
    expect(testid("spend")).toBe(2350);
    // Phase 4: notifications are scoped to their recipient — the teen's.
    run(() => current().actions.switchRole("teen"));
    expect(testid("spend")).toBe(2350);
    expect(titles()[0]).toBe("Pocket money received");
  });

  it("adding to Save moves money from spend into save", () => {
    renderProbe();
    run(() => current().actions.addToSpace(SEED_SAVE_SPACE_ID, 350));
    expect(testid("spend")).toBe(1500);
    expect(testid("save")).toBe(1150);
  });

  it("adding to a goal moves money from spend into goals", () => {
    renderProbe();
    run(() => current().actions.addToSpace("goal_bike", 200));
    expect(testid("spend")).toBe(1650);
    expect(testid("goals")).toBe(1700);
  });

  it("allocations cannot exceed the available balance", () => {
    renderProbe();
    const res = run(() => current().actions.addToSpace(SEED_SAVE_SPACE_ID, 1851));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe("insufficient_balance");
    expect(testid("spend")).toBe(1850);
  });
});

describe("sandbox store — notifications", () => {
  it("marks one notification read, and 'mark all read' clears the rest", () => {
    renderProbe();
    const firstUnread = current().state.notifications.find((n) => !n.read);
    expect(firstUnread).toBeDefined();
    run(() => current().actions.markNotificationRead(firstUnread!.id));
    expect(testid("unread")).toBe(0);

    // Phase 3: linking itself notifies both people; clear those so
    // the allowance notification is the only new unread one.
    linkFamilyAsParent();
    run(() => current().actions.markAllNotificationsRead());
    run(() => current().actions.switchRole("teen"));
    run(() => current().actions.markAllNotificationsRead());
    expect(testid("unread")).toBe(0);

    run(() => current().actions.switchRole("parent"));
    run(() => current().actions.sendAllowance({ amount: 100 }));
    // Phase 4: each view holds only its viewer's notifications — the
    // parent has nothing new; the teen has exactly one.
    expect(testid("unread")).toBe(0);
    // Notifications are per person: the teen marks their own read.
    run(() => current().actions.switchRole("teen"));
    expect(testid("unread")).toBe(1);
    run(() => current().actions.markAllNotificationsRead());
    expect(testid("unread")).toBe(0);
  });
});

describe("sandbox store — persistence and reset", () => {
  it("persists state to localStorage after an action", async () => {
    renderProbe();
    run(() => current().actions.pay({ recipientId: "rec_riya", amount: 100 }));
    await act(async () => {
      await Promise.resolve();
    });
    // Phase 5: one ledger, entries tagged with their wallet; payments
    // recorded as operations. Phase 6: schema v5 (Money Spaces).
    // Phase 7: schema v6 (pocket money schedules; none in the seed).
    // Phase 8: schema v7 (TeenPay money requests; none in the seed).
    // Phase 9: schema v8 (favourites; none in the seed).
    const stored = readStore() as SandboxDatabase;
    expect(stored.version).toBe(8);
    expect(stored.pocketMoneySchedules).toEqual([]);
    expect(stored.peerRequests).toEqual([]);
    expect(stored.contacts).toEqual([]);
    expect(stored.spaces.map((s) => s.id).sort()).toEqual(["goal_bike", "spc_save_usr_aarav", "spc_save_usr_meera"]);
    expect(teenLedger(stored).length).toBe(7); // 6 seed + 1 payment
    expect(sessionPayments(stored.operations)).toBe(1);
  });

  it("reset restores the seed, and storage follows back to the seed", () => {
    renderProbe();
    run(() => current().actions.pay({ recipientId: "rec_riya", amount: 300 }));
    expect(testid("spend")).toBe(1550);
    expect(testid("payment-count")).toBe(1);
    run(() => current().actions.resetSandbox());
    expect(testid("spend")).toBe(1850);
    expect(testid("payment-count")).toBe(0);
    // The store auto-persists, so storage ends up holding the seed.
    const stored = readStore() as SandboxDatabase;
    expect(teenLedger(stored).length).toBe(6);
    expect(sessionPayments(stored.operations)).toBe(0);
  });

  it("falls back to the seed when stored data is malformed", () => {
    window.localStorage.setItem(STORAGE_KEY, '{"ledger":"nope"}');
    renderProbe();
    expect(testid("spend")).toBe(1850);
  });
});
