import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSaveSpaceId, primaryWalletId } from "@/domain";
import { walletBalance } from "@/sandbox/engine";
import {
  acceptMoneyRequestTransition,
  approveTransferTransition,
  createMoneyRequestTransition,
  sendMoneyTransition,
} from "@/sandbox/peer-transitions";
import { assessRequestSafety, assessSendSafety } from "@/sandbox/shield";
import { moveSpaceMoneyTransition } from "@/sandbox/space-transitions";
import { mergeScope, scopeFor } from "@/sandbox/scope";
import { SEED_PARENT_ID, SEED_PEER_ID, SEED_TEEN_ID, buildSeedDatabase } from "@/sandbox/seed";
import type { SandboxDatabase } from "@/sandbox/types";
import { SandboxProvider, useSandbox, type SandboxContextValue } from "@/sandbox/store";
import { SANDBOX_KEY, TEEN_WALLET, linkedDatabase, preloadDatabase } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/money",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

/**
 * Phase 14 integration: the Safety Shield sits beside the payment
 * engine — it never replaces authorization, guardian rules, limits,
 * balance checks, Money Spaces or idempotency, and it adds no second
 * path for money to move.
 */

const T1 = "2026-09-26T09:00:00Z";

function mustDb(out: { db: SandboxDatabase; result: { ok: boolean } }): SandboxDatabase {
  if (!out.result.ok) throw new Error(JSON.stringify(out.result));
  return out.db;
}

describe("Shield + guardian rules", () => {
  it("an approval-required send is unchanged: the shield pauses, the guardian still decides", () => {
    const db = linkedDatabase({ daily: null, perTx: null, threshold: 400 });
    const safety = assessSendSafety(db, SEED_TEEN_ID, "@meera", 500, T1);
    expect(safety.ok && safety.value.outcome).toBe("confirm");

    const send = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      recipient: "@meera",
      amount: 500,
      idempotencyKey: "snd_int_appr1",
    });
    expect(send.result).toMatchObject({
      ok: true,
      value: { status: "approval_requested", guardianName: "Priya" },
    });
    if (!send.result.ok || send.result.value.status !== "approval_requested") throw new Error("shape");

    // The guardian approves exactly as before; the shield adds nothing here.
    const approved = approveTransferTransition(send.db, {
      actorId: SEED_PARENT_ID,
      at: T1,
      approvalId: send.result.value.approvalId,
    });
    expect(approved.result.ok).toBe(true);
    expect(walletBalance(approved.db.ledger, primaryWalletId(SEED_PEER_ID))).toBe(1700);
  });

  it("a guardian denial is exactly as it was — the shield never softens it", () => {
    const db = linkedDatabase({ daily: null, perTx: null, threshold: 100 });
    const send = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      recipient: "@meera",
      amount: 500,
      idempotencyKey: "snd_int_appr2",
    });
    expect(send.result.ok && send.result.value.status).toBe("approval_requested");
    // Nothing about approvals changed: peerRequests/ledger lengths are the seed's.
    expect(send.db.ledger.length).toBe(db.ledger.length);
  });

  it("friendship never bypasses guardian thresholds or limits", () => {
    const db = linkedDatabase({ daily: 200, perTx: null, threshold: null });
    // Even after history with Meera, the limit still refuses.
    const withHistory = mustDb(
      sendMoneyTransition(db, { actorId: SEED_TEEN_ID, at: T1, recipient: "@meera", amount: 100, idempotencyKey: "snd_int_hist1" }),
    );
    const blocked = sendMoneyTransition(withHistory, {
      actorId: SEED_TEEN_ID,
      at: T1,
      recipient: "@meera",
      amount: 250,
      idempotencyKey: "snd_int_hist2",
    });
    expect(blocked.result.ok).toBe(false);
    if (!blocked.result.ok) expect(blocked.result.error.code).toBe("exceeds_daily_limit");
  });
});

