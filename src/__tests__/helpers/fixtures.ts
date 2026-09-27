import { primaryWalletId, type LedgerEntry } from "@/domain";
import { deriveBalance } from "@/sandbox/engine";
import {
  acceptInviteTransition,
  claimInviteTransition,
  createInviteTransition,
  updateSpendingRulesTransition,
} from "@/sandbox/family-transitions";
import { databaseFromState } from "@/sandbox/persistence";
import { databaseView } from "@/sandbox/scope";
import { buildSeedState, SEED_FAMILY_ID, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import type { SandboxDatabase, SandboxState } from "@/sandbox/types";

/** 26 Sep 2026, 11:30 IST — seed payments are on earlier days. */
export const AT = "2026-09-26T06:00:00Z";
export const TEEN = { actorId: SEED_TEEN_ID, at: AT };
export const PARENT = { actorId: SEED_PARENT_ID, at: AT };

export function must(output: {
  state: SandboxState;
  result: { ok: boolean };
}): SandboxState {
  if (!output.result.ok) {
    throw new Error(`transition failed: ${JSON.stringify(output.result)}`);
  }
  return output.state;
}

/** Seed → teen invite → parent enters code → parent connects. */
export function linkedState(): SandboxState {
  let s = buildSeedState();
  s = must(createInviteTransition(s, { ...TEEN, code: "TEEN-4821" }));
  s = must(claimInviteTransition(s, { ...PARENT, code: "TEEN-4821" }));
  s = must(acceptInviteTransition(s, { ...PARENT, teenId: SEED_TEEN_ID }));
  return s;
}

/** Linked, with rules set by the parent. */
export function withRules(
  rules: {
    daily?: number | null;
    perTx?: number | null;
    threshold?: number | null;
  },
  base: SandboxState = linkedState(),
): SandboxState {
  return must(
    updateSpendingRulesTransition(base, {
      ...PARENT,
      teenId: SEED_TEEN_ID,
      limits: {
        dailyLimit: rules.daily ?? null,
        perTransactionLimit: rules.perTx ?? null,
      },
      approval: { threshold: rules.threshold ?? null },
    }),
  );
}

// ── Phase 4: stored database helpers (UI tests) ───────────────────

export const SANDBOX_KEY = "teenpay-sandbox-v1";

function isDatabase(value: SandboxState | SandboxDatabase): value is SandboxDatabase {
  return "accounts" in value;
}

/** Writes a view (or a whole database) to storage (current schema). */
export function preloadDatabase(value: SandboxState | SandboxDatabase): void {
  const db = isDatabase(value) ? value : databaseFromState(value);
  window.localStorage.setItem(SANDBOX_KEY, JSON.stringify(db));
}

/** The stored database (current schema). */
export function storedDatabase(): SandboxDatabase {
  return JSON.parse(window.localStorage.getItem(SANDBOX_KEY) ?? "null") as SandboxDatabase;
}

/** The stored seed family as one engine-level view. */
export function storedView(): SandboxState {
  return databaseView(storedDatabase(), SEED_FAMILY_ID, SEED_TEEN_ID);
}

// ── Phase 5: wallet-aware probes ──────────────────────────────────
// Views and the database hold every visible wallet's entries (a
// parent now has a wallet too), so money probes pick a wallet.

export const TEEN_WALLET = primaryWalletId(SEED_TEEN_ID);
export const PARENT_WALLET = primaryWalletId(SEED_PARENT_ID);

type HasLedger = { ledger: LedgerEntry[] };

/** Entries of one account's primary wallet (default: the seed teen). */
export function walletLedger(source: HasLedger, accountId: string = SEED_TEEN_ID): LedgerEntry[] {
  const walletId = primaryWalletId(accountId);
  return source.ledger.filter((e) => e.walletId === walletId);
}

/** The seed teen's entries. */
export function teenLedger(source: HasLedger): LedgerEntry[] {
  return walletLedger(source, SEED_TEEN_ID);
}

/** The seed teen's derived balance. */
export function teenBalance(source: HasLedger): number {
  return deriveBalance(teenLedger(source));
}

/** A derived balance for any account's primary wallet. */
export function balanceOf(source: HasLedger, accountId: string): number {
  return deriveBalance(walletLedger(source, accountId));
}

/** The seed goal as Phases 2–5 stored it (a goal record, not a Space). */
export const LEGACY_SEED_GOALS = [
  { id: "goal_bike", title: "New Bike", target: 2500, deadline: "Nov 30" },
];

/**
 * The seed teen's entries in the pre-wallet (v1–v3) stored shape —
 * what Phase 2–4 data really looked like, for migration tests.
 */
export function legacySeedLedger(): Record<string, unknown>[] {
  return toLegacyEntries(teenLedger(buildSeedState()));
}

/**
 * Wallet entries → the pre-wallet stored shape (one per operation).
 * Money Space moves become what Phases 2–5 stored: Save moves as
 * `save_allocation` (counterparty kind "save") and goal moves as
 * `goal_allocation` with a goalId. (Moving money back didn't exist.)
 */
export function toLegacyEntries(entries: LedgerEntry[]): Record<string, unknown>[] {
  return entries.map((e) => {
    const base = {
      id: e.operationId,
      direction: e.direction,
      amount: e.amount,
      currency: e.currency,
      ...(e.requestId ? { requestId: e.requestId } : {}),
      createdAt: e.createdAt,
    };
    if (e.type === "space_release") throw new Error("No legacy shape for moving money back");
    if (e.type !== "space_allocation") {
      return { ...base, type: e.type, description: e.description, counterparty: e.counterparty };
    }
    return e.spaceId?.startsWith("spc_save_")
      ? {
          ...base,
          type: "save_allocation",
          description: "Moved to Save",
          counterparty: { kind: "save", id: "space_save", name: "Save" },
        }
      : {
          ...base,
          type: "goal_allocation",
          description: "Goal top-up",
          counterparty: { kind: "goal", id: e.spaceId, name: e.counterparty.name },
          goalId: e.spaceId,
        };
  });
}
