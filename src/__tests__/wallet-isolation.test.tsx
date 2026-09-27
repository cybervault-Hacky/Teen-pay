import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { primaryWalletId, type User } from "@/domain";
import { AuthProvider, useAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { disconnectTransition } from "@/sandbox/family-transitions";
import { databaseFromState } from "@/sandbox/persistence";
import { LedgerIntegrityError, mergeScope, scopeFor } from "@/sandbox/scope";
import { buildSeedDatabase, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { getBalance, getTransaction, getWallet, listTransactions } from "@/sandbox/selectors";
import { SandboxProvider, useOptionalSandbox, type SandboxContextValue } from "@/sandbox/store";
import {
  payTransition,
  refundTransition,
  sendAllowanceTransition,
  setWalletStatusTransition,
} from "@/sandbox/transitions";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { AT, linkedState, must, SANDBOX_KEY, TEEN_WALLET } from "./helpers/fixtures";

vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function newAccount(db: SandboxDatabase, role: "teen" | "parent", username: string) {
  const out = createAccount(db, { role, displayName: `${username} Test`, username }, AT);
  if ("code" in out) throw new Error(out.message);
  return out as { db: SandboxDatabase; account: User };
}

function viewOf(db: SandboxDatabase, accountId: string): SandboxState {
  const scope = scopeFor(db, accountId);
  if (!scope) throw new Error("no scope");
  return scope.state;
}

/** Seed families linked (Aarav ↔ Priya), plus another teen and parent. */
function world() {
  let db = databaseFromState(linkedState());
  const kabir = newAccount(db, "teen", "kabirm");
  db = kabir.db;
  const neha = newAccount(db, "parent", "neha");
  db = neha.db;
  return { db, kabir: kabir.account, neha: neha.account };
}

describe("wallet isolation (domain / repository layer)", () => {
  it("teen A can't see or touch teen B's wallet", () => {
    const { db, kabir } = world();
    const view = viewOf(db, kabir.id);
    expect(view.wallets.map((w) => w.ownerAccountId)).toEqual([kabir.id]);
    expect(view.ledger.every((e) => e.walletId === primaryWalletId(kabir.id))).toBe(true);
    expect(getWallet(view, TEEN_WALLET)).toBeNull();
    expect(getTransaction(view, "seed_pay_1")).toBeNull();

    const freeze = setWalletStatusTransition(view, { actorId: kabir.id, at: AT, walletId: TEEN_WALLET, status: "frozen" });
    expect(freeze.result).toMatchObject({ ok: false, error: { code: "unknown_wallet" } });
    const refund = refundTransition(view, { actorId: kabir.id, at: AT, entryId: "seed_pay_1" });
    expect(refund.result.ok).toBe(false);
    // Kabir's own wallet starts at ₹0 — he can't spend Aarav's money.
    const payment = payTransition(view, { actorId: kabir.id, at: AT, entryId: "k1", recipientId: "rec_riya", amount: 100 });
    expect(payment.result).toMatchObject({ ok: false, error: { code: "insufficient_balance" } });
  });

  it("a parent in another family gets no teen wallet data and can't send to it", () => {
    const { db, neha } = world();
    const view = viewOf(db, neha.id);
    expect(view.wallets.map((w) => w.ownerAccountId)).toEqual([neha.id]);
    expect(view.ledger.every((e) => e.accountId === neha.id)).toBe(true);
    expect(getBalance(view, primaryWalletId(neha.id))).toBe(10_000);
    expect(getWallet(view, TEEN_WALLET)).toBeNull();

    const allowance = sendAllowanceTransition(view, { actorId: neha.id, at: AT, operationId: "n1", amount: 100 });
    expect(allowance.result.ok).toBe(false);
    const freeze = setWalletStatusTransition(view, { actorId: neha.id, at: AT, walletId: TEEN_WALLET, status: "frozen" });
    expect(freeze.result.ok).toBe(false);
  });

  it("an unlinked parent (the seed starts unlinked) sees only their own wallet", () => {
    const view = viewOf(buildSeedDatabase(), SEED_PARENT_ID);
    expect(view.wallets.map((w) => w.ownerAccountId)).toEqual([SEED_PARENT_ID]);
    expect(getWallet(view, TEEN_WALLET)).toBeNull();
    expect(listTransactions(view, TEEN_WALLET)).toEqual([]);
  });

  it("the linked guardian does see the teen's wallet", () => {
    const view = viewOf(databaseFromState(linkedState()), SEED_PARENT_ID);
    expect(getWallet(view, TEEN_WALLET)?.ownerAccountId).toBe(SEED_TEEN_ID);
    expect(getBalance(view, TEEN_WALLET)).toBe(1850);
  });

  it("a removed (disconnected) guardian loses wallet access; history stays", () => {
    const linked = linkedState();
    const gone = must(disconnectTransition(linked, { actorId: SEED_TEEN_ID, at: AT, teenId: SEED_TEEN_ID }));
    const db = databaseFromState(gone);
    const view = viewOf(db, SEED_PARENT_ID);
    expect(getWallet(view, TEEN_WALLET)).toBeNull();
    expect(
      setWalletStatusTransition(view, { actorId: SEED_PARENT_ID, at: AT, walletId: TEEN_WALLET, status: "frozen" })
        .result.ok,
    ).toBe(false);
    // Nothing financial was removed.
    expect(db.ledger).toEqual(databaseFromState(linked).ledger);
  });

  it("unknown or signed-out actors get no scope and can't mutate", () => {
    const db = buildSeedDatabase();
    expect(scopeFor(db, "")).toBeNull();
    expect(scopeFor(db, "usr_ghost")).toBeNull();
    const s = linkedState();
    const out = payTransition(s, { actorId: "usr_ghost", at: AT, entryId: "g1", recipientId: "rec_riya", amount: 10 });
    expect(out.result.ok).toBe(false);
    expect(out.state).toBe(s);
  });

  it("the repository merge refuses writes outside the scope and history rewrites", () => {
    const { db, kabir } = world();
    const scope = scopeFor(db, kabir.id)!;
    const aaravEntry = db.ledger.find((e) => e.walletId === TEEN_WALLET)!;
    const smuggled: SandboxState = {
      ...scope.state,
      ledger: [...scope.state.ledger, { ...aaravEntry, id: "smuggled" }],
    };
    expect(() => mergeScope(db, scope.info, scope.state, smuggled)).toThrow(LedgerIntegrityError);

    const own = scopeFor(db, SEED_TEEN_ID)!;
    const rewritten: SandboxState = {
      ...own.state,
      ledger: own.state.ledger.map((e) => (e.id === "seed_pay_1" ? { ...e, amount: 1 } : e)),
    };
    expect(() => mergeScope(db, own.info, own.state, rewritten)).toThrow(LedgerIntegrityError);
    const deleted: SandboxState = { ...own.state, ledger: own.state.ledger.slice(1) };
    expect(() => mergeScope(db, own.info, own.state, deleted)).toThrow(LedgerIntegrityError);
  });
});

// ── Store level: a stale screen after sign-out ────────────────────

let sb: SandboxContextValue | null = null;
let auth: AuthContextValue | null = null;

function Capture() {
  sb = useOptionalSandbox();
  auth = useAuth();
  return null;
}

describe("signed-out user (stale UI)", () => {
  it("actions captured before sign-out are refused and write nothing", async () => {
    window.localStorage.clear();
    const service = createSandboxAuthService();
    await service.signIn({ method: "sandbox", accountId: SEED_TEEN_ID, role: "teen" }, Date.now());
    render(
      <AuthProvider service={service}>
        <SandboxProvider>
          <Capture />
        </SandboxProvider>
      </AuthProvider>,
    );
    await vi.waitFor(() => expect(sb).not.toBeNull());
    const stale = sb!.actions;
    // Sign-out records a security event; money records must not change.
    const money = () => {
      const db = JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "{}") as Partial<SandboxDatabase>;
      return JSON.stringify([db.wallets, db.ledger, db.operations, db.teenRecords]);
    };
    const before = money();
    expect((JSON.parse(before) as unknown[][])[1]?.length).toBeGreaterThan(0);

    act(() => auth!.signOut("user"));
    await vi.waitFor(() => expect(sb).toBeNull());

    let result: unknown;
    act(() => {
      result = stale.pay({ idempotencyId: "stale_1", recipientId: "rec_riya", amount: 100 });
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    act(() => {
      result = stale.setWalletFrozen(TEEN_WALLET, true);
    });
    expect(result).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(money()).toBe(before);
  });
});
