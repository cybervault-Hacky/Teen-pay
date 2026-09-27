import type {
  AppNotification,
  DomainEvent,
  Family,
  FamilyMembership,
  LedgerEntry,
  MoneyOperation,
  MoneySpace,
  PocketMoneySchedule,
  SecurityEvent,
  User,
  Wallet,
} from "@/domain";
import {
  SECURITY_EVENT_LIMIT,
  TEEN_FAILED_RUN_MESSAGE,
  isOpenSchedule,
  type AccountProfile,
} from "@/domain";
import type { SandboxDatabase, SandboxState, TeenRecords } from "./types";

/**
 * The data-access boundary.
 *
 *   authenticated account ──▶ membership check ──▶ family scope
 *
 * `scopeFor` builds the only view of the database an account ever
 * receives: the family it belongs to, the accounts in it, the wallets
 * it may see (its own, plus a teen's only if it is that teen or the
 * teen's actively linked guardian), those wallets' ledger entries and
 * operations, and its own notifications. Transitions run on that
 * view; `mergeScope` writes results back — only into the family and
 * wallets the scope was granted, and the ledger only ever grows.
 * Nothing here trusts a UI role — access comes from memberships and
 * links in the data.
 *
 * Money Spaces are private to their owner: a scope contains only the
 * viewer's own Spaces. A linked guardian still sees the teen's wallet
 * (balance, payments) but every Space movement in it is redacted to a
 * generic "Money Space" — no Space id, name or goal. The amounts stay,
 * so the teen's available balance is still correct for the guardian.
 *
 * Pocket money schedules belong to the paying parent. A scope holds a
 * parent's own schedules only while that parent is actively linked to
 * the teen, and a teen's schedules read-only with every failure reason
 * redacted (it may be about the parent's balance). Only the payer can
 * write one; the teen's single exception is the cancellation that a
 * disconnect performs.
 */

export interface ScopeInfo {
  viewerId: string;
  /** The family in scope, or null for an account with no family yet. */
  familyId: string | null;
  /** The teen whose money records are in scope, or null. */
  walletTeenId: string | null;
  /** Every wallet this scope may read and write. */
  walletIds: string[];
}

export interface Scope {
  state: SandboxState;
  info: ScopeInfo;
}

/** Placeholder family for an account that doesn't belong to one yet. */
export function emptyFamily(): Family {
  return {
    id: "",
    name: "",
    members: [],
    links: [],
    controls: [],
    invites: [],
    createdAt: new Date(0).toISOString(),
  };
}

function emptyRecords(teenId = ""): TeenRecords {
  return { teenId, requests: [], approvals: [] };
}

export const REDACTED_SPACE_NAME = "Money Space";
const REDACTED_SPACE = { kind: "space" as const, id: "space", name: REDACTED_SPACE_NAME };

/** A Space entry as seen by someone other than the Space's owner. */
function redactSpaceEntry(entry: LedgerEntry): LedgerEntry {
  const redacted: LedgerEntry = {
    ...entry,
    description: REDACTED_SPACE_NAME,
    counterparty: REDACTED_SPACE,
  };
  delete redacted.spaceId;
  return redacted;
}

function redactSpaceOperation(op: MoneyOperation): MoneyOperation {
  return {
    ...op,
    description: REDACTED_SPACE_NAME,
    legs: op.legs.map((leg) => (leg.external ? { ...leg, external: REDACTED_SPACE } : leg)),
  };
}

/**
 * The financial records of a set of wallets. Space movements of
 * wallets the viewer doesn't own are redacted (see module comment).
 */
function journalFor(db: SandboxDatabase, walletIds: ReadonlySet<string>, viewerId?: string) {
  const redact = (accountId: string) => viewerId !== undefined && accountId !== viewerId;
  const ownerOf = new Map(db.wallets.map((w) => [w.id, w.ownerAccountId]));
  return {
    wallets: db.wallets.filter((w) => walletIds.has(w.id)),
    ledger: db.ledger
      .filter((e) => walletIds.has(e.walletId))
      .map((e) => (e.spaceId !== undefined && redact(e.accountId) ? redactSpaceEntry(e) : e)),
    operations: db.operations
      .filter((op) =>
        op.legs.some((leg) => leg.walletId !== undefined && walletIds.has(leg.walletId)),
      )
      .map((op) =>
        op.type === "space" &&
        op.legs.some((l) => l.walletId !== undefined && redact(ownerOf.get(l.walletId) ?? ""))
          ? redactSpaceOperation(op)
          : op,
      ),
    spaces: db.spaces.filter(
      (s) => walletIds.has(s.walletId) && (viewerId === undefined || s.ownerAccountId === viewerId),
    ),
  };
}

