import { act, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { User } from "@/domain";
import { AuthProvider, useAuth, type AuthContextValue } from "@/auth/provider";
import { createSandboxAuthService } from "@/auth/sandbox-service";
import { createAccount } from "@/sandbox/accounts";
import { disconnectTransition, updateGuardianNotificationsTransition } from "@/sandbox/family-transitions";
import { databaseFromState } from "@/sandbox/persistence";
import { LedgerIntegrityError, mergeScope, REDACTED_SPACE_NAME, scopeFor } from "@/sandbox/scope";
import { SEED_GOAL_SPACE_ID, SEED_PARENT_ID, SEED_SAVE_SPACE_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import {
  getSpace,
  listSpaceEntries,
  selectAllocatedTotal,
  selectAvailableBalance,
  selectRecentSpaceActivity,
  selectSpaces,
} from "@/sandbox/selectors";
import {
  archiveSpaceTransition,
  createSpaceTransition,
  moveSpaceMoneyTransition,
  updateSpaceTransition,
} from "@/sandbox/space-transitions";
import { SandboxProvider, useOptionalSandbox, type SandboxContextValue } from "@/sandbox/store";
import { sendAllowanceTransition, type TransitionOutput } from "@/sandbox/transitions";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";
import { AT, linkedState, must, PARENT, SANDBOX_KEY, TEEN_WALLET } from "./helpers/fixtures";

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

/** Aarav ↔ Priya linked (savings notifications on), plus teen Kabir and parent Neha. */
function world() {
  const linked = must(
    updateGuardianNotificationsTransition(linkedState(), {
      ...PARENT,
      teenId: SEED_TEEN_ID,
      payments: true,
      savings: true,
    }),
  );
  let db = databaseFromState(linked);
  const kabir = newAccount(db, "teen", "kabirm");
  db = kabir.db;
  const neha = newAccount(db, "parent", "neha");
  db = neha.db;
  return { db, kabir: kabir.account, neha: neha.account };
}

function viewOf(db: SandboxDatabase, accountId: string): SandboxState {
  const scope = scopeFor(db, accountId);
  if (!scope) throw new Error("no scope");
  return scope.state;
}

/** Runs a transition the way the store does: scope → transition → merge. */
function act_<T>(
  db: SandboxDatabase,
  accountId: string,
  transition: (s: SandboxState) => TransitionOutput<T>,
): { db: SandboxDatabase; out: TransitionOutput<T> } {
  const scope = scopeFor(db, accountId)!;
  const out = transition(scope.state);
  return { db: mergeScope(db, scope.info, scope.state, out.state), out };
}

const money = (db: SandboxDatabase) => JSON.stringify([db.ledger, db.operations, db.spaces]);

describe("Money Space isolation (repository boundary)", () => {
  it("teen A sees only their own Spaces; teen B only theirs (a fresh, empty Save)", () => {
    const { db, kabir } = world();
    const aarav = viewOf(db, SEED_TEEN_ID);
    expect(selectSpaces(aarav, AT).map((s) => s.id)).toEqual([SEED_SAVE_SPACE_ID, SEED_GOAL_SPACE_ID]);
    const kb = viewOf(db, kabir.id);
    expect(kb.spaces.map((s) => s.ownerAccountId)).toEqual([kabir.id]);
    expect(selectSpaces(kb, AT)).toMatchObject([{ name: "Save", balance: 0, isDefault: true }]);
    expect(getSpace(kb, SEED_GOAL_SPACE_ID, AT)).toBeNull();
    expect(listSpaceEntries(kb, SEED_GOAL_SPACE_ID)).toEqual([]);
    expect(kb.ledger.some((e) => e.walletId === TEEN_WALLET)).toBe(false);
  });

  it("teen B can't add to, withdraw from, edit or archive teen A's Space — nothing changes", () => {
    const { db, kabir } = world();
    const at = { actorId: kabir.id, at: AT };
    const attempts: ((s: SandboxState) => TransitionOutput<unknown>)[] = [
      (s) => moveSpaceMoneyTransition(s, { ...at, operationId: "x1", spaceId: SEED_GOAL_SPACE_ID, amount: 1, direction: "add" }),
      (s) => moveSpaceMoneyTransition(s, { ...at, operationId: "x2", spaceId: SEED_GOAL_SPACE_ID, amount: 1, direction: "withdraw" }),
      (s) => updateSpaceTransition(s, { ...at, spaceId: SEED_GOAL_SPACE_ID, name: "Mine now" }),
      (s) => archiveSpaceTransition(s, { ...at, spaceId: SEED_GOAL_SPACE_ID, operationId: "x3" }),
    ];
    for (const attempt of attempts) {
      const { db: after, out } = act_(db, kabir.id, attempt);
      expect(out.result).toMatchObject({
        ok: false,
        error: { code: "unknown_space", message: "This Money Space isn't available." },
      });
      expect(money(after)).toBe(money(db));
    }
  });

  it("even a stale/tampered view holding teen A's Space can't move A's money", () => {
    const { db, kabir } = world();
    const aaravSpace = db.spaces.find((s) => s.id === SEED_GOAL_SPACE_ID)!;
    const scope = scopeFor(db, kabir.id)!;
    const tampered: SandboxState = { ...scope.state, spaces: [...scope.state.spaces, aaravSpace] };
    const out = moveSpaceMoneyTransition(tampered, {
      actorId: kabir.id,
      at: AT,
      operationId: "steal",
      spaceId: SEED_GOAL_SPACE_ID,
      amount: 100,
      direction: "withdraw",
    });
    expect(out.result.ok).toBe(false);
    // And a view that tries to write someone else's Space is refused at merge.
    const renamed: SandboxState = {
      ...tampered,
      spaces: tampered.spaces.map((s) => (s.id === SEED_GOAL_SPACE_ID ? { ...s, name: "Hacked" } : s)),
    };
    expect(() => mergeScope(db, scope.info, tampered, renamed)).toThrow(LedgerIntegrityError);
    expect(() => mergeScope(db, scope.info, scope.state, tampered)).toThrow(LedgerIntegrityError);
  });

  it("the merge refuses deleting a Space, moving it to another wallet, or reusing an id", () => {
    const { db, kabir } = world();
    const own = scopeFor(db, SEED_TEEN_ID)!;
    const deleted: SandboxState = { ...own.state, spaces: own.state.spaces.slice(1) };
    expect(() => mergeScope(db, own.info, own.state, deleted)).toThrow(LedgerIntegrityError);
    const moved: SandboxState = {
      ...own.state,
      spaces: own.state.spaces.map((s) => (s.id === SEED_GOAL_SPACE_ID ? { ...s, walletId: `wal_${kabir.id}` } : s)),
    };
    expect(() => mergeScope(db, own.info, own.state, moved)).toThrow(LedgerIntegrityError);
    const kb = scopeFor(db, kabir.id)!;
    const reuse = must(
      createSpaceTransition(kb.state, {
        actorId: kabir.id,
        at: AT,
        spaceId: SEED_GOAL_SPACE_ID,
        name: "Skates",
        type: "goal",
        icon: "gift",
        targetAmount: 500,
      }),
    );
    expect(() => mergeScope(db, kb.info, kb.state, reuse)).toThrow(LedgerIntegrityError);
  });

  it("the linked parent sees totals only: no Space records, names, ids or targets", () => {
    const { db } = world();
    const parent = viewOf(db, SEED_PARENT_ID);
    expect(parent.spaces).toEqual([]);
    expect(selectSpaces(parent, AT)).toEqual([]);
    expect(selectRecentSpaceActivity(parent)).toEqual([]);
    // Aggregate money is still correct for the parent overview.
    expect(selectAvailableBalance(parent)).toBe(1850);
    expect(selectAllocatedTotal(parent)).toBe(2300);
    const spaceEntries = parent.ledger.filter((e) => e.type === "space_allocation");
    expect(spaceEntries).toHaveLength(2);
    for (const e of spaceEntries) {
      expect(e.spaceId).toBeUndefined();
      expect(e.counterparty.name).toBe(REDACTED_SPACE_NAME);
      expect(e.description).toBe(REDACTED_SPACE_NAME);
    }
    const visible = JSON.stringify([parent.ledger, parent.operations, parent.spaces]);
    expect(visible).not.toMatch(/New Bike|goal_bike|spc_save_usr_aarav/);
  });

  it("the parent can't manage the teen's Spaces, and their own actions keep the teen's records intact", () => {
    const { db } = world();
    const denied = act_(db, SEED_PARENT_ID, (s) =>
      moveSpaceMoneyTransition(s, { ...PARENT, operationId: "p1", spaceId: SEED_GOAL_SPACE_ID, amount: 10, direction: "withdraw" }),
    );
    expect(denied.out.result.ok).toBe(false);
    expect(money(denied.db)).toBe(money(db));
    // A parent action merges back without writing their redacted view
    // over the stored Space entries.
    const sent = act_(db, SEED_PARENT_ID, (s) =>
      sendAllowanceTransition(s, { ...PARENT, operationId: "al_1", amount: 100 }),
    );
    expect(sent.out.result.ok).toBe(true);
    const stored = sent.db.ledger.filter((e) => e.type === "space_allocation");
    expect(stored.map((e) => e.spaceId).sort()).toEqual([SEED_GOAL_SPACE_ID, SEED_SAVE_SPACE_ID]);
    expect(stored.every((e) => e.counterparty.name !== REDACTED_SPACE_NAME)).toBe(true);
    expect(sent.db.spaces).toEqual(db.spaces);
  });

  it("a teen's Space move notifies the parent with the amount, and the parent's view stays redacted", () => {
    const { db } = world();
    const { db: after } = act_(db, SEED_TEEN_ID, (s) =>
      moveSpaceMoneyTransition(s, {
        actorId: SEED_TEEN_ID,
        at: AT,
        operationId: "t1",
        spaceId: SEED_GOAL_SPACE_ID,
        amount: 250,
        direction: "add",
      }),
    );
    const parent = viewOf(after, SEED_PARENT_ID);
    expect(parent.notifications.find((n) => n.title === "Saving progress")?.body).toBe(
      "Aarav set aside ₹250 in a Money Space.",
    );
    expect(selectAllocatedTotal(parent)).toBe(2550);
    expect(JSON.stringify(parent)).not.toMatch(/New Bike/);
  });

  it("a parent in another family and a disconnected parent get no Space data at all", () => {
    const { db, neha } = world();
    const other = viewOf(db, neha.id);
    expect(other.spaces).toEqual([]);
    expect(other.ledger.some((e) => e.walletId === TEEN_WALLET)).toBe(false);

    const disconnected = databaseFromState(
      must(disconnectTransition(linkedState(), { ...PARENT, teenId: SEED_TEEN_ID })),
    );
    const removed = viewOf(disconnected, SEED_PARENT_ID);
    expect(removed.spaces).toEqual([]);
    expect(removed.ledger.some((e) => e.walletId === TEEN_WALLET)).toBe(false);
    // The teen's Spaces and money are untouched by the disconnect.
    expect(selectSpaces(viewOf(disconnected, SEED_TEEN_ID), AT).map((s) => s.balance)).toEqual([800, 1500]);
  });

  it("unknown or signed-out actors get no scope", () => {
    const { db } = world();
    expect(scopeFor(db, "")).toBeNull();
    expect(scopeFor(db, "usr_ghost")).toBeNull();
    const s = linkedState();
    const out = moveSpaceMoneyTransition(s, {
      actorId: "usr_ghost",
      at: AT,
      operationId: "g1",
      spaceId: SEED_SAVE_SPACE_ID,
      amount: 10,
      direction: "add",
    });
    expect(out.result.ok).toBe(false);
    expect(out.state).toBe(s);
  });
});

// ── Store level: stale screen after sign-out ──────────────────────

let sb: SandboxContextValue | null = null;
let auth: AuthContextValue | null = null;

function Capture() {
  sb = useOptionalSandbox();
  auth = useAuth();
  return null;
}

describe("Money Space actions from a stale, signed-out screen", () => {
  it("are refused with not_signed_in and write nothing", async () => {
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
    const stored = () => {
      const db = JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "{}") as Partial<SandboxDatabase>;
      return JSON.stringify([db.ledger, db.operations, db.spaces]);
    };
    const before = stored();

    act(() => auth!.signOut("user"));
    await vi.waitFor(() => expect(sb).toBeNull());

    const results: unknown[] = [];
    act(() => {
      results.push(stale.addToSpace(SEED_SAVE_SPACE_ID, 100, "stale_add"));
      results.push(stale.withdrawFromSpace(SEED_SAVE_SPACE_ID, 100, "stale_back"));
      results.push(stale.createSpace({ name: "Stale", type: "custom", icon: "gift" }));
      results.push(stale.updateSpace(SEED_GOAL_SPACE_ID, { name: "Stale" }));
      results.push(stale.archiveSpace(SEED_GOAL_SPACE_ID));
    });
    for (const r of results) expect(r).toMatchObject({ ok: false, error: { code: "not_signed_in" } });
    expect(stored()).toBe(before);
  });
});
