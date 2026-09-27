import { describe, expect, it } from "vitest";
import { primaryWalletId } from "@/domain";
import { deriveBalance } from "@/sandbox/engine";
import { isV4Database, migrateV1, migrateV3 } from "@/sandbox/persistence";
import { SANDBOX_SCHEMA_VERSION } from "@/sandbox/types";
import type { LedgerEntry } from "@/domain";
import { createLocalRepository, SANDBOX_BACKUP_KEY, SANDBOX_STORAGE_KEY } from "@/sandbox/repository";
import { buildSeedState, SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { LEGACY_SEED_GOALS, legacySeedLedger } from "./helpers/fixtures";

const NOW = "2026-09-26T08:00:00.000Z";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k) => map.get(k) ?? null,
    key: (i) => [...map.keys()][i] ?? null,
    removeItem: (k) => void map.delete(k),
    setItem: (k, v) => void map.set(k, String(v)),
  };
}

/** A real Phase 4 (v3) database: wallet-less, one teen ledger. */
function v3Database() {
  const seed = buildSeedState();
  return migrateV1(
    {
      version: 1,
      ledger: legacySeedLedger(),
      payments: [],
      requests: [],
      notifications: [],
      recipients: seed.recipients,
      goals: LEGACY_SEED_GOALS,
    },
    buildSeedState,
  );
}

describe("migration — Phase 4 (v3) → Phase 5 (v4 wallets)", () => {
  it("gives every account one wallet and every entry a wallet, account, reference and operation", () => {
    const v3 = v3Database();
    const db = migrateV3(JSON.parse(JSON.stringify(v3)));
    expect(db.version).toBe(4);
    // Phase 6: v4 is an intermediate step now (then v4 → v5).
    expect(isV4Database(db)).toBe(true);
    expect(db.wallets.map((w) => w.ownerAccountId).sort()).toEqual(
      db.accounts.map((a) => a.id).sort(),
    );
    for (const entry of db.ledger) {
      expect(db.wallets.some((w) => w.id === entry.walletId)).toBe(true);
      expect(entry.accountId).toBe(db.wallets.find((w) => w.id === entry.walletId)?.ownerAccountId);
      expect(entry.reference).toMatch(/^[A-Z]{3}-[0-9A-Z]{8}$/);
      expect(entry.status).toBe("completed");
      expect(db.operations.some((op) => op.id === entry.operationId)).toBe(true);
    }
  });

  it("keeps the teen's money exactly and never goes negative", () => {
    const legacy = legacySeedLedger() as { direction: string; amount: number }[];
    const legacyBalance = legacy.reduce(
      (sum, e) => (e.direction === "credit" ? sum + e.amount : sum - e.amount),
      0,
    );
    const db = migrateV3(v3Database());
    // v4 entries use pre-Space types; amounts and directions are what count.
    const ledger = db.ledger as unknown as LedgerEntry[];
    const teen = ledger.filter((e) => e.walletId === primaryWalletId(SEED_TEEN_ID));
    expect(teen).toHaveLength(legacy.length);
    expect(deriveBalance(teen)).toBe(legacyBalance);
    for (const wallet of db.wallets) {
      expect(deriveBalance(ledger.filter((e) => e.walletId === wallet.id))).toBeGreaterThanOrEqual(0);
    }
    // Parents get sandbox starting funds so pocket money has a source.
    const parent = ledger.filter((e) => e.walletId === primaryWalletId(SEED_PARENT_ID));
    expect(parent.some((e) => e.type === "deposit")).toBe(true);
  });

  it("stored v3 data is upgraded on load, with the original backed up first", () => {
    const storage = memoryStorage();
    const raw = JSON.stringify(v3Database());
    storage.setItem(SANDBOX_STORAGE_KEY, raw);
    const { db, outcome } = createLocalRepository(() => storage).load(NOW);
    expect(outcome).toEqual({ kind: "migrated", from: 3 });
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(raw);
    // v3 → v4 → v5 in one load.
    expect(db.version).toBe(SANDBOX_SCHEMA_VERSION);
    // Nothing secret is ever stored.
    expect(storage.getItem(SANDBOX_STORAGE_KEY) ?? "").not.toMatch(/password|token|secret|pin|otp/i);
  });

  it("a v4 database with a wallet-less entry is refused rather than loaded", () => {
    const storage = memoryStorage();
    const db = migrateV3(v3Database());
    const broken = { ...db, ledger: db.ledger.map((e, i) => (i === 0 ? { ...e, walletId: undefined } : e)) };
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(broken));
    const loaded = createLocalRepository(() => storage).load(NOW);
    expect(loaded.outcome.kind).not.toBe("loaded");
    expect(storage.getItem(SANDBOX_BACKUP_KEY)).toBe(JSON.stringify(broken));
  });
});