export function findAccount(db: SandboxDatabase, accountId: string): User | null {
  return db.accounts.find((a) => a.id === accountId) ?? null;
}

/** The account plus its derived current family membership. */
export function accountProfile(db: SandboxDatabase, accountId: string): AccountProfile | null {
  const account = findAccount(db, accountId);
  if (!account) return null;
  return {
    ...account,
    familyMembership: accessMemberships(db, accountId)[0]?.membership ?? null,
  };
}

/** Memberships that give access (pending or active), active first. */
export function accessMemberships(
  db: SandboxDatabase,
  accountId: string,
): { family: Family; membership: FamilyMembership }[] {
  const found: { family: Family; membership: FamilyMembership }[] = [];
  for (const family of db.families) {
    for (const membership of family.members) {
      if (membership.accountId === accountId && membership.status !== "removed") {
        found.push({ family, membership });
      }
    }
  }
  return found.sort((a, b) =>
    a.membership.status === b.membership.status
      ? 0
      : a.membership.status === "active"
        ? -1
        : 1,
  );
}

/** The family an account works in (first active, else pending). */
export function familyForAccount(db: SandboxDatabase, accountId: string): Family | null {
  return accessMemberships(db, accountId)[0]?.family ?? null;
}

/** The teen whose wallet a family's view shows. */
export function walletTeenOf(family: Family): string | null {
  return (
    family.members.find((m) => m.role === "teen" && m.status === "active")?.accountId ??
    null
  );
}

/**
 * May `viewerId` see `teenId`'s money? Only the teen themselves, or
 * a guardian who is actively linked to that teen.
 */
export function canSeeWallet(family: Family, viewerId: string, teenId: string): boolean {
  const active = (accountId: string) =>
    family.members.some((m) => m.accountId === accountId && m.status === "active");
  if (viewerId === teenId) return active(teenId);
  const link = family.links.find((l) => l.teenId === teenId);
  return link?.status === "linked" && link.guardianId === viewerId && active(viewerId);
}

function assemble(
  db: SandboxDatabase,
  family: Family,
  viewerId: string,
  users: User[],
  walletIds: ReadonlySet<string>,
  records: TeenRecords,
  notifications: AppNotification[],
  schedules: PocketMoneySchedule[],
  /** Engine-level views see everything unredacted. */
  engineLevel = false,
): SandboxState {
  return {
    schedules,
    users,
    session: { currentUserId: viewerId },
    family,
    ...journalFor(db, walletIds, engineLevel ? undefined : viewerId),
    requests: records.requests,
    approvals: records.approvals,
    notifications,
    familyEvents: db.familyLogs.find((l) => l.familyId === family.id)?.events ?? [],
    recipients: db.recipients,
  };
}

/**
 * The scoped view for a signed-in account. Returns null when the
 * account doesn't exist or isn't active — callers must treat that as
 * "no access", never fall back to someone else's data.
 */
