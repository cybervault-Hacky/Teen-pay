import type {
  AppNotification,
  Contact,
  Friendship,
  MissionProgress,
  ApprovalRequest,
  DomainEvent,
  Family,
  LedgerEntry,
  MoneyOperation,
  MoneyRequest,
  PeerRequest,
  Recipient,
  MoneySpace,
  PocketMoneySchedule,
  SecurityEvent,
  ShieldSettingsRecord,
  User,
  Wallet,
} from "@/domain";

/**
 * Persisted schema versions:
 * v1 — Phase 2 (ledger, requests, notifications, single family).
 * v2 — Phase 3 (identities, session pointer, family links, controls,
 *      approvals, per-recipient notifications, family event log).
 * v3 — Phase 4 (multi-account database: accounts, families with
 *      memberships + invites, per-teen wallets, security events).
 *      The session moved out of data into the auth layer.
 * v4 — Phase 5 (explicit wallets owned by accounts, one append-only
 *      ledger whose entries carry walletId/operationId/reference,
 *      and an operations log for audit + idempotency).
 * v5 — Phase 6 (Money Spaces: space records owned by accounts;
 *      Save/goal allocations became space_allocation/space_release
 *      entries carrying a spaceId; goal records became goal Spaces).
 * v6 — Phase 7 (Pocket Money Autopilot: recurring schedules as their
 *      own records with an append-only run history; the Phase 3
 *      preview inside guardian controls became a paused schedule).
 * v7 — Phase 8 (Send & Request Money: TeenPay money requests as
 *      their own records; peer transfers are ordinary operations).
 * v8 — Phase 9 (QR & favourites: each teen's saved contacts as
 *      owner-scoped records holding only a TeenPay ID). Phase 11
 *      added optional `missionProgress` and Phase 12 optional
 *      `friendships` — both additive, no version bump.
 */
export const SANDBOX_SCHEMA_VERSION = 8;

// Money limits live in the domain (one definition); re-exported here
// for existing imports.
export { MAX_SANDBOX_AMOUNT, MIN_SANDBOX_AMOUNT } from "@/domain/money";

/** Upper bound for a guardian's daily limit. */
export const MAX_DAILY_LIMIT = 50_000;

/** How many family events the local log keeps. */
export const FAMILY_EVENT_LOG_LIMIT = 100;

/**
 * Sandbox funds a new parent wallet starts with, so pocket money has
 * somewhere to come from. Fictional money — clearly labelled.
 */
export const PARENT_STARTING_FUNDS = 10_000;

/**
 * Who a scoped view is for. Derived from the auth session each time
 * a scope is built — never persisted with the data.
 */
export interface SandboxSession {
  currentUserId: string;
}

/**
 * Teen-owned, non-ledger money records: requests (move nothing until
 * paid) and guardian approvals (move nothing until approved).
 */
export interface TeenRecords {
  teenId: string;
  requests: MoneyRequest[];
  approvals: ApprovalRequest[];
}

/** Family-owned, non-financial activity log. */
export interface FamilyLog {
  familyId: string;
  /** Newest first, capped. */
  events: DomainEvent[];
}

/**
 * The persisted sandbox database (schema v6), grouped by owner:
 *  · accounts — profile
 *  · families — relationships, permissions, settings
 *  · wallets — one or more per account (status, never a balance)
 *  · ledger — every wallet's entries, append-only
 *  · operations — the audit + idempotency log for money actions
 *  · spaces — Money Spaces, owned by an account, bound to a wallet
 *    (settings only — a Space's balance is derived from the ledger)
 *  · pocketMoneySchedules — recurring pocket money, owned by the
 *    paying parent, with each processed occurrence (settings and
 *    history only — money moves as ledger operations)
 *  · teenRecords — requests, approvals
 *  · notifications (per recipient), security events (per account)
 * A cloud repository would store the same records in separate tables.
 */
export interface SandboxDatabase {
  version: typeof SANDBOX_SCHEMA_VERSION;
  accounts: User[];
  families: Family[];
  wallets: Wallet[];
  ledger: LedgerEntry[];
  operations: MoneyOperation[];
  spaces: MoneySpace[];
  pocketMoneySchedules: PocketMoneySchedule[];
  teenRecords: TeenRecords[];
  /**
   * TeenPay-to-TeenPay money requests (v7). Not per family: the two
   * parties can be in different families. Written only by the peer
   * engine (`peer-transitions.ts`).
   */
  peerRequests: PeerRequest[];
  /**
   * Favourites (v8): each teen's saved TeenPay IDs. Convenience data,
   * never authority — resolved through the directory on every use.
   * Written only by the contact engine (`contacts.ts`).
   */
  contacts: Contact[];
  /**
   * Money Missions progress (Phase 11): per teen, per mission, steps
   * done. Optional and additive — absent means no mission has been
   * started, so every earlier v8 database is still a valid v8
   * database (no migration). Validated whenever present. Written only
   * by the mission engine (`missions.ts`), which never touches money.
   */
  missionProgress?: MissionProgress[];
  /**
   * Friend Circles (Phase 12): trusted-peer relationship records —
   * requests and friendships between teens. Optional and additive —
   * absent means no friendship has been started, so every earlier v8
   * database is still a valid v8 database (no migration). Validated
   * whenever present. Written only by the friend engine
   * (`friends.ts`), which never touches money.
   */
  friendships?: Friendship[];
  /**
   * Teen Safety Shield reminders (Phase 14): each teen's optional
   * confirmation preferences. Optional and additive — absent means the
   * defaults apply, so every earlier v8 database is still a valid v8
   * database (no migration). Validated whenever present. Written only
   * by the shield engine (`shield.ts`), which never touches money.
   */
  shieldSettings?: ShieldSettingsRecord[];
  notifications: AppNotification[];
  familyLogs: FamilyLog[];
  securityEvents: SecurityEvent[];
  /** Shared directory of fictional recipients. */
  recipients: Recipient[];
}

