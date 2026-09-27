import {
  checkMoney,
  defaultSaveSpaceId,
  isOpenSchedule,
  pocketMoneyExecutionId,
  POCKET_MONEY_DAY_OF_MONTH_MAX,
  INVITE_TTL_MS,
  isCalendarDate,
  isSpaceIcon,
  MAX_SPACE_TARGET,
  primaryWalletId,
  productDay,
  SANDBOX_CURRENCY,
  SPACE_NAME_MAX,
  type AppNotification,
  type ApprovalRequest,
  type Family,
  type FamilyInvite,
  type FamilyMembership,
  type GuardianLink,
  type LedgerEntry,
  type LedgerEntryType,
  type MoneyOperation,
  type MoneyOperationType,
  type MoneyRequest,
  type MoneySpace,
  type OperationLeg,
  type PocketMoneySchedule,
  type Recipient,
  type User,
  type Wallet,
} from "@/domain";
import { ENTRY_RULES } from "./engine";
import { maybePrimaryTeen } from "./identity";
import { depositDraft, postOperation, referenceFor } from "./operations";
import {
  PARENT_STARTING_FUNDS,
  SANDBOX_SCHEMA_VERSION,
  type FamilyLog,
  type SandboxDatabase,
  type SandboxState,
} from "./types";

/**
 * Validation and migration for persisted sandbox data.
 *
 *   v1 (Phase 2) ──migrateV1──▶ v3 ─┐
 *   v2 (Phase 3) ──migrateV2──▶ v3 ─┼─migrateV3──▶ v4 ─migrateV4──▶ v5 ─migrateV5──▶ v6 (current)
 *   v3 (Phase 4) ───────────────────┘              ▲                 ▲
 *   v4 (Phase 5) ──────────────────────────────────┘                 │
 *   v5 (Phase 6) ────────────────────────────────────────────────────┘
 *
 * Every step keeps the money history: no entry is dropped or changed
 * in amount, direction or date. Anything that fails validation takes
 * the repository's recovery path (backup + fresh seed), never a
 * silent partial load.
 *
 * Nothing secret is ever persisted: fictional accounts, simulated
 * money and family records only. Sessions live in the auth layer's
 * own key and hold no credentials.
 */

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isArrayOf(value: unknown, guard: (item: unknown) => boolean): value is unknown[] {
  return Array.isArray(value) && value.every(guard);
}

// ── Legacy (v1–v4) vocabulary ─────────────────────────────────────

/** A goal as stored before Money Spaces (v1–v4). */
interface SavingsGoalDefinition {
  id: string;
  title: string;
  /** Whole rupees needed. */
  target: number;
  /** Free text, e.g. "Nov 30". */
  deadline?: string;
}

/** Entry types before Money Spaces: Save and goals were separate. */
type LegacyEntryType =
  | Exclude<LedgerEntryType, "space_allocation" | "space_release">
  | "save_allocation"
  | "goal_allocation";

const V4_ENTRY_TYPES: ReadonlySet<string> = new Set<LegacyEntryType>([
  "deposit",
  "allowance_credit",
  "allowance_debit",
  "payment_sent",
  "payment_received",
  "transfer_out",
  "transfer_in",
  "refund",
  "reversal",
  "adjustment",
  "save_allocation",
  "goal_allocation",
]);

interface LegacyCounterparty {
  kind: string;
  id: string;
  name: string;
}

/** A v4 ledger entry (wallet-aware, pre-Spaces). */
interface V4Entry
  extends Omit<LedgerEntry, "type" | "counterparty" | "spaceId"> {
  type: LegacyEntryType;
  counterparty: LegacyCounterparty;
  goalId?: string;
}

interface V4Leg extends Omit<OperationLeg, "external"> {
  external?: LegacyCounterparty;
}

interface V4Operation extends Omit<MoneyOperation, "type" | "legs"> {
  type: Exclude<MoneyOperationType, "space"> | "allocation";
  legs: V4Leg[];
}

/** Schema v4 (Phase 5), as far as migration needs it. */
export interface V4Database {
  version: 4;
  accounts: User[];
  families: Family[];
  wallets: Wallet[];
  ledger: V4Entry[];
  operations: V4Operation[];
  teenRecords: {
    teenId: string;
    requests: MoneyRequest[];
    approvals: ApprovalRequest[];
    goals: SavingsGoalDefinition[];
  }[];
  notifications: AppNotification[];
  familyLogs: FamilyLog[];
  securityEvents: SandboxDatabase["securityEvents"];
  recipients: Recipient[];
}

/** Schema v5 (Phase 6): v6 without pocket money schedules. */
export interface V5Database extends Omit<SandboxDatabase, "version" | "pocketMoneySchedules"> {
  version: 5;
}

/** The Phase 3 preview, as stored inside guardian controls up to v5. */
interface LegacyControlsAllowance {
  amount: unknown;
  frequency: unknown;
  weekday: unknown;
  dayOfMonth: unknown;
}

function isLedgerEntryLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.amount === "number" &&
    Number.isInteger(value.amount) &&
    value.amount > 0 &&
    (value.direction === "credit" || value.direction === "debit") &&
    typeof value.createdAt === "string" &&
    isRecord(value.counterparty)
  );
}

function isUserLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    (value.role === "teen" || value.role === "parent") &&
    typeof value.displayName === "string" &&
    typeof value.username === "string"
  );
}

function isAccountLike(value: unknown): boolean {
  return (
    isUserLike(value) &&
    isRecord(value) &&
    typeof value.identifier === "string" &&
    typeof value.updatedAt === "string" &&
    (value.status === "active" || value.status === "suspended" || value.status === "closed")
  );
}

function isNotificationLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.recipientId === "string" &&
    typeof value.title === "string"
  );
}

function isMembershipLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.accountId === "string" &&
    (value.role === "teen" || value.role === "guardian") &&
    (value.status === "pending" || value.status === "active" || value.status === "removed")
  );
}

function isFamilyLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isArrayOf(value.members, isMembershipLike) &&
    isArrayOf(value.links, (l) => isRecord(l) && typeof l.teenId === "string") &&
    Array.isArray(value.controls) &&
    isArrayOf(value.invites, (i) => isRecord(i) && typeof i.code === "string")
  );
}

function isLegacyWalletLike(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.teenId === "string" &&
    isArrayOf(value.ledger, isLedgerEntryLike) &&
    Array.isArray(value.payments) &&
    Array.isArray(value.requests) &&
    Array.isArray(value.approvals) &&
    Array.isArray(value.goals)
  );
}

function hasValidAccountsAndFamilies(value: UnknownRecord): Set<unknown> | null {
  if (!isArrayOf(value.accounts, isAccountLike) || value.accounts.length === 0) return null;
  const ids = new Set((value.accounts as UnknownRecord[]).map((a) => a.id));
  const usernames = (value.accounts as UnknownRecord[]).map((a) => a.username);
  if (new Set(usernames).size !== usernames.length) return null;
  if (!isArrayOf(value.families, isFamilyLike)) return null;
  // Every membership must point at a real account.
  for (const family of value.families as UnknownRecord[]) {
    for (const m of family.members as UnknownRecord[]) {
      if (!ids.has(m.accountId)) return null;
    }
  }
  return ids;
}

function hasValidSideRecords(value: UnknownRecord): boolean {
  return (
    isArrayOf(value.notifications, isNotificationLike) &&
    isArrayOf(value.familyLogs, (l) => isRecord(l) && Array.isArray(l.events)) &&
    Array.isArray(value.securityEvents) &&
    Array.isArray(value.recipients)
  );
}

/** Schema v3 (Phase 4) — per-teen wallets holding their own ledger. */
export function isV3Database(value: unknown): value is UnknownRecord {
  if (!isRecord(value) || value.version !== 3) return false;
  if (!hasValidAccountsAndFamilies(value)) return false;
  return isArrayOf(value.wallets, isLegacyWalletLike) && hasValidSideRecords(value);
}

const WALLET_STATUSES = new Set(["active", "frozen", "closed"]);

function isWalletRecord(value: unknown, accountIds: Set<unknown>): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    accountIds.has(value.ownerAccountId) &&
    value.kind === "primary" &&
    value.currency === SANDBOX_CURRENCY &&
    WALLET_STATUSES.has(String(value.status)) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string"
  );
}

function isLedgerEntryRecord(
  value: unknown,
  walletOwners: Map<unknown, unknown>,
  entryTypes: (type: string) => boolean,
): boolean {
  return (
    isLedgerEntryLike(value) &&
    isRecord(value) &&
    checkMoney(value.amount, { currency: String(value.currency) }) === null &&
    typeof value.type === "string" &&
    entryTypes(value.type) &&
    walletOwners.has(value.walletId) &&
    walletOwners.get(value.walletId) === value.accountId &&
    typeof value.operationId === "string" &&
    typeof value.reference === "string" &&
    value.status === "completed" &&
    typeof value.createdBy === "string"
  );
}

function isOperationRecord(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.reference === "string" &&
    typeof value.type === "string" &&
    typeof value.actorId === "string" &&
    isArrayOf(value.legs, (l) => isRecord(l) && typeof l.amount === "number")
  );
}

const SPACE_TYPES = new Set(["save", "goal", "custom"]);

function isSpaceRecord(
  value: unknown,
  accountIds: Set<unknown>,
  walletOwners: Map<unknown, unknown>,
): boolean {
  if (!isRecord(value)) return false;
  const target = value.targetAmount;
  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    accountIds.has(value.ownerAccountId) &&
    walletOwners.get(value.walletId) === value.ownerAccountId &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    value.name.length <= SPACE_NAME_MAX &&
    SPACE_TYPES.has(String(value.type)) &&
    isSpaceIcon(value.icon) &&
    (value.status === "active" || value.status === "archived") &&
    typeof value.displayOrder === "number" &&
    Number.isInteger(value.displayOrder) &&
    typeof value.createdAt === "string" &&
    typeof value.updatedAt === "string" &&
    (target === undefined || checkMoney(target, { max: MAX_SPACE_TARGET }) === null) &&
    (value.type !== "goal" || target !== undefined) &&
    (value.deadline === undefined || isCalendarDate(value.deadline))
  );
}

/**
 * The shared ledger integrity walk: wallets, unique operations and
 * entries, every entry's operation recorded, and no wallet's running
 * balance ever below ₹0. Returns the wallet owners, or null.
 */
function ledgerIntegrity(
  value: UnknownRecord,
  accountIds: Set<unknown>,
  entryTypes: (type: string) => boolean,
): Map<unknown, unknown> | null {
  if (!isArrayOf(value.wallets, (w) => isWalletRecord(w, accountIds))) return null;
  const wallets = value.wallets as UnknownRecord[];
  const owners = new Map(wallets.map((w) => [w.id, w.ownerAccountId]));
  if (owners.size !== wallets.length) return null;

  if (!isArrayOf(value.operations, isOperationRecord)) return null;
  const operationIds = new Set((value.operations as UnknownRecord[]).map((op) => op.id));
  if (operationIds.size !== (value.operations as unknown[]).length) return null;

  if (!isArrayOf(value.ledger, (e) => isLedgerEntryRecord(e, owners, entryTypes))) return null;
  const entries = value.ledger as UnknownRecord[];
  if (new Set(entries.map((e) => e.id)).size !== entries.length) return null;
  const running = new Map<unknown, number>();
  for (const e of entries) {
    if (!operationIds.has(e.operationId)) return null;
    const next = (running.get(e.walletId) ?? 0) + (e.direction === "credit" ? 1 : -1) * Number(e.amount);
    if (next < 0) return null;
    running.set(e.walletId, next);
  }
  return owners;
}