export function scopeFor(
  db: SandboxDatabase,
  viewerId: string,
  options: { familyId?: string } = {},
): Scope | null {
  const viewer = findAccount(db, viewerId);
  if (!viewer || viewer.status !== "active") return null;

  const family =
    (options.familyId
      ? db.families.find((f) => f.id === options.familyId)
      : familyForAccount(db, viewerId)) ?? emptyFamily();

  // Accounts visible in this scope: everyone who is or was in the
  // family (names for history), plus the viewer.
  const visibleIds = new Set(family.members.map((m) => m.accountId));
  visibleIds.add(viewerId);
  const users = db.accounts.filter((a) => visibleIds.has(a.id));

  const teenId = walletTeenOf(family);
  const walletAccess = teenId !== null && canSeeWallet(family, viewerId, teenId);
  const records = walletAccess
    ? (db.teenRecords.find((r) => r.teenId === teenId) ?? emptyRecords(teenId))
    : emptyRecords();

  // Wallets: always the viewer's own; a teen's only with access.
  const walletIds = new Set(
    db.wallets
      .filter(
        (w) => w.ownerAccountId === viewerId || (walletAccess && w.ownerAccountId === teenId),
      )
      .map((w) => w.id),
  );

  const notifications = db.notifications.filter((n) => n.recipientId === viewerId);

  return {
    state: assemble(
      db,
      family,
      viewerId,
      users,
      walletIds,
      records,
      notifications,
      schedulesFor(db, family, viewerId),
    ),
    info: {
      viewerId,
      familyId: family.id || null,
      walletTeenId: walletAccess ? teenId : null,
      walletIds: [...walletIds],
    },
  };
}

/**
 * An engine-level view of one family with every account, every
 * wallet and every notification in it. For seeds and pure engine tests only — the app
 * uses `scopeFor`.
 */
export function databaseView(
  db: SandboxDatabase,
  familyId: string,
  viewerId: string,
): SandboxState {
  const family = db.families.find((f) => f.id === familyId) ?? emptyFamily();
  const teenId = walletTeenOf(family) ?? "";
  const records = db.teenRecords.find((r) => r.teenId === teenId) ?? emptyRecords(teenId);
  // Engine-level: every account is visible here, so every wallet is.
  const walletIds = new Set(db.wallets.map((w) => w.id));
  return assemble(
    db,
    family,
    viewerId,
    db.accounts,
    walletIds,
    records,
    db.notifications,
    db.pocketMoneySchedules.filter((s) => s.familyId === family.id),
    true,
  );
}

/** The teen's copy: failure reasons stay with the parent. */
function redactForTeen(schedule: PocketMoneySchedule): PocketMoneySchedule {
  if (!schedule.runs.some((r) => r.status === "failed")) return schedule;
  return {
    ...schedule,
    runs: schedule.runs.map((run) => {
      if (run.status !== "failed") return run;
      const { reason: _reason, message: _message, ...rest } = run;
      void _reason;
      void _message;
      return { ...rest, message: TEEN_FAILED_RUN_MESSAGE };
    }),
  };
}

/**
 * Schedules in a viewer's scope: the ones they pay while linked to
 * that teen, and the ones paying them (read-only, redacted).
 */
function schedulesFor(
  db: SandboxDatabase,
  family: Family,
  viewerId: string,
): PocketMoneySchedule[] {
  if (!family.id) return [];
  const activeTeen = family.members.some(
    (m) => m.accountId === viewerId && m.role === "teen" && m.status === "active",
  );
  const out: PocketMoneySchedule[] = [];
  for (const schedule of db.pocketMoneySchedules) {
    if (schedule.familyId !== family.id) continue;
    if (
      schedule.parentAccountId === viewerId &&
      canSeeWallet(family, viewerId, schedule.teenAccountId)
    ) {
      out.push(schedule);
    } else if (schedule.teenAccountId === viewerId && activeTeen) {
      out.push(redactForTeen(schedule));
    }
  }
  return out;
}

/** Family events that are also security-relevant for the accounts involved. */
function securityEventsFor(event: DomainEvent): SecurityEvent[] {
  switch (event.type) {
    case "family_invite_created":
      return [
        { id: `sec_${event.id}`, type: "family_invite_created", accountId: event.actorId, at: event.at },
      ];
    case "family_linked":
      return [event.teenId, event.guardianId].map((accountId) => ({
        id: `sec_${event.id}_${accountId}`,
        type: "family_member_linked" as const,
        accountId,
        at: event.at,
      }));
    case "family_unlinked":
      return [event.teenId, event.guardianId].map((accountId) => ({
        id: `sec_${event.id}_${accountId}`,
        type: "family_member_removed" as const,
        accountId,
        at: event.at,
      }));
    default:
      return [];
  }
}

export function appendSecurityEvents(
  db: SandboxDatabase,
  events: SecurityEvent[],
): SandboxDatabase {
  const known = new Set(db.securityEvents.map((e) => e.id));
  const fresh = events.filter((e) => !known.has(e.id));
  if (fresh.length === 0) return db;
  return {
    ...db,
    securityEvents: [...fresh, ...db.securityEvents].slice(0, SECURITY_EVENT_LIMIT),
  };
}

