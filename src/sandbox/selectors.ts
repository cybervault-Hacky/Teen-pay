import {
  deadlineInfo,
  isInviteExpired,
  productDay,
  spaceProgress,
  type DeadlineInfo,
  type SpaceProgress,
} from "@/domain";
import type {
  AppNotification,
  ApprovalRequest,
  DomainEvent,
  Family,
  FamilyInvite,
  GuardianControls,
  GuardianLink,
  LedgerEntry,
  LedgerEntryType,
  MoneyRequest,
  MoneySpace,
  Transaction,
  TransactionDetails,
  TransactionStatus,
  User,
  UserRole,
  Wallet,
} from "@/domain";
import { formatDateTime } from "@/lib/format";
import {
  deriveMoneySummary,
  isSpaceEntry,
  spaceTotals,
  walletBalance,
  walletEntries,
  type MoneySummary,
} from "./engine";
import {
  compensatedAmount,
  findWallet,
  primaryWalletOf,
  refundableAmount,
  walletsOwnedBy,
} from "./operations";
import {
  activeControls,
  currentUser,
  familyMember,
  findUser,
  linkFor,
  linkedGuardian,
  maybePrimaryTeen,
  primaryTeen,
  teensOfGuardian,
} from "./identity";
import { spendingStatus, spentOnDay, type SpendingStatus } from "./rules";
import type { SandboxState } from "./types";

/**
 * Derived views over sandbox state. Every number shown in the UI
 * comes from these — nothing is stored as a "current balance".
 */

const TYPE_LABELS: Record<LedgerEntryType, string> = {
  deposit: "Sandbox funds",
  allowance_credit: "Pocket money",
  allowance_debit: "Pocket money sent",
  payment_sent: "Payment sent",
  payment_received: "Payment received",
  transfer_out: "Transfer sent",
  transfer_in: "Transfer received",
  refund: "Refund",
  reversal: "Reversal",
  adjustment: "Adjustment",
  space_allocation: "Added to space",
  space_release: "Moved from space",
};

export function typeLabel(type: LedgerEntryType): string {
  return TYPE_LABELS[type];
}

// ── Wallets & balances (the query API) ───────────────────────────
//
// Screens never filter `state.ledger` themselves: they ask for a
// wallet, its balance, or its transactions here. Every figure is
// derived from the ledger on read — nothing is stored.

export function getWallet(state: SandboxState, walletId: string): Wallet | null {
  return findWallet(state.wallets, walletId);
}

/** The signed-in account's own primary wallet. */
export function selectViewerWallet(state: SandboxState): Wallet | null {
  return primaryWalletOf(state.wallets, state.session.currentUserId);
}

/**
 * The teen wallet this view is about: the teen's own, or — for a
 * linked guardian — their teen's. Null when there is none in scope
 * (e.g. an unconnected parent: no teen data at all).
 */
export function selectTeenWallet(state: SandboxState): Wallet | null {
  const teen = maybePrimaryTeen(state);
  return teen ? primaryWalletOf(state.wallets, teen.id) : null;
}

function teenWalletId(state: SandboxState): string {
  return selectTeenWallet(state)?.id ?? "";
}

/** A wallet's available balance (0 when it isn't in scope). */
export function getBalance(state: SandboxState, walletId: string): number {
  return walletBalance(state.ledger, walletId);
}

/** One wallet's entries, newest first. */
export function listWalletEntries(state: SandboxState, walletId: string): LedgerEntry[] {
  return walletEntries(state.ledger, walletId).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
}

