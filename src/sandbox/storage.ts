/**
 * Sandbox persistence — the ONLY module that touches localStorage.
 *
 * State is versioned and shape-validated on load: unknown versions or
 * malformed payloads reseed cleanly instead of crashing. Storage is
 * injected as a minimal interface so tests use an in-memory double and
 * the UI never calls localStorage directly.
 */

import type {
  AppNotification,
  LedgerEntry,
  MoneyRequest,
} from "@/domain";
import type { UserId } from "@/domain";

export const SANDBOX_STORAGE_KEY = "teenpay.sandbox.v2";
export const SANDBOX_VERSION = 2;

/** Everything the sandbox persists. No secrets, no real identity data. */
export interface SandboxState {
  version: number;
  walletId: string;
  teenId: UserId;
  /** Append-only — the UI only ever appends via the engine. */
  entries: LedgerEntry[];
  requests: MoneyRequest[];
  notifications: AppNotification[];
  seededAt: string;
  updatedAt: string;
}

export type StorageIssue = "corrupted" | "unavailable";

export interface LoadResult {
  state: SandboxState | null;
  issue: StorageIssue | null;
}

/** Minimal storage surface — localStorage satisfies this. */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

const SPACES = new Set(["spend", "save", "goals"]);
const DIRECTIONS = new Set(["credit", "debit"]);
const ENTRY_STATUSES = new Set(["pending", "posted", "reversed"]);
const REQUEST_STATUSES = new Set(["pending", "paid", "cancelled"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isValidEntry(value: unknown): value is LedgerEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.walletId === "string" &&
    DIRECTIONS.has(value.direction as string) &&
    Number.isInteger(value.amountPaise) &&
    (value.amountPaise as number) >= 0 &&
    Number.isInteger(value.balanceAfterPaise) &&
    typeof value.reason === "string" &&
    SPACES.has(value.space as string) &&
    ENTRY_STATUSES.has(value.status as string) &&
    typeof value.idempotencyKey === "string" &&
    typeof value.title === "string" &&
    isRecord(value.counterparty) &&
    typeof (value.counterparty as Record<string, unknown>).name === "string" &&
    typeof value.category === "string" &&
    isRecord(value.metadata) &&
    typeof value.postedAt === "string"
  );
}

function isValidRequest(value: unknown): value is MoneyRequest {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.requesterId === "string" &&
    typeof value.targetName === "string" &&
    Number.isInteger(value.amountPaise) &&
    (value.amountPaise as number) >= 0 &&
    REQUEST_STATUSES.has(value.status as string) &&
    typeof value.createdAt === "string"
  );
}

function isValidNotification(value: unknown): value is AppNotification {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.kind === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    typeof value.read === "boolean" &&
    typeof value.createdAt === "string"
  );
}

export function isSandboxState(value: unknown): value is SandboxState {
  if (!isRecord(value)) return false;
  return (
    value.version === SANDBOX_VERSION &&
    typeof value.walletId === "string" &&
    typeof value.teenId === "string" &&
    Array.isArray(value.entries) &&
    value.entries.every(isValidEntry) &&
    Array.isArray(value.requests) &&
    value.requests.every(isValidRequest) &&
    Array.isArray(value.notifications) &&
    value.notifications.every(isValidNotification) &&
    typeof value.seededAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

/** Load persisted state. Never throws — issues are reported, not raised. */
export function loadPersistedState(storage: StorageLike | null = defaultStorage()): LoadResult {
  if (!storage) return { state: null, issue: "unavailable" };
  let raw: string | null;
  try {
    raw = storage.getItem(SANDBOX_STORAGE_KEY);
  } catch {
    return { state: null, issue: "unavailable" };
  }
  if (raw === null) return { state: null, issue: null };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isSandboxState(parsed)) return { state: null, issue: "corrupted" };
    return { state: parsed, issue: null };
  } catch {
    return { state: null, issue: "corrupted" };
  }
}

/** Persist state. Returns false when storage is unavailable. */
export function savePersistedState(
  state: SandboxState,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(SANDBOX_STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clearPersistedState(
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.removeItem(SANDBOX_STORAGE_KEY);
  } catch {
    /* already gone or unavailable — nothing to do */
  }
}