describe("Shield + balances, spaces and idempotency", () => {
  it("money moved into a Space is no longer 'available', and the shield agrees", () => {
    let db = mustDb(
      sendMoneyTransition(buildSeedDatabase(), { actorId: SEED_TEEN_ID, at: T1, recipient: "@meera", amount: 50, idempotencyKey: "snd_int_sp1" }),
    );
    // ₹1,800 available. Move ₹600 into the default save space.
    const scope = scopeFor(db, SEED_TEEN_ID);
    if (!scope) throw new Error("no scope");
    const moved = moveSpaceMoneyTransition(scope.state, {
      actorId: SEED_TEEN_ID,
      at: T1,
      operationId: "spc_int_mv1",
      spaceId: defaultSaveSpaceId(SEED_TEEN_ID),
      amount: 600,
      direction: "add", // into the space, out of the spendable wallet balance
    });
    if (!moved.result.ok) throw new Error(JSON.stringify(moved.result));
    db = mergeScope(db, scope.info, scope.state, moved.state);
    // Now only ₹1,200 is sendable: ₹500 × 2 < 1,200 → not large any more.
    const safety = assessSendSafety(db, SEED_TEEN_ID, "@meera", 500, T1);
    expect(safety.ok && safety.value.outcome).toBe("allow");
    const larger = assessSendSafety(db, SEED_TEEN_ID, "@meera", 800, T1);
    expect(larger.ok && larger.value.reasons.map((r) => r.code)).toContain("large_amount");
    expect(walletBalance(db.ledger, primaryWalletId(SEED_TEEN_ID))).toBe(1200);
  });

  it("an insufficient balance is still refused whatever the shield says", () => {
    const db = linkedDatabase();
    const safety = assessSendSafety(db, SEED_TEEN_ID, "@meera", 5000, T1);
    expect(safety.ok && safety.value.outcome).toBe("confirm"); // large + first-time
    const send = sendMoneyTransition(db, {
      actorId: SEED_TEEN_ID,
      at: T1,
      recipient: "@meera",
      amount: 5000,
      idempotencyKey: "snd_int_bal1",
    });
    expect(send.result.ok).toBe(false);
    if (!send.result.ok) expect(send.result.error.code).toBe("insufficient_balance");
    expect(walletBalance(send.db.ledger, TEEN_WALLET)).toBe(1850);
  });

  it("assessing never spends: replaying the same send twice still posts once", () => {
    const db = linkedDatabase();
    assessSendSafety(db, SEED_TEEN_ID, "@meera", 120, T1);
    const input = { actorId: SEED_TEEN_ID, at: T1, recipient: "@meera", amount: 120, idempotencyKey: "snd_int_idem1" };
    const first = sendMoneyTransition(db, input);
    const second = sendMoneyTransition(first.db, input);
    expect(first.result.ok && second.result.ok).toBe(true);
    expect(second.result.ok && second.result.value.status).toBe("completed");
    if (second.result.ok && second.result.value.status === "completed") {
      expect(second.result.value.replayed).toBe(true);
    }
    expect(walletBalance(second.db.ledger, primaryWalletId(SEED_PEER_ID))).toBe(1320);
    expect(second.db.operations.filter((o) => o.id === "snd_int_idem1")).toHaveLength(1);
  });
});

describe("Shield + requests", () => {
  it("the shield never pays or declines — only the payer's own action does", () => {
    const db = mustDb(
      createMoneyRequestTransition(linkedDatabase(), { actorId: SEED_PEER_ID, at: T1, payer: "@aarav", amount: 60, idempotencyKey: "prq_int_01" }),
    );
    const requestId = db.peerRequests[0]!.requestId;
    const before = JSON.stringify(db.peerRequests);
    const safety = assessRequestSafety(db, SEED_TEEN_ID, requestId);
    expect(safety.ok).toBe(true);
    expect(JSON.stringify(db.peerRequests)).toBe(before); // untouched

    const paid = acceptMoneyRequestTransition(db, { actorId: SEED_TEEN_ID, at: T1, requestId });
    expect(paid.result.ok).toBe(true);
    expect(paid.db.peerRequests.find((r) => r.requestId === requestId)!.status).toBe("accepted");
  });
});

describe("Store wiring", () => {
  let sb: SandboxContextValue | null = null;
  function Capture() {
    sb = useSandbox();
    return null;
  }

  beforeEach(() => {
    sb = null;
    localStorage.clear();
  });

  it("exposes assessments and settings through the signed-in store", async () => {
    preloadDatabase(linkedDatabase());
    render(
      <SandboxProvider viewerId={SEED_TEEN_ID}>
        <Capture />
      </SandboxProvider>,
    );
    await waitFor(() => expect(sb).not.toBeNull());
    await waitFor(() => expect(sb!.storageStatus).toBe("ready"));
    const sandbox = sb!;

    const send = run(() => sandbox.actions.shieldAssessSend("@meera", 100));
    expect(send.ok && send.value.outcome).toBe("confirm");
    expect(sandbox.shield).toEqual({
      firstTimeRecipient: true,
      largePayments: true,
      repeatedPayments: true,
    });

    const saved = run(() => sandbox.actions.updateShieldSettings({ firstTimeRecipient: false }));
    expect(saved.ok).toBe(true);
    if (saved.ok) expect(saved.value.settings.firstTimeRecipient).toBe(false);
    await waitFor(() => expect(sb!.shield.firstTimeRecipient).toBe(false));

    // The softened reminder now reads as a notice in the store too.
    const again = run(() => sandbox.actions.shieldAssessSend("@meera", 100));
    expect(again.ok && again.value.outcome).toBe("notice");

    // And the change is the only thing persisted.
    const stored = JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
    expect(stored.shieldSettings).toHaveLength(1);
    expect(stored.shieldSettings![0]).toMatchObject({
      ownerAccountId: SEED_TEEN_ID,
      firstTimeRecipient: false,
      largePayments: true,
      repeatedPayments: true,
    });
  });

  it("refuses parents at the store boundary too", async () => {
    render(
      <SandboxProvider viewerId={SEED_PARENT_ID}>
        <Capture />
      </SandboxProvider>,
    );
    await waitFor(() => expect(sb).not.toBeNull());
    await waitFor(() => expect(sb!.storageStatus).toBe("ready"));
    const sandbox = sb!;
    const send = run(() => sandbox.actions.shieldAssessSend("@meera", 100));
    expect(send).toMatchObject({ ok: false, error: { code: "not_permitted" } });
    const save = run(() => sandbox.actions.updateShieldSettings({ largePayments: false }));
    expect(save).toMatchObject({ ok: false, error: { code: "not_permitted" } });
  });
});

/** Run a store action inside `act` and return its result. */
function run<T>(fn: () => T): T {
  let result: T = undefined as unknown as T;
  act(() => {
    result = fn();
  });
  return result;
}