/** Schema v4 (Phase 5) — wallets + ledger, before Money Spaces. */
export function isV4Database(value: unknown): value is UnknownRecord {
  if (!isRecord(value) || value.version !== 4) return false;
  const accountIds = hasValidAccountsAndFamilies(value);
  if (!accountIds || !hasValidSideRecords(value)) return false;
  if (!ledgerIntegrity(value, accountIds, (t) => V4_ENTRY_TYPES.has(t))) return false;
  return isArrayOf(
    value.teenRecords,
    (r) =>
      isRecord(r) &&
      typeof r.teenId === "string" &&
      Array.isArray(r.requests) &&
      Array.isArray(r.approvals) &&
      Array.isArray(r.goals),
  );
}

/**
 * Checks shared by v5 and v6. Beyond shape checks it verifies ledger
 * integrity (see `ledgerIntegrity`) and Money Space integrity: every
 * Space owned by a real account on that account's wallet; every Space
 * entry naming a Space on the same wallet (and only Space entries
 * naming one); and no Space's running balance ever below ₹0.
 * Returns the wallet owners, or null.
 */
function coreIntegrity(value: UnknownRecord): Map<unknown, unknown> | null {
  const accountIds = hasValidAccountsAndFamilies(value);
  if (!accountIds || !hasValidSideRecords(value)) return null;
  const owners = ledgerIntegrity(value, accountIds, (t) => Object.hasOwn(ENTRY_RULES, t));
  if (!owners) return null;

  if (!isArrayOf(value.spaces, (sp) => isSpaceRecord(sp, accountIds, owners))) return null;
  const spaces = value.spaces as UnknownRecord[];
  const spaceWallet = new Map(spaces.map((sp) => [sp.id, sp.walletId]));
  if (spaceWallet.size !== spaces.length) return null;
  const held = new Map<unknown, number>();
  for (const e of value.ledger as UnknownRecord[]) {
    const isSpaceMove = e.type === "space_allocation" || e.type === "space_release";
    if (!isSpaceMove) {
      if (e.spaceId !== undefined) return null;
      continue;
    }
    if (spaceWallet.get(e.spaceId) !== e.walletId) return null;
    const next = (held.get(e.spaceId) ?? 0) + (e.type === "space_allocation" ? 1 : -1) * Number(e.amount);
    if (next < 0) return null;
    held.set(e.spaceId, next);
  }

  const recordsOk = isArrayOf(
    value.teenRecords,
    (r) =>
      isRecord(r) &&
      typeof r.teenId === "string" &&
      Array.isArray(r.requests) &&
      Array.isArray(r.approvals),
  );
  return recordsOk ? owners : null;
}

/** Schema v5 (Phase 6) — Money Spaces, before pocket money schedules. */
export function isV5Database(value: unknown): value is UnknownRecord {
  if (!isRecord(value) || value.version !== 5) return false;
  if (!coreIntegrity(value)) return false;
  // v5 never had scheduled pocket money in the ledger.
  return (value.ledger as UnknownRecord[]).every((e) => e.scheduleId === undefined);
}

const SCHEDULE_STATUSES = new Set(["active", "paused", "completed", "cancelled"]);
const END_REASONS = new Set(["cancelled", "family_disconnected", "end_date_reached"]);
const FAILURE_REASONS = new Set([
  "insufficient_funds",
  "source_frozen",
  "source_closed",
  "destination_frozen",
  "destination_closed",
  "wallet_unavailable",
  "rejected",
]);