/** Thrown when a transition tries to rewrite financial history. */
export class LedgerIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerIntegrityError";
  }
}

function sameRecord(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Wallets are upserted (status only — never a balance). The ledger
 * and the operations log are append-only: an existing entry or
 * operation can never change or disappear, and new ones may only
 * touch wallets in scope. Violations throw — they are programming
 * errors, never user input.
 */
function mergeFinancialRecords(
  db: SandboxDatabase,
  walletIds: ReadonlySet<string>,
  before: SandboxState,
  after: SandboxState,
): SandboxDatabase {
  if (
    before.wallets === after.wallets &&
    before.ledger === after.ledger &&
    before.operations === after.operations
  ) {
    return db;
  }

  const wallets: Wallet[] = db.wallets.map((w) => {
    const updated = after.wallets.find((u) => u.id === w.id);
    return updated && walletIds.has(w.id) ? updated : w;
  });
  if (after.wallets.some((w) => !db.wallets.some((d) => d.id === w.id))) {
    throw new LedgerIntegrityError("Wallets can't be created from a scoped view.");
  }

  const entriesById = new Map(db.ledger.map((e) => [e.id, e]));
  const afterById = new Map(after.ledger.map((e) => [e.id, e]));
  for (const entry of before.ledger) {
    const kept = afterById.get(entry.id);
    if (!kept || !sameRecord(kept, entry)) {
      throw new LedgerIntegrityError("Ledger entries are immutable.");
    }
  }
  // Entries already in the scope were verified against `before` above
  // (a scope may hold a redacted copy, so it's never compared to db).
  const beforeEntryIds = new Set(before.ledger.map((e) => e.id));
  const newEntries: LedgerEntry[] = [];
  for (const entry of after.ledger) {
    if (beforeEntryIds.has(entry.id)) continue;
    const existing = entriesById.get(entry.id);
    if (existing) {
      if (!sameRecord(existing, entry)) throw new LedgerIntegrityError("Ledger entries are immutable.");
      continue;
    }
    if (!walletIds.has(entry.walletId)) {
      throw new LedgerIntegrityError("An entry targets a wallet outside this scope.");
    }
    newEntries.push(entry);
  }

  const opsById = new Map(db.operations.map((op) => [op.id, op]));
  const afterOpsById = new Map(after.operations.map((op) => [op.id, op]));
  for (const op of before.operations) {
    const kept = afterOpsById.get(op.id);
    if (!kept || !sameRecord(kept, op)) throw new LedgerIntegrityError("Operations are immutable.");
  }
  const beforeOpIds = new Set(before.operations.map((op) => op.id));
  const newOps: MoneyOperation[] = [];
  for (const op of after.operations) {
    if (beforeOpIds.has(op.id)) continue;
    const existing = opsById.get(op.id);
    if (existing) {
      if (!sameRecord(existing, op)) throw new LedgerIntegrityError("Operations are immutable.");
      continue;
    }
    if (op.legs.some((leg) => leg.walletId !== undefined && !walletIds.has(leg.walletId))) {
      throw new LedgerIntegrityError("An operation targets a wallet outside this scope.");
    }
    newOps.push(op);
  }

  return {
    ...db,
    wallets,
    ledger: newEntries.length ? [...db.ledger, ...newEntries] : db.ledger,
    operations: newOps.length ? [...db.operations, ...newOps] : db.operations,
  };
}

/**
 * Space settings are upserted, owner-only: a scope may create or edit
 * only the viewer's own Spaces, on the viewer's own wallets, and can
 * never delete one (archiving is a status). Space *money* is ledger
 * entries, merged above under the append-only rules.
 */
function mergeSpaces(
  db: SandboxDatabase,
  info: ScopeInfo,
  before: SandboxState,
  after: SandboxState,
): SandboxDatabase {
  if (before.spaces === after.spaces) return db;
  const afterIds = new Set(after.spaces.map((s) => s.id));
  if (before.spaces.some((s) => !afterIds.has(s.id))) {
    throw new LedgerIntegrityError("Money Spaces can't be deleted.");
  }
  const byId = new Map<string, MoneySpace>(db.spaces.map((s) => [s.id, s]));
  const beforeById = new Map(before.spaces.map((s) => [s.id, s]));
  const walletIds = new Set(info.walletIds);
  for (const space of after.spaces) {
    const previous = beforeById.get(space.id);
    if (previous && sameRecord(previous, space)) continue;
    const stored = byId.get(space.id);
    if (
      space.ownerAccountId !== info.viewerId ||
      (previous !== undefined && previous.ownerAccountId !== info.viewerId) ||
      (stored !== undefined && stored.ownerAccountId !== info.viewerId)
    ) {
      throw new LedgerIntegrityError("A Money Space can only be changed by its owner.");
    }
    if (!previous && stored) throw new LedgerIntegrityError("Money Space ids are unique.");
    if (previous && previous.walletId !== space.walletId) {
      throw new LedgerIntegrityError("A Money Space can't move to another wallet.");
    }
    if (!walletIds.has(space.walletId)) {
      throw new LedgerIntegrityError("A Money Space targets a wallet outside this scope.");
    }
    byId.set(space.id, space);
  }
  return { ...db, spaces: [...byId.values()] };
}

const SCHEDULE_IDENTITY: readonly (keyof PocketMoneySchedule)[] = [
  "id",
  "familyId",
  "parentAccountId",
  "teenAccountId",
  "sourceWalletId",
  "destinationWalletId",
  "currency",
  "createdAt",
  "createdBy",
  "linkedAt",
];

const DISCONNECT_FIELDS = new Set(["status", "endedReason", "nextRunAt", "updatedAt", "version"]);

function withoutKeys(record: object, keys: ReadonlySet<string>): string {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(record)
        .filter(([key]) => !keys.has(key))
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  );
}

