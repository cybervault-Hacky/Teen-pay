import { migrateToCurrent } from "./persistence";
import { buildSeedDatabase, buildSeedState } from "./seed";
import type { SandboxDatabase } from "./types";

/**
 * Repository boundary:
 *
 *   UI ──▶ store (domain transitions) ──▶ SandboxRepository ──▶ data provider
 *
 * Components never touch storage. Today the only provider is this
 * browser's localStorage (or memory, in tests). A cloud repository
 * would implement the same `load`/`save`/`reset` contract against a
 * backend, with the same record ownership as `SandboxDatabase`.
 */

export const SANDBOX_STORAGE_KEY = "teenpay-sandbox-v1";
/** Where unreadable or pre-migration data is kept, never silently lost. */
export const SANDBOX_BACKUP_KEY = "teenpay-sandbox-backup";

export type LoadOutcome =
  /** Nothing stored yet — started from the seed. */
  | { kind: "fresh" }
  | { kind: "loaded" }
  /** Older data was upgraded; the original was backed up first. */
  | { kind: "migrated"; from: 1 | 2 | 3 | 4 }
  /** Stored data couldn't be read; it was backed up and the seed used. */
  | { kind: "recovered" }
  /** Storage isn't available (private mode, disabled) — memory only. */
  | { kind: "unavailable" };

export interface SandboxRepository {
  readonly provider: "sandbox-local" | "sandbox-memory";
  load(now?: string): { db: SandboxDatabase; outcome: LoadOutcome };
  save(db: SandboxDatabase): boolean;
  /** Clears stored data (backups included) and returns the seed. */
  reset(): SandboxDatabase;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createLocalRepository(
  getStorage: () => Storage | null = browserStorage,
  key = SANDBOX_STORAGE_KEY,
): SandboxRepository {
  const backup = (storage: Storage, raw: string) => {
    try {
      storage.setItem(SANDBOX_BACKUP_KEY, raw);
    } catch {
      // Best effort — a full quota must not block recovery.
    }
  };

  return {
    provider: "sandbox-local",
    load(now = new Date().toISOString()) {
      const storage = getStorage();
      if (!storage) return { db: buildSeedDatabase(), outcome: { kind: "unavailable" } };
      let raw: string | null = null;
      try {
        raw = storage.getItem(key);
      } catch {
        return { db: buildSeedDatabase(), outcome: { kind: "unavailable" } };
      }
      if (raw === null) return { db: buildSeedDatabase(), outcome: { kind: "fresh" } };

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        backup(storage, raw);
        return { db: buildSeedDatabase(), outcome: { kind: "recovered" } };
      }
      const result = migrateToCurrent(parsed, { seedView: buildSeedState, now });
      switch (result.kind) {
        case "current":
          return { db: result.db, outcome: { kind: "loaded" } };
        case "migrated":
          backup(storage, raw);
          return { db: result.db, outcome: { kind: "migrated", from: result.from } };
        case "unreadable":
          backup(storage, raw);
          return { db: buildSeedDatabase(), outcome: { kind: "recovered" } };
      }
    },
    save(db) {
      const storage = getStorage();
      if (!storage) return false;
      try {
        storage.setItem(key, JSON.stringify(db));
        return true;
      } catch {
        return false;
      }
    },
    reset() {
      const storage = getStorage();
      try {
        storage?.removeItem(key);
        storage?.removeItem(SANDBOX_BACKUP_KEY);
      } catch {
        // Nothing to clear.
      }
      return buildSeedDatabase();
    },
  };
}

/** In-memory repository for tests and storage-less environments. */
export function createMemoryRepository(initial?: SandboxDatabase): SandboxRepository {
  let stored: SandboxDatabase | null = initial ?? null;
  return {
    provider: "sandbox-memory",
    load() {
      return stored
        ? { db: stored, outcome: { kind: "loaded" } }
        : { db: buildSeedDatabase(), outcome: { kind: "fresh" } };
    },
    save(db) {
      stored = db;
      return true;
    },
    reset() {
      stored = null;
      return buildSeedDatabase();
    },
  };
}

/** Human copy for a load outcome, or null when there's nothing to say. */
export function describeLoadOutcome(outcome: LoadOutcome): string | null {
  switch (outcome.kind) {
    case "migrated":
      return outcome.from === 4
        ? "Your sandbox data was upgraded to add Money Spaces — every balance and transaction was kept."
        : outcome.from === 3
          ? "Your sandbox data was upgraded to the new wallet format — nothing was lost."
          : "Your sandbox data was upgraded to the new account format. Sign in again to continue — nothing was lost.";
    case "recovered":
      return "Saved sandbox data couldn't be read, so the sandbox started fresh. The old data was kept as a backup on this device.";
    case "unavailable":
      return "This browser isn't letting TeenPay save data, so sandbox changes will reset when you close the tab.";
    default:
      return null;
  }
}