/** Entries across every wallet an account owns (that's in scope). */
export function listAccountEntries(state: SandboxState, accountId: string): LedgerEntry[] {
  const ids = new Set(walletsOwnedBy(state.wallets, accountId).map((w) => w.id));
  return state.ledger
    .filter((e) => ids.has(e.walletId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function selectIncoming(state: SandboxState, walletId: string): LedgerEntry[] {
  return listWalletEntries(state, walletId).filter((e) => e.direction === "credit");
}

export function selectOutgoing(state: SandboxState, walletId: string): LedgerEntry[] {
  return listWalletEntries(state, walletId).filter((e) => e.direction === "debit");
}

/** Rupees spent from a wallet on `at`'s day (completed entries only). */
export function selectDailySpending(
  state: SandboxState,
  walletId: string,
  at: string = new Date().toISOString(),
): number {
  return spentOnDay(state.ledger, at, walletId);
}

/**
 * The name to show for an entry's Space: the Space's current name
 * when the viewer owns it, else the name recorded on the entry
 * (for a guardian that is the redacted "Money Space").
 */
function spaceNameFor(state: SandboxState, entry: LedgerEntry): string {
  const space = entry.spaceId ? state.spaces.find((s) => s.id === entry.spaceId) : undefined;
  return space?.name ?? entry.counterparty.name;
}

function titleFor(state: SandboxState, entry: LedgerEntry): string {
  switch (entry.type) {
    case "space_allocation":
      return `Added to ${spaceNameFor(state, entry)}`;
    case "space_release":
      return `Moved from ${spaceNameFor(state, entry)}`;
    case "payment_sent":
      return `Payment to ${entry.counterparty.name}`;
    case "refund":
      return `Refund from ${entry.counterparty.name}`;
    case "allowance_debit":
      return `Pocket money to ${entry.counterparty.name}`;
    default:
      return TYPE_LABELS[entry.type];
  }
}

function subtitleFor(entry: LedgerEntry): string {
  switch (entry.type) {
    case "space_allocation":
      return "From available balance";
    case "space_release":
      return "Back to available balance";
    case "deposit":
    case "reversal":
      return entry.description;
    default:
      return `${entry.direction === "credit" ? "From" : "To"} ${entry.counterparty.name}`;
  }
}

function derivedStatus(
  ledger: readonly LedgerEntry[],
  entry: LedgerEntry,
): { status: TransactionStatus; text: string } {
  const compensations = ledger.filter((e) => e.relatedEntryId === entry.id);
  const corrected = compensatedAmount(ledger, entry.id);
  if (corrected >= entry.amount) {
    return compensations.some((e) => e.type === "reversal")
      ? { status: "reversed", text: "Reversed" }
      : { status: "reversed", text: "Refunded" };
  }
  if (corrected > 0) return { status: "completed", text: "Partly refunded" };
  return { status: "completed", text: "Completed" };
}

/** Display row for one entry (titles and signs decided once, here). */
export function toTransaction(state: SandboxState, entry: LedgerEntry): Transaction {
  const { text } = derivedStatus(state.ledger, entry);
  return {
    id: entry.id,
    title: titleFor(state, entry),
    subtitle: subtitleFor(entry),
    amount: entry.direction === "credit" ? entry.amount : -entry.amount,
    direction: entry.direction === "credit" ? "in" : "out",
    when: formatDateTime(entry.createdAt),
    ...(text !== "Completed" ? { statusLabel: text } : {}),
  };
}

/** A wallet's transactions, newest first. */
export function listTransactions(state: SandboxState, walletId: string): Transaction[] {
  return listWalletEntries(state, walletId).map((entry) => toTransaction(state, entry));
}

/**
 * Full, display-safe detail for one visible entry, or null when it
 * isn't in this scope (so another family's data can't be opened).
 */
export function getTransaction(state: SandboxState, entryId: string): TransactionDetails | null {
  const entry = state.ledger.find((e) => e.id === entryId);
  if (!entry) return null;
  const row = toTransaction(state, entry);
  const { status, text } = derivedStatus(state.ledger, entry);
  const owner = findUser(state, entry.accountId);
  const viewerId = state.session.currentUserId;
  const approval = entry.approvalId
    ? state.approvals.find((a) => a.id === entry.approvalId)
    : undefined;
  const original = entry.relatedEntryId
    ? state.ledger.find((e) => e.id === entry.relatedEntryId)
    : undefined;
  // Only the owner's own Spaces are in scope, so only they get a link.
  const space = entry.spaceId
    ? state.spaces.find((s) => s.id === entry.spaceId && s.ownerAccountId === viewerId)
    : undefined;
  return {
    ...row,
    type: entry.type,
    typeLabel: TYPE_LABELS[entry.type],
    status,
    statusText: text,
    reference: entry.reference,
    createdAt: entry.createdAt,
    magnitude: entry.amount,
    description: entry.description,
    walletLabel:
      entry.accountId === viewerId
        ? "Your wallet"
        : `${owner?.displayName ?? "Their"}'s wallet`,
    counterparty: {
      label: entry.direction === "credit" ? "From" : "To",
      name: isSpaceEntry(entry) ? spaceNameFor(state, entry) : entry.counterparty.name,
    },
    ...(entry.approvalId
      ? {
          approval: {
            decidedByName: approval?.decidedBy
              ? (findUser(state, approval.decidedBy)?.displayName ?? "Parent/guardian")
              : "Parent/guardian",
            ...(approval?.decidedAt ? { decidedAt: approval.decidedAt } : {}),
          },
        }
      : {}),
    ...(original ? { compensates: original.reference } : {}),
    ...(space ? { space: { id: space.id, name: space.name, archived: space.status === "archived" } } : {}),
    compensatedBy: state.ledger
      .filter(
        (e) =>
          e.relatedEntryId === entry.id && (e.type === "refund" || e.type === "reversal"),
      )
      .map((e) => ({
        reference: e.reference,
        amount: e.amount,
        kind: e.type === "refund" ? ("refund" as const) : ("reversal" as const),
      })),
    refundable: refundableAmount(state.ledger, entry),
  };
}

/** The teen wallet's transactions, latest first. */
export function selectTransactions(state: SandboxState): Transaction[] {
  return listTransactions(state, teenWalletId(state));
}

/** The teen wallet's entries newest first (for detail views). */
export function selectEntriesNewestFirst(state: SandboxState): LedgerEntry[] {
  return listWalletEntries(state, teenWalletId(state));
}

function teenEntries(state: SandboxState): LedgerEntry[] {
  return walletEntries(state.ledger, teenWalletId(state));
}

/** The teen wallet's available balance — the one figure every screen shows. */
export function selectAvailableBalance(state: SandboxState): number {
  return getBalance(state, teenWalletId(state));
}

/**
 * Available, allocated (in Money Spaces), total and upcoming money of
 * the teen wallet in view. For a guardian the allocated figure is the
 * aggregate only — never which Spaces.
 */
export function selectMoneySummary(state: SandboxState): MoneySummary {
  return deriveMoneySummary(teenEntries(state), state.requests);
}

/** Money set aside in Money Spaces (teen wallet in view). */
export function selectAllocatedTotal(state: SandboxState): number {
  return selectMoneySummary(state).allocated;
}

/** Total = available + allocated. */
export function selectTotal(state: SandboxState): number {
  return selectMoneySummary(state).total;
}

// ── Money Spaces (the query API) ─────────────────────────────────

/** A Space with everything derived from the ledger. */
export interface SpaceView extends MoneySpace {
  /** Derived: money moved in − money moved back. */
  balance: number;
  /** Total ever moved in. */
  contributed: number;
  /** Total ever moved back. */
  withdrawn: number;
  progress: SpaceProgress;
  deadlineInfo?: DeadlineInfo;
}

const spaceViewCache = new WeakMap<readonly MoneySpace[], Map<string, { ledger: readonly LedgerEntry[]; today: string; views: SpaceView[] }>>();

function buildSpaceViews(state: SandboxState, now: string): SpaceView[] {
  const today = productDay(now);
  const viewerId = state.session.currentUserId;
  const byOwner = spaceViewCache.get(state.spaces) ?? new Map();
  const cached = byOwner.get(viewerId);
  if (cached && cached.ledger === state.ledger && cached.today === today) return cached.views;
  const totals = spaceTotals(state.ledger);
  const views = state.spaces
    .filter((space) => space.ownerAccountId === viewerId)
    .map((space): SpaceView => {
      const t = totals.get(space.id) ?? { added: 0, withdrawn: 0 };
      const balance = t.added - t.withdrawn;
      return {
        ...space,
        balance,
        contributed: t.added,
        withdrawn: t.withdrawn,
        progress: spaceProgress(balance, space.targetAmount),
        ...(space.deadline ? { deadlineInfo: deadlineInfo(space.deadline, today) } : {}),
      };
    })
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "active" ? -1 : 1;
      if (a.status === "archived") return (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "");
      return a.displayOrder - b.displayOrder;
    });
  byOwner.set(viewerId, { ledger: state.ledger, today, views });
  spaceViewCache.set(state.spaces, byOwner);
  return views;
}

/**
 * The signed-in account's own Spaces: active ones in display order,
 * then archived ones (newest first). Memoized per state + day.
 */
export function selectSpaces(state: SandboxState, now: string = new Date().toISOString()): SpaceView[] {
  return buildSpaceViews(state, now);
}

export function selectActiveSpaces(state: SandboxState, now?: string): SpaceView[] {
  return selectSpaces(state, now).filter((s) => s.status === "active");
}

export function selectArchivedSpaces(state: SandboxState, now?: string): SpaceView[] {
  return selectSpaces(state, now).filter((s) => s.status === "archived");
}

/** One of the viewer's Spaces, or null (never another account's). */
export function getSpace(state: SandboxState, spaceId: string, now?: string): SpaceView | null {
  return selectSpaces(state, now).find((s) => s.id === spaceId) ?? null;
}

/** The viewer's default Save Space. */
export function selectSaveSpace(state: SandboxState, now?: string): SpaceView | null {
  return selectSpaces(state, now).find((s) => s.isDefault) ?? null;
}

export function getSpaceBalance(state: SandboxState, spaceId: string): number {
  return getSpace(state, spaceId)?.balance ?? 0;
}

export function getSpaceProgress(state: SandboxState, spaceId: string): SpaceProgress | null {
  return getSpace(state, spaceId)?.progress ?? null;
}

/** Goal remaining (null for Spaces without a target). */
export function getSpaceRemaining(state: SandboxState, spaceId: string): number | null {
  return getSpace(state, spaceId)?.progress.remaining ?? null;
}

/** A Space's movements, newest first (owner only). */
export function listSpaceEntries(state: SandboxState, spaceId: string): LedgerEntry[] {
  if (!getSpace(state, spaceId)) return [];
  return state.ledger
    .filter((e) => e.spaceId === spaceId && isSpaceEntry(e))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function selectSpaceActivity(state: SandboxState, spaceId: string): Transaction[] {
  return listSpaceEntries(state, spaceId).map((entry) => toTransaction(state, entry));
}

/**
 * Recent movements across all of the viewer's Spaces, newest first,
 * with their entries (for icons and day labels).
 */
export function selectRecentSpaceMoves(
  state: SandboxState,
  limit = 5,
): { entry: LedgerEntry; transaction: Transaction }[] {
  const mine = new Set(selectSpaces(state).map((s) => s.id));
  return state.ledger
    .filter((e) => e.spaceId !== undefined && mine.has(e.spaceId) && isSpaceEntry(e))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit)
    .map((entry) => ({ entry, transaction: toTransaction(state, entry) }));
}

/** Recent movements across all of the viewer's Spaces, newest first. */
export function selectRecentSpaceActivity(state: SandboxState, limit = 5): Transaction[] {
  return selectRecentSpaceMoves(state, limit).map((move) => move.transaction);
}

export function selectPendingRequests(state: SandboxState): MoneyRequest[] {
  return state.requests
    .filter((request) => request.status === "pending")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Notifications addressed to the current sandbox identity. */
export function selectMyNotifications(state: SandboxState): AppNotification[] {
  const me = state.session.currentUserId;
  return state.notifications.filter((n) => n.recipientId === me);
}

/** Unread count for the current sandbox identity only. */
export function selectUnreadNotificationCount(state: SandboxState): number {
  return selectMyNotifications(state).filter((n) => !n.read).length;
}

/** Lifetime in/out totals of the teen wallet (parent overview). */
export function selectFlowTotals(state: SandboxState): {
  moneyIn: number;
  moneyOut: number;
} {
  // Moves between the wallet and its own Money Spaces aren't money in
  // or out — the money never leaves the teen's wallet.
  return teenEntries(state).filter((entry) => !isSpaceEntry(entry)).reduce(
    (totals, entry) =>
      entry.direction === "credit"
        ? { ...totals, moneyIn: totals.moneyIn + entry.amount }
        : { ...totals, moneyOut: totals.moneyOut + entry.amount },
    { moneyIn: 0, moneyOut: 0 },
  );
}

// ── Session, identity & family ───────────────────────────────────

export interface SessionView {
  user: User;
  role: UserRole;
  /** The family the current user belongs to, or null (e.g. an unlinked guardian). */
  family: Family | null;
}

export function selectSession(state: SandboxState): SessionView {
  const user = currentUser(state);
  return {
    user,
    role: user.role,
    family: familyMember(state, user.id) ? state.family : null,
  };
}

/** The teen whose wallet this view holds (teen screens only). */
export function selectTeen(state: SandboxState): User {
  return primaryTeen(state);
}

/** Same, but null when the view has no teen (e.g. an unconnected parent). */
export function selectMaybeTeen(state: SandboxState): User | null {
  return maybePrimaryTeen(state);
}

/** A sandbox identity by role — the targets of "Switch role". */
export function selectIdentity(state: SandboxState, role: UserRole): User | null {
  return state.users.find((user) => user.role === role) ?? null;
}

export function selectLink(state: SandboxState, teenId: string): GuardianLink | null {
  return linkFor(state, teenId);
}

export function selectLinkedGuardian(state: SandboxState, teenId: string): User | null {
  return linkedGuardian(state, teenId);
}

/** Teens connected to a guardian. */
export function selectTeensOf(state: SandboxState, guardianId: string): User[] {
  return teensOfGuardian(state, guardianId);
}

/** Only controls that are in force (a guardian is linked). */
export function selectControls(state: SandboxState, teenId: string): GuardianControls | null {
  return activeControls(state, teenId);
}

export function selectSpendingStatus(
  state: SandboxState,
  teenId: string,
  at: string = new Date().toISOString(),
): SpendingStatus {
  return spendingStatus(state, teenId, at);
}

/**
 * The invite currently attached to a teen's link, with whether it has
 * run out of time (the teen sees "expired" and can make a new one).
 */
export function selectCurrentInvite(
  state: SandboxState,
  teenId: string,
  at: string = new Date().toISOString(),
): { invite: FamilyInvite; expired: boolean } | null {
  const link = linkFor(state, teenId);
  const invite = link?.inviteId
    ? state.family.invites.find((i) => i.id === link.inviteId)
    : undefined;
  if (!invite || (invite.status !== "open" && invite.status !== "claimed")) return null;
  return { invite, expired: isInviteExpired(invite, at) };
}

/** The invite a guardian is currently reviewing, if any. */
export function selectClaimedInvite(
  state: SandboxState,
  guardianId: string,
): FamilyInvite | null {
  return (
    state.family.invites.find(
      (i) => i.status === "claimed" && i.claimedBy === guardianId,
    ) ?? null
  );
}

/** Active family members with their identities, guardians first. */
export function selectFamilyMembers(
  state: SandboxState,
): { user: User; role: "teen" | "guardian"; relationship?: "parent" | "guardian" }[] {
  return state.family.members
    .filter((member) => member.status === "active")
    .map((member) => {
      const user = findUser(state, member.accountId);
      return user
        ? { user, role: member.role, relationship: member.relationship }
        : null;
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => (a.role === b.role ? 0 : a.role === "guardian" ? -1 : 1));
}

// ── Approvals ────────────────────────────────────────────────────

export function selectPendingApprovals(
  state: SandboxState,
  filter: { teenId?: string; guardianId?: string } = {},
): ApprovalRequest[] {
  return state.approvals
    .filter(
      (a) =>
        a.status === "pending" &&
        (filter.teenId === undefined || a.teenId === filter.teenId) &&
        (filter.guardianId === undefined || a.guardianId === filter.guardianId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Recently decided approvals (for history rows). */
export function selectRecentApprovalDecisions(
  state: SandboxState,
  limit = 3,
): ApprovalRequest[] {
  return state.approvals
    .filter((a) => a.status !== "pending")
    .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))
    .slice(0, limit);
}

/** Family/approval log, newest first. */
export function selectFamilyEvents(state: SandboxState, limit?: number): DomainEvent[] {
  return limit === undefined ? state.familyEvents : state.familyEvents.slice(0, limit);
}

/** The most recent pocket-money entry, if any. */
export function selectLastAllowance(state: SandboxState): LedgerEntry | null {
  return teenEntries(state)
    .filter((entry) => entry.type === "allowance_credit")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