/**
 * Pocket money schedules are upserted, payer-only, and never deleted:
 *  · only the paying parent writes a schedule, from their own wallet
 *    to that teen's wallet, both in this scope, in this family;
 *  · identity fields (who, which wallets, which link) never change;
 *  · the version only moves forward; runs are append-only; an ended
 *    schedule (completed or cancelled) is final.
 * The teen's one exception: the cancellation their own disconnect
 * performs (status → cancelled, reason family_disconnected), applied
 * to the stored record — never to their redacted copy.
 */
function mergeSchedules(
  db: SandboxDatabase,
  info: ScopeInfo,
  before: SandboxState,
  after: SandboxState,
): SandboxDatabase {
  if (before.schedules === after.schedules) return db;
  const afterIds = new Set(after.schedules.map((s) => s.id));
  if (before.schedules.some((s) => !afterIds.has(s.id))) {
    throw new LedgerIntegrityError("Pocket money schedules can't be deleted.");
  }
  const byId = new Map(db.pocketMoneySchedules.map((s) => [s.id, s]));
  const beforeById = new Map(before.schedules.map((s) => [s.id, s]));
  const walletIds = new Set(info.walletIds);
  const walletOwner = new Map(db.wallets.map((w) => [w.id, w.ownerAccountId]));

  for (const schedule of after.schedules) {
    const previous = beforeById.get(schedule.id);
    if (previous && sameRecord(previous, schedule)) continue;
    const stored = byId.get(schedule.id);
    if (!previous && stored) throw new LedgerIntegrityError("Schedule ids are unique.");
    if (previous && !stored) throw new LedgerIntegrityError("Unknown schedule.");

    const payer =
      schedule.parentAccountId === info.viewerId &&
      (stored === undefined || stored.parentAccountId === info.viewerId);
    if (payer) {
      if (
        schedule.familyId !== info.familyId ||
        !walletIds.has(schedule.sourceWalletId) ||
        walletOwner.get(schedule.sourceWalletId) !== info.viewerId ||
        !walletIds.has(schedule.destinationWalletId) ||
        walletOwner.get(schedule.destinationWalletId) !== schedule.teenAccountId
      ) {
        throw new LedgerIntegrityError("A schedule must pay from the payer's wallet to the teen's.");
      }
      if (stored) {
        if (SCHEDULE_IDENTITY.some((key) => !sameRecord(stored[key], schedule[key]))) {
          throw new LedgerIntegrityError("A schedule's parties and wallets can't change.");
        }
        if (!isOpenSchedule(stored)) throw new LedgerIntegrityError("An ended schedule is final.");
        if (schedule.version <= stored.version) {
          throw new LedgerIntegrityError("Schedule versions only move forward.");
        }
        if (
          schedule.runs.length < stored.runs.length ||
          stored.runs.some((run, i) => !sameRecord(run, schedule.runs[i]))
        ) {
          throw new LedgerIntegrityError("Pocket money history is append-only.");
        }
      } else if (schedule.version !== 1 || schedule.runs.length !== 0) {
        throw new LedgerIntegrityError("A new schedule starts at version 1 with no history.");
      }
      byId.set(schedule.id, schedule);
      continue;
    }

    // The teen: only the cancellation their disconnect performs.
    const link = after.family.links.find((l) => l.teenId === info.viewerId);
    if (
      stored &&
      previous &&
      schedule.teenAccountId === info.viewerId &&
      stored.teenAccountId === info.viewerId &&
      isOpenSchedule(stored) &&
      link?.status === "disconnected" &&
      schedule.status === "cancelled" &&
      schedule.endedReason === "family_disconnected" &&
      schedule.nextRunAt === null &&
      schedule.version === previous.version + 1 &&
      withoutKeys(schedule, DISCONNECT_FIELDS) === withoutKeys(previous, DISCONNECT_FIELDS)
    ) {
      byId.set(schedule.id, {
        ...stored,
        status: "cancelled",
        endedReason: "family_disconnected",
        nextRunAt: null,
        updatedAt: schedule.updatedAt,
        version: stored.version + 1,
      });
      continue;
    }
    throw new LedgerIntegrityError("Only the parent who pays a schedule can change it.");
  }
  return { ...db, pocketMoneySchedules: [...byId.values()] };
}