function isIsoInstant(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * One stored schedule: real parent and teen accounts in a real family,
 * the parent's wallet → the teen's wallet, a valid plan, a coherent
 * status, and an append-only run history whose completed runs each
 * point at the scheduled `allowance` operation that paid them.
 */
function isScheduleRecord(
  value: unknown,
  accounts: Map<unknown, unknown>,
  familyIds: Set<unknown>,
  owners: Map<unknown, unknown>,
  operations: Map<unknown, UnknownRecord>,
): boolean {
  if (!isRecord(value)) return false;
  const id = value.id;
  if (typeof id !== "string" || id.length === 0) return false;
  if (!familyIds.has(value.familyId)) return false;
  if (accounts.get(value.parentAccountId) !== "parent") return false;
  if (accounts.get(value.teenAccountId) !== "teen") return false;
  if (owners.get(value.sourceWalletId) !== value.parentAccountId) return false;
  if (owners.get(value.destinationWalletId) !== value.teenAccountId) return false;
  if (checkMoney(value.amount) !== null || value.currency !== SANDBOX_CURRENCY) return false;
  if (value.frequency !== "weekly" && value.frequency !== "monthly") return false;
  const dow = value.dayOfWeek;
  const dom = value.dayOfMonth;
  if (typeof dow !== "number" || !Number.isInteger(dow) || dow < 0 || dow > 6) return false;
  if (typeof dom !== "number" || !Number.isInteger(dom) || dom < 1 || dom > POCKET_MONEY_DAY_OF_MONTH_MAX) return false;
  if (!isCalendarDate(value.startDate)) return false;
  if (value.endDate !== undefined && (!isCalendarDate(value.endDate) || value.endDate < value.startDate)) return false;
  if (!SCHEDULE_STATUSES.has(String(value.status))) return false;
  if (value.status === "active" ? !isIsoInstant(value.nextRunAt) : value.nextRunAt !== null) return false;
  const ended = value.status === "completed" || value.status === "cancelled";
  if (ended ? !END_REASONS.has(String(value.endedReason)) : value.endedReason !== undefined) return false;
  if (!isIsoInstant(value.createdAt) || !isIsoInstant(value.updatedAt)) return false;
  if (value.lastRunAt !== undefined && !isIsoInstant(value.lastRunAt)) return false;
  if (value.createdBy !== value.parentAccountId) return false;
  const version = value.version;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) return false;
  if (!isIsoInstant(value.linkedAt)) return false;
  if (!Array.isArray(value.runs)) return false;
  const seen = new Set<string>();
  for (const run of value.runs as unknown[]) {
    if (!isRecord(run) || !isCalendarDate(run.occurrence)) return false;
    const runId = pocketMoneyExecutionId(id, run.occurrence);
    if (run.id !== runId || run.scheduleId !== id || seen.has(runId)) return false;
    seen.add(runId);
    if (checkMoney(run.amount) !== null || !isIsoInstant(run.at)) return false;
    if (run.status === "completed") {
      const op = operations.get(runId);
      if (
        !op ||
        run.operationId !== runId ||
        op.type !== "allowance" ||
        op.scheduleId !== id ||
        op.scheduledFor !== run.occurrence ||
        op.amount !== run.amount ||
        run.reference !== op.reference
      ) {
        return false;
      }
    } else if (run.status === "failed") {
      if (!FAILURE_REASONS.has(String(run.reason)) || typeof run.message !== "string") return false;
      // A failed occurrence never has money behind it.
      if (operations.has(runId)) return false;
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Schema v6 — the only shape that is saved. Everything v5 checks
 * (see `coreIntegrity`), plus pocket money: every schedule valid (see
 * `isScheduleRecord`), unique ids, at most one open schedule per
 * parent and teen, and every scheduled ledger entry an allowance entry
 * of a known schedule on that schedule's wallets. Tampering is
 * rejected, not loaded.
 */
export function isSandboxDatabase(value: unknown): value is SandboxDatabase {
  if (!isRecord(value) || value.version !== SANDBOX_SCHEMA_VERSION) return false;
  const owners = coreIntegrity(value);
  if (!owners) return false;

  const accounts = new Map((value.accounts as UnknownRecord[]).map((a) => [a.id, a.role]));
  const familyIds = new Set((value.families as UnknownRecord[]).map((f) => f.id));
  const operations = new Map((value.operations as UnknownRecord[]).map((op) => [op.id, op]));
  if (
    !isArrayOf(value.pocketMoneySchedules, (sc) =>
      isScheduleRecord(sc, accounts, familyIds, owners, operations),
    )
  ) {
    return false;
  }
  const schedules = value.pocketMoneySchedules as unknown as PocketMoneySchedule[];
  const byId = new Map(schedules.map((sc) => [sc.id, sc]));
  if (byId.size !== schedules.length) return false;
  const openPairs = schedules
    .filter((sc) => isOpenSchedule(sc))
    .map((sc) => `${sc.parentAccountId}>${sc.teenAccountId}`);
  if (new Set(openPairs).size !== openPairs.length) return false;

  for (const e of value.ledger as UnknownRecord[]) {
    if (e.scheduleId === undefined && e.scheduledFor === undefined) continue;
    const schedule = byId.get(e.scheduleId as string);
    if (!schedule) return false;
    if (e.type === "allowance_debit" ? e.walletId !== schedule.sourceWalletId : e.type === "allowance_credit" ? e.walletId !== schedule.destinationWalletId : true) {
      return false;
    }
    if (e.operationId !== pocketMoneyExecutionId(schedule.id, String(e.scheduledFor))) return false;
  }
  for (const op of operations.values()) {
    if (op.scheduleId === undefined) continue;
    const schedule = byId.get(op.scheduleId as string);
    if (!schedule || !schedule.runs.some((r) => r.id === op.id && r.status === "completed")) return false;
  }
  return true;
}

/** A Phase 3 (v2) payload. */
export function isV2State(value: unknown): value is UnknownRecord {
  if (!isRecord(value) || value.version !== 2) return false;
  const { family, session, users } = value;
  if (!isArrayOf(users, isUserLike) || users.length === 0) return false;
  if (!isRecord(session) || typeof session.currentUserId !== "string") return false;
  if (
    !isRecord(family) ||
    typeof family.id !== "string" ||
    !Array.isArray(family.members) ||
    !Array.isArray(family.links) ||
    !Array.isArray(family.controls)
  ) {
    return false;
  }
  return (
    isArrayOf(value.ledger, isLedgerEntryLike) &&
    Array.isArray(value.payments) &&
    Array.isArray(value.requests) &&
    Array.isArray(value.approvals) &&
    isArrayOf(value.notifications, isNotificationLike) &&
    Array.isArray(value.familyEvents) &&
    Array.isArray(value.recipients) &&
    Array.isArray(value.goals)
  );
}

/** A Phase 2 (v1) payload, as far as migration needs it. */
export function isV1State(value: unknown): value is UnknownRecord {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isArrayOf(value.ledger, isLedgerEntryLike) &&
    Array.isArray(value.payments) &&
    Array.isArray(value.requests) &&
    Array.isArray(value.notifications) &&
    Array.isArray(value.recipients) &&
    Array.isArray(value.goals)
  );
}

// ── Legacy (v1–v3) shapes ─────────────────────────────────────────

/** A ledger entry as stored before wallets existed (v1–v3). */
interface LegacyEntry {
  id: string;
  type: LegacyEntryType;
  direction: LedgerEntry["direction"];
  amount: number;
  currency: string;
  description: string;
  counterparty: LegacyCounterparty;
  goalId?: string;
  requestId?: string;
  createdAt: string;
}

interface LegacyPayment {
  id: string;
  approvalId?: string;
}

interface LegacyTeenWallet {
  teenId: string;
  ledger: LegacyEntry[];
  payments: LegacyPayment[];
  requests: MoneyRequest[];
  approvals: ApprovalRequest[];
  goals: SavingsGoalDefinition[];
}

interface V3Database {
  version: 3;
  accounts: User[];
  families: Family[];
  wallets: LegacyTeenWallet[];
  notifications: AppNotification[];
  familyLogs: FamilyLog[];
  securityEvents: SandboxDatabase["securityEvents"];
  recipients: Recipient[];
}

/**
 * v1 → v3: keep the money history (ledger, payments, requests,
 * recipients, goals, notifications); take accounts and an unlinked
 * family from the seed. Old notifications belonged to the teen.
 */
export function migrateV1(v1: UnknownRecord, seed: () => SandboxState): V3Database {
  const base = seed();
  const teenId = maybePrimaryTeen(base)?.id ?? base.session.currentUserId;
  const notifications = (v1.notifications as unknown[]).filter(isRecord).map(
    (n): AppNotification => ({
      id: String(n.id),
      recipientId: teenId,
      kind:
        n.kind === "goal" || n.kind === "safety" || n.kind === "system" ? n.kind : "money",
      title: String(n.title ?? ""),
      body: String(n.body ?? ""),
      read: n.read === true,
      createdAt: String(n.createdAt ?? new Date(0).toISOString()),
    }),
  );
  return {
    version: 3,
    accounts: base.users,
    families: [base.family],
    wallets: [
      {
        teenId,
        ledger: v1.ledger as LegacyEntry[],
        payments: v1.payments as LegacyPayment[],
        requests: v1.requests as MoneyRequest[],
        approvals: [],
        goals: v1.goals as SavingsGoalDefinition[],
      },
    ],
    notifications,
    familyLogs: [{ familyId: base.family.id, events: [] }],
    securityEvents: [],
    recipients: v1.recipients as Recipient[],
  };
}

/** One family view → a current database (used by tests and tooling). */
export function databaseFromState(state: SandboxState): SandboxDatabase {
  const teenId = maybePrimaryTeen(state)?.id ?? "";
  return {
    version: SANDBOX_SCHEMA_VERSION,
    accounts: state.users,
    families: [state.family],
    wallets: state.wallets,
    ledger: state.ledger,
    operations: state.operations,
    spaces: state.spaces,
    pocketMoneySchedules: state.schedules,
    teenRecords: [{ teenId, requests: state.requests, approvals: state.approvals }],
    notifications: state.notifications,
    familyLogs: [{ familyId: state.family.id, events: state.familyEvents }],
    securityEvents: [],
    recipients: state.recipients,
  };
}

/**
 * v2 → v3. Accounts gain identifier/updatedAt; family members become
 * memberships; the embedded invite becomes an invite record (given a
 * fresh expiry from `now`, so an in-flight invite survives the
 * upgrade); the v2 session pointer is dropped — sessions belong to
 * the auth layer now, so people simply sign in again. Money data is
 * carried over untouched.
 */
export function migrateV2(v2: UnknownRecord, now: string): V3Database {
  const users = (v2.users as UnknownRecord[]).map(
    (u): User => ({
      ...(u as unknown as User),
      identifier: `sandbox:${String(u.username)}`,
      createdAt: String(u.createdAt ?? now),
      updatedAt: String(u.createdAt ?? now),
    }),
  );
  const f = v2.family as UnknownRecord;
  const familyId = String(f.id);
  const createdAt = users[0]?.createdAt ?? now;

  const members: FamilyMembership[] = (f.members as UnknownRecord[]).map((m) => ({
    id: `mem_${familyId}_${String(m.userId)}`,
    familyId,
    accountId: String(m.userId),
    role: m.role === "guardian" ? "guardian" : "teen",
    ...(m.relationship === "parent" || m.relationship === "guardian"
      ? { relationship: m.relationship }
      : {}),
    status: "active",
    createdAt: String(m.joinedAt ?? createdAt),
    updatedAt: String(m.joinedAt ?? createdAt),
  }));

  const invites: FamilyInvite[] = [];
  const links: GuardianLink[] = (f.links as UnknownRecord[]).map((l) => {
    const teenId = String(l.teenId);
    const oldInvite = isRecord(l.invite) ? l.invite : null;
    let inviteId: string | null = null;
    if (oldInvite && (l.status === "invitation_created" || l.status === "invitation_pending")) {
      const claimedBy = typeof oldInvite.claimedBy === "string" ? oldInvite.claimedBy : undefined;
      inviteId = `inv_${teenId}_${String(oldInvite.code)}_migrated`;
      invites.push({
        id: inviteId,
        familyId,
        teenId,
        inviterId: teenId,
        intendedRelationship: "parent",
        code: String(oldInvite.code),
        status: claimedBy ? "claimed" : "open",
        createdAt: String(oldInvite.createdAt ?? now),
        expiresAt: new Date(Date.parse(now) + INVITE_TTL_MS).toISOString(),
        ...(claimedBy ? { claimedBy } : {}),
      });
      if (claimedBy && !members.some((m) => m.accountId === claimedBy)) {
        members.push({
          id: `mem_${familyId}_${claimedBy}`,
          familyId,
          accountId: claimedBy,
          role: "guardian",
          relationship: "parent",
          status: "pending",
          createdAt: now,
          updatedAt: now,
        });
      }
    }
    return {
      teenId,
      status: l.status as GuardianLink["status"],
      guardianId: typeof l.guardianId === "string" ? l.guardianId : null,
      inviteId,
      ...(typeof l.linkedAt === "string" ? { linkedAt: l.linkedAt } : {}),
      ...(typeof l.disconnectedAt === "string" ? { disconnectedAt: l.disconnectedAt } : {}),
      updatedAt: String(l.updatedAt ?? now),
    };
  });

  const family: Family = {
    id: familyId,
    name: String(f.name ?? "Family"),
    members,
    links,
    controls: f.controls as Family["controls"],
    invites,
    createdAt,
  };
  const teenId = members.find((m) => m.role === "teen")?.accountId ?? "";

  return {
    version: 3,
    accounts: users,
    families: [family],
    wallets: [
      {
        teenId,
        ledger: v2.ledger as LegacyEntry[],
        payments: v2.payments as LegacyPayment[],
        requests: v2.requests as MoneyRequest[],
        approvals: v2.approvals as ApprovalRequest[],
        goals: v2.goals as SavingsGoalDefinition[],
      },
    ],
    notifications: v2.notifications as AppNotification[],
    familyLogs: [{ familyId, events: v2.familyEvents as FamilyLog["events"] }],
    securityEvents: [],
    recipients: v2.recipients as Recipient[],
  };
}

const LEGACY_OPERATION_TYPE: Record<LegacyEntryType, V4Operation["type"]> = {
  deposit: "deposit",
  allowance_credit: "allowance",
  allowance_debit: "allowance",
  payment_sent: "payment",
  payment_received: "request_settlement",
  transfer_out: "transfer",
  transfer_in: "transfer",
  refund: "refund",
  reversal: "reversal",
  adjustment: "adjustment",
  save_allocation: "allocation",
  goal_allocation: "allocation",
};

/**
 * v4 references. Allocations were "MOV-…" before Phase 6 (they keep
 * that prefix forever — references never change).
 */
function legacyReference(
  type: V4Operation["type"],
  operationId: string,
  taken: ReadonlySet<string>,
): string {
  if (type !== "allocation") return referenceFor(type, operationId, taken);
  const asSpace = new Set([...taken].map((r) => r.replace(/^MOV-/, "SPC-")));
  return referenceFor("space", operationId, asSpace).replace(/^SPC-/, "MOV-");
}

/**
 * The other side of a legacy entry. Pocket money recorded before
 * wallets existed had no source wallet, so it's attributed to
 * sandbox funding — explicitly, rather than inventing a debit on the
 * guardian's wallet after the fact.
 */
function legacyContra(entry: LegacyEntry): LegacyCounterparty {
  return entry.type === "allowance_credit"
    ? { kind: "sandbox", id: "sandbox_legacy_funding", name: "Sandbox funding (before wallets)" }
    : entry.counterparty;
}

/**
 * v3 → v4. Every account gets a primary wallet; each teen's legacy
 * entries move into the global ledger unchanged in amount, direction,
 * type and date, gaining walletId/accountId/operationId/reference/
 * status/createdBy; each becomes a recorded operation (payments keep
 * their approval link). Parent wallets receive the standard sandbox
 * starting funds. Requests, approvals and goals move to teen records.
 */
export function migrateV3(v3: V3Database): V4Database {
  const wallets: Wallet[] = v3.accounts.map((account) => ({
    id: primaryWalletId(account.id),
    ownerAccountId: account.id,
    kind: "primary",
    currency: SANDBOX_CURRENCY,
    status: "active",
    createdAt: account.createdAt,
    updatedAt: account.createdAt,
  }));
  const walletIds = new Set(wallets.map((w) => w.id));

  const ledger: V4Entry[] = [];
  const operations: V4Operation[] = [];
  const references = new Set<string>();

  for (const legacy of v3.wallets) {
    const walletId = primaryWalletId(legacy.teenId);
    if (!walletIds.has(walletId)) throw new Error("Legacy wallet without an account");
    for (const entry of legacy.ledger) {
      if (checkMoney(entry.amount, { currency: entry.currency }) !== null) {
        throw new Error("Legacy entry with an invalid amount");
      }
      const type = LEGACY_OPERATION_TYPE[entry.type];
      if (!type) throw new Error("Legacy entry with an unknown type");
      const reference = legacyReference(type, entry.id, references);
      references.add(reference);
      const approvalId = legacy.payments.find((p) => p.id === entry.id)?.approvalId;
      const createdBy = entry.type === "allowance_credit" ? entry.counterparty.id : legacy.teenId;
      ledger.push(
        Object.freeze({
          id: entry.id,
          walletId,
          accountId: legacy.teenId,
          operationId: entry.id,
          reference,
          type: entry.type,
          direction: entry.direction,
          amount: entry.amount,
          currency: SANDBOX_CURRENCY,
          status: "completed",
          description: entry.description,
          counterparty: entry.counterparty,
          ...(entry.goalId ? { goalId: entry.goalId } : {}),
          ...(entry.requestId ? { requestId: entry.requestId } : {}),
          ...(approvalId ? { approvalId } : {}),
          createdAt: entry.createdAt,
          createdBy,
        }) as V4Entry,
      );
      operations.push({
        id: entry.id,
        reference,
        type,
        status: "completed",
        actorId: createdBy,
        amount: entry.amount,
        currency: SANDBOX_CURRENCY,
        legs: [
          { direction: entry.direction, amount: entry.amount, walletId, entryId: entry.id },
          {
            direction: entry.direction === "credit" ? "debit" : "credit",
            amount: entry.amount,
            external: legacyContra(entry),
          },
        ],
        createdAt: entry.createdAt,
        description: entry.description,
        ...(entry.type === "payment_sent" || entry.type === "payment_received"
          ? { recipientId: entry.counterparty.id }
          : {}),
        ...(approvalId ? { approvalId } : {}),
        ...(entry.requestId ? { requestId: entry.requestId } : {}),
      });
    }
  }

  // The v4 deposit is posted with today's engine; it only touches the
  // parent's fresh wallet, so the legacy entries pass through as-is.
  let journal = {
    wallets,
    ledger: ledger as unknown as LedgerEntry[],
    operations: operations as unknown as MoneyOperation[],
    spaces: [] as MoneySpace[],
  };
  for (const account of v3.accounts) {
    if (account.role !== "parent") continue;
    const funded = postOperation(
      journal,
      depositDraft({
        id: `dep_start_${account.id}`,
        actorId: account.id,
        at: account.createdAt,
        walletId: primaryWalletId(account.id),
        amount: PARENT_STARTING_FUNDS,
      }),
    );
    if (!funded.ok) throw new Error(funded.error.message);
    journal = funded.journal;
  }

  return {
    version: 4,
    accounts: v3.accounts,
    families: v3.families,
    wallets: journal.wallets,
    ledger: journal.ledger as unknown as V4Entry[],
    operations: journal.operations as unknown as V4Operation[],
    teenRecords: v3.wallets.map((w) => ({
      teenId: w.teenId,
      requests: w.requests,
      approvals: w.approvals,
      goals: w.goals,
    })),
    notifications: v3.notifications,
    familyLogs: v3.familyLogs,
    securityEvents: v3.securityEvents,
    recipients: v3.recipients,
  };
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * A legacy free-text goal date ("Nov 30", "Nov 30, 2026" or already
 * "2026-11-30") as a calendar date. Without a year, the first such
 * date on or after `reference` is used. Unreadable text → undefined
 * (the goal simply has no target date; nothing else changes).
 */
export function parseLegacyDeadline(text: string | undefined, reference: string): string | undefined {
  if (!text) return undefined;
  const trimmed = text.trim();
  if (isCalendarDate(trimmed)) return trimmed;
  const match = /^([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(trimmed);
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[1]!.slice(0, 3).toLowerCase());
  if (month < 0) return undefined;
  const refDay = productDay(reference);
  const pad = (n: number) => String(n).padStart(2, "0");
  const build = (year: number) => `${year}-${pad(month + 1)}-${pad(Number(match[2]))}`;
  if (match[3]) {
    const date = build(Number(match[3]));
    return isCalendarDate(date) ? date : undefined;
  }
  const year = Number(refDay.slice(0, 4));
  const date = build(year);
  if (!isCalendarDate(date)) return undefined;
  return date >= refDay ? date : isCalendarDate(build(year + 1)) ? build(year + 1) : undefined;
}

/**
 * v4 → v5: Money Spaces.
 *  · Every teen (and anyone with Save money) gets a default Save Space.
 *  · Every goal record becomes a goal Space with the same id, its
 *    title as the name, its target, and its free-text date parsed.
 *  · save_allocation / goal_allocation entries become
 *    space_allocation entries naming their Space; allocation
 *    operations become `space` operations. Amounts, directions,
 *    dates, ids, descriptions and references never change, so every
 *    balance is exactly what it was. A goal entry whose goal record
 *    is missing gets a custom Space so its money stays visible.
 */
export function migrateV4(v4: V4Database, now: string): V5Database {
  const spaces = new Map<string, MoneySpace>();
  const walletOf = (accountId: string) =>
    v4.wallets.find((w) => w.ownerAccountId === accountId && w.kind === "primary")?.id ??
    primaryWalletId(accountId);
  const createdAtOf = (accountId: string) =>
    v4.accounts.find((a) => a.id === accountId)?.createdAt ?? now;
  const nextOrder = (accountId: string) =>
    [...spaces.values()].filter((s) => s.ownerAccountId === accountId).length;

  const addSave = (accountId: string) => {
    const id = defaultSaveSpaceId(accountId);
    if (spaces.has(id)) return id;
    const at = createdAtOf(accountId);
    spaces.set(id, {
      id,
      ownerAccountId: accountId,
      walletId: walletOf(accountId),
      name: "Save",
      type: "save",
      icon: "piggy-bank",
      status: "active",
      displayOrder: nextOrder(accountId),
      isDefault: true,
      createdAt: at,
      updatedAt: at,
    });
    return id;
  };

  for (const account of v4.accounts) if (account.role === "teen") addSave(account.id);
  for (const entry of v4.ledger) if (entry.type === "save_allocation") addSave(entry.accountId);

  for (const records of v4.teenRecords) {
    for (const goal of records.goals) {
      if (spaces.has(goal.id)) continue;
      const at = createdAtOf(records.teenId);
      const validTarget = checkMoney(goal.target, { max: MAX_SPACE_TARGET }) === null;
      const deadline = validTarget ? parseLegacyDeadline(goal.deadline, at) : undefined;
      spaces.set(goal.id, {
        id: goal.id,
        ownerAccountId: records.teenId,
        walletId: walletOf(records.teenId),
        name: (goal.title.trim() || "Goal").slice(0, SPACE_NAME_MAX),
        type: validTarget ? "goal" : "custom",
        icon: "target",
        ...(validTarget ? { targetAmount: goal.target } : {}),
        ...(deadline ? { deadline } : {}),
        status: "active",
        displayOrder: nextOrder(records.teenId),
        createdAt: at,
        updatedAt: at,
      });
    }
  }

  const spaceForEntry = (entry: V4Entry): MoneySpace | null => {
    if (entry.type === "save_allocation") return spaces.get(defaultSaveSpaceId(entry.accountId))!;
    if (entry.type !== "goal_allocation") return null;
    const id = entry.goalId ?? `spc_goal_legacy_${entry.accountId}`;
    const found = spaces.get(id);
    if (found && found.walletId === entry.walletId) return found;
    const at = createdAtOf(entry.accountId);
    const orphan: MoneySpace = {
      id: found ? `spc_goal_legacy_${entry.walletId}_${id}` : id,
      ownerAccountId: entry.accountId,
      walletId: entry.walletId,
      name: (entry.counterparty.name.trim() || "Goal").slice(0, SPACE_NAME_MAX),
      type: "custom",
      icon: "target",
      status: "active",
      displayOrder: nextOrder(entry.accountId),
      createdAt: at,
      updatedAt: at,
    };
    if (!spaces.has(orphan.id)) spaces.set(orphan.id, orphan);
    return spaces.get(orphan.id)!;
  };

  const entrySpace = new Map<string, MoneySpace>();
  const ledger: LedgerEntry[] = v4.ledger.map((entry) => {
    const space = spaceForEntry(entry);
    const { goalId: _goalId, ...rest } = entry;
    void _goalId;
    if (!space) return Object.freeze(rest as LedgerEntry);
    entrySpace.set(entry.id, space);
    return Object.freeze({
      ...rest,
      type: "space_allocation",
      counterparty: { kind: "space", id: space.id, name: space.name },
      spaceId: space.id,
    } as LedgerEntry);
  });

  const operations: MoneyOperation[] = v4.operations.map((op) => {
    if (op.type !== "allocation") return op as MoneyOperation;
    const entryId = op.legs.find((l) => l.entryId)?.entryId;
    const space = entryId ? entrySpace.get(entryId) : undefined;
    return {
      ...op,
      type: "space",
      legs: op.legs.map((leg) =>
        leg.external && space
          ? { ...leg, external: { kind: "space" as const, id: space.id, name: space.name } }
          : (leg as OperationLeg),
      ),
    } as MoneyOperation;
  });

  return {
    version: 5,
    accounts: v4.accounts,
    families: v4.families,
    wallets: v4.wallets,
    ledger,
    operations,
    spaces: [...spaces.values()],
    teenRecords: v4.teenRecords.map((r) => ({
      teenId: r.teenId,
      requests: r.requests,
      approvals: r.approvals,
    })),
    notifications: v4.notifications,
    familyLogs: v4.familyLogs,
    securityEvents: v4.securityEvents,
    recipients: v4.recipients,
  };
}

/**
 * v5 → v6: Pocket Money Autopilot.
 *  · Every Phase 3 pocket-money preview (stored inside guardian
 *    controls, never executed) becomes a *paused* schedule — the
 *    preview promised nothing would send automatically, so the parent
 *    decides when to resume it. Its amount and cadence are kept; it
 *    starts from the migration day; it belongs to the current link.
 *    A preview that can't be represented safely (no linked guardian,
 *    missing wallets, invalid values) is dropped from controls only —
 *    the untouched original stays in the repository backup.
 *  · The preview field is then removed from controls.
 *  · Money data is carried over untouched (no schedule has any runs).
 */
export function migrateV5(v5: V5Database, now: string): SandboxDatabase {
  const today = productDay(now);
  const schedules: PocketMoneySchedule[] = [];
  const families: Family[] = v5.families.map((family) => ({
    ...family,
    controls: family.controls.map((controls) => {
      const { allowance, ...rest } = controls as typeof controls & {
        allowance?: LegacyControlsAllowance | null;
      };
      if (!allowance) return rest;
      const link = family.links.find((l) => l.teenId === controls.teenId);
      const guardianId = link?.guardianId ?? null;
      const guardian = v5.accounts.find((a) => a.id === guardianId && a.role === "parent");
      const source = guardian
        ? v5.wallets.find((w) => w.ownerAccountId === guardian.id && w.kind === "primary")
        : undefined;
      const destination = v5.wallets.find(
        (w) => w.ownerAccountId === controls.teenId && w.kind === "primary",
      );
      const { amount, frequency, weekday, dayOfMonth } = allowance;
      const valid =
        checkMoney(amount) === null &&
        (frequency === "weekly" || frequency === "monthly") &&
        typeof weekday === "number" && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6 &&
        typeof dayOfMonth === "number" && Number.isInteger(dayOfMonth) &&
        dayOfMonth >= 1 && dayOfMonth <= POCKET_MONEY_DAY_OF_MONTH_MAX;
      if (!guardian || !source || !destination || !valid || link?.status !== "linked") return rest;
      schedules.push({
        id: `pms_legacy_${controls.teenId}`,
        familyId: family.id,
        parentAccountId: guardian.id,
        teenAccountId: controls.teenId,
        sourceWalletId: source.id,
        destinationWalletId: destination.id,
        amount: amount as number,
        currency: SANDBOX_CURRENCY,
        frequency: frequency as "weekly" | "monthly",
        dayOfWeek: frequency === "weekly" ? (weekday as number) : 1,
        dayOfMonth: frequency === "monthly" ? (dayOfMonth as number) : 1,
        startDate: today,
        nextRunAt: null,
        status: "paused",
        createdAt: controls.updatedAt,
        updatedAt: now,
        createdBy: guardian.id,
        version: 1,
        linkedAt: link.linkedAt ?? controls.updatedAt,
        runs: [],
      });
      return rest;
    }),
  }));
  return {
    ...v5,
    version: SANDBOX_SCHEMA_VERSION,
    families,
    pocketMoneySchedules: schedules,
  };
}

export type MigrationResult =
  | { kind: "current"; db: SandboxDatabase }
  | { kind: "migrated"; from: 1 | 2 | 3 | 4 | 5; db: SandboxDatabase }
  | { kind: "unreadable" };

/**
 * Turns any stored payload into a current (v6) database, or says it
 * can't. Every intermediate result is re-validated before the next
 * step, and the final one before it's trusted.
 */
export function migrateToCurrent(
  parsed: unknown,
  options: { seedView: () => SandboxState; now: string },
): MigrationResult {
  if (isSandboxDatabase(parsed)) return { kind: "current", db: parsed };
  try {
    let v5: V5Database | null = null;
    let from: 1 | 2 | 3 | 4 | 5 = 5;
    if (isV5Database(parsed)) {
      v5 = parsed as unknown as V5Database;
    } else {
      let v4: V4Database | null = null;
      from = 4;
      if (isV4Database(parsed)) {
        v4 = parsed as unknown as V4Database;
      } else {
        let v3: V3Database | null = null;
        from = 3;
        if (isV3Database(parsed)) {
          v3 = parsed as unknown as V3Database;
        } else if (isV2State(parsed)) {
          v3 = migrateV2(parsed, options.now);
          from = 2;
        } else if (isV1State(parsed)) {
          v3 = migrateV1(parsed, options.seedView);
          from = 1;
        }
        if (!v3 || !isV3Database(v3)) return { kind: "unreadable" };
        v4 = migrateV3(v3);
        if (!isV4Database(v4)) return { kind: "unreadable" };
      }
      v5 = migrateV4(v4, options.now);
      if (!isV5Database(v5)) return { kind: "unreadable" };
    }
    const db = migrateV5(v5, options.now);
    return isSandboxDatabase(db) ? { kind: "migrated", from, db } : { kind: "unreadable" };
  } catch {
    return { kind: "unreadable" };
  }
}