/**
 * A scoped view of the database for one signed-in account: only the
 * family it belongs to, the accounts in it, the wallets it may see
 * (its own, plus a teen's if it's that teen's linked guardian) and
 * its own notifications. Every transition runs on this view; the
 * store merges results back into the database.
 */
export interface SandboxState {
  /** Accounts visible in this scope (family members + the viewer). */
  users: User[];
  session: SandboxSession;
  family: Family;
  /** Wallets visible in this scope. */
  wallets: Wallet[];
  /**
   * Entries of every visible wallet (each carries its walletId).
   * Read through the wallet queries in `selectors`, never raw.
   */
  ledger: LedgerEntry[];
  /** Operations touching a visible wallet (audit + idempotency). */
  operations: MoneyOperation[];
  /** Money requests (requests move nothing until paid). */
  requests: MoneyRequest[];
  /** Guardian approval requests (pending approvals move nothing). */
  approvals: ApprovalRequest[];
  /**
   * TeenPay money requests the viewer is a party to (requester or
   * payer) — nobody else's. Read-only in a scope: only the peer engine
   * writes them.
   */
  peerRequests: PeerRequest[];
  /**
   * The viewer's own favourites — nobody else's. Read-only in a scope:
   * only the contact engine writes them.
   */
  contacts: Contact[];
  /** Per-recipient notifications, newest first. */
  notifications: AppNotification[];
  /** Non-financial family/approval events, newest first (capped). */
  familyEvents: DomainEvent[];
  recipients: Recipient[];
  /**
   * The viewer's own Money Spaces (settings only; balances are
   * derived from the ledger). Another account's Spaces — including a
   * linked teen's, for a guardian — are never in scope.
   */
  spaces: MoneySpace[];
  /**
   * Pocket money schedules in this view: those the viewer pays (while
   * linked to that teen), or those paying the viewer (read-only, with
   * failure reasons redacted). Nobody else's are ever in scope.
   */
  schedules: PocketMoneySchedule[];
}

export type SandboxErrorCode =
  | "invalid_amount"
  | "insufficient_balance"
  | "exceeds_sandbox_limit"
  | "exceeds_daily_limit"
  | "exceeds_transaction_limit"
  | "duplicate"
  | "unknown_recipient"
  | "unknown_space"
  | "space_archived"
  | "insufficient_space_balance"
  | "exceeds_space_target"
  | "invalid_space"
  | "invalid_target"
  | "invalid_deadline"
  | "space_limit_reached"
  | "unknown_user"
  | "invalid_transition"
  | "entry_rejected"
  | "not_permitted"
  | "not_linked"
  | "invalid_invite"
  | "invite_expired"
  | "invalid_rule"
  | "invalid_account"
  | "username_taken"
  | "account_unavailable"
  | "not_signed_in"
  | "unsupported_currency"
  | "unknown_wallet"
  | "wallet_frozen"
  | "wallet_closed"
  | "not_refundable"
  | "unknown_schedule"
  | "invalid_schedule"
  | "stale_schedule"
  | "self_transfer"
  | "unknown_request"
  | "request_expired"
  | "invalid_qr"
  | "self_contact"
  | "unknown_mission"
  | "mission_locked"
  | "mission_step"
  | "contact_exists"
  | "unknown_contact"
  | "contact_limit_reached"
  // Friend Circles (Phase 12)
  | "self_friend"
  | "friend_exists"
  | "friend_request_pending"
  | "friend_limit_reached"
  | "unknown_friendship"
  | "not_friends";

/**
 * A typed, human-readable error. `code` drives logic; `message`
 * is safe to show verbatim in the UI.
 */
export interface SandboxError {
  code: SandboxErrorCode;
  message: string;
  /** The form field a validation error belongs to, when there is one. */
  field?:
    | "name"
    | "icon"
    | "type"
    | "targetAmount"
    | "deadline"
    | "amount"
    | "frequency"
    | "day"
    | "startDate"
    | "endDate"
    | "recipient"
    | "note";
}

export type SandboxResult<T = undefined> =
  | { ok: true; value: T }
  | { ok: false; error: SandboxError };