/**
 * Writes a scope's changes back. Only the scope's own family, teen
 * records and permitted wallets are written (the ledger append-only); notifications are upserted by id
 * (a scope may create notifications for other family members, but
 * can only modify its viewer's own).
 */
export function mergeScope(
  db: SandboxDatabase,
  info: ScopeInfo,
  before: SandboxState,
  after: SandboxState,
): SandboxDatabase {
  if (before === after) return db;
  let next: SandboxDatabase = db;

  if (info.familyId && after.family.id === info.familyId) {
    next = {
      ...next,
      families: next.families.map((f) => (f.id === info.familyId ? after.family : f)),
      familyLogs: next.familyLogs.some((l) => l.familyId === info.familyId)
        ? next.familyLogs.map((l) =>
            l.familyId === info.familyId ? { ...l, events: after.familyEvents } : l,
          )
        : [...next.familyLogs, { familyId: info.familyId, events: after.familyEvents }],
    };
  }

  if (info.walletTeenId) {
    const records: TeenRecords = {
      teenId: info.walletTeenId,
      requests: after.requests,
      approvals: after.approvals,
    };
    next = {
      ...next,
      teenRecords: next.teenRecords.some((r) => r.teenId === info.walletTeenId)
        ? next.teenRecords.map((r) => (r.teenId === info.walletTeenId ? records : r))
        : [...next.teenRecords, records],
    };
  }

  next = mergeSpaces(next, info, before, after);
  next = mergeFinancialRecords(next, new Set(info.walletIds), before, after);
  next = mergeSchedules(next, info, before, after);

  if (after.notifications !== before.notifications) {
    const mine = new Set(before.notifications.map((n) => n.id));
    const byId = new Map(next.notifications.map((n) => [n.id, n]));
    for (const n of after.notifications) {
      // The viewer may update their own; anything else is insert-only.
      if (mine.has(n.id) || !byId.has(n.id)) byId.set(n.id, n);
    }
    next = {
      ...next,
      notifications: [...byId.values()].sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      ),
    };
  }

  const seen = new Set(before.familyEvents.map((e) => e.id));
  const newEvents = after.familyEvents.filter((e) => !seen.has(e.id));
  return appendSecurityEvents(next, newEvents.flatMap(securityEventsFor));
}
