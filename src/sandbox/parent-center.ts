import {
  describePocketMoneyCadence,
  formatUsername,
  type ApprovalRequest,
  type GuardianControls,
  type LedgerEntry,
  type MembershipStatus,
  type PocketMoneyScheduleStatus,
  type Transaction,
  type User,
  type Wallet,
  type WalletStatus,
} from "@/domain";
import { formatDayLabel } from "@/lib/format";
import { canManageSpendingRules, canViewTeenOverview } from "./authorization";
import { maybePrimaryTeen, teensOfGuardian } from "./identity";
import {
  getBalance,
  listWalletEntries,
  selectAllocatedTotal,
  selectClaimedInvite,
  selectControls,
  selectOpenSchedule,
  selectPendingApprovals,
  selectRecentApprovalDecisions,
  selectTotal,
  toTransaction,
} from "./selectors";
import type { SandboxState } from "./types";

/**
 * Parent Control Center projections (Phase 15).
 *
 * The one place parent-facing data is assembled. Every field is
 * chosen explicitly — no raw account, wallet or ledger records are
 * ever handed to the UI, and no object spreading builds a "safe"
 * profile. What a parent sees here is exactly what the existing
 * family + guardian + authorization architecture already allows:
 *
 *   · identity      display name, TeenPay ID and initials only
 *   · family        membership status and connection state
 *   · money         available / set aside / total — and only for the
 *                   wallet the parent's scope can actually see
 *   · controls      the guardian rules already in force
 *   · approvals     requests addressed to this guardian
 *   · allowance     the existing pocket money schedule
 *   · activity      derived transaction summaries, never raw entries
 *
 * Everything teen-private (Coach, Missions, Friend Circles, Safety
 * Shield, favourites, searches, QR scans, notifications) is simply
 * not part of this vocabulary.
 */

/** What the center may display about a person. */
export interface ParentCenterIdentity {
  accountId: string;
  /** Short display name, e.g. "Aarav". */
  displayName: string;
  /** Full name, e.g. "Aarav Sharma". */
  fullName: string;
  /** TeenPay ID, e.g. "@aarav" — the only handle parents ever see. */
  handle: string;
  initials: string;
}

/** The selected teen's money, or null when the wallet isn't in this scope. */
export interface ParentCenterMoney {
  available: number;
  /** Aggregate only — which Spaces and their goals stay the teen's. */
  allocated: number;
  total: number;
}

export interface ParentCenterWallet {
  walletId: string;
  status: WalletStatus;
}

export interface ParentCenterApprovals {
  pending: ApprovalRequest[];
  recentDecisions: ApprovalRequest[];
}

/**
 * One activity row: the derived transaction summary plus the entry
 * type (for its icon). Never the raw ledger entry itself.
 */
export interface ParentActivityRow extends Transaction {
  entryType: LedgerEntry["type"];
}

export interface ParentCenterAllowance {
  scheduleId: string;
  status: PocketMoneyScheduleStatus;
  amount: number;
  /** "Weekly" / "Monthly" plus the day, in the engine's words. */
  cadence: string;
  /** Null while paused or ended. */
  nextRunAt: string | null;
  version: number;
}

export interface ParentCenterFamily {
  membership: MembershipStatus | null;
  /** The guardian is linked and controls are in force. */
  connected: boolean;
  /** Money details are visible for this teen in the current scope. */
  walletVisible: boolean;
}

export interface TeenCenterView {
  teen: ParentCenterIdentity;
  family: ParentCenterFamily;
  money: ParentCenterMoney | null;
  wallet: ParentCenterWallet | null;
  controls: GuardianControls | null;
  /** UI hint only — every transition re-authorizes itself. */
  mayManageRules: boolean;
  approvals: ParentCenterApprovals;
  allowance: ParentCenterAllowance | null;
  /** Derived summaries (never raw entries); empty when not visible. */
  activity: ParentActivityRow[];
}

export interface ParentCenterView {
  parent: ParentCenterIdentity;
  /** Linked teens this parent may manage — nothing else, ever. */
  teens: TeenCenterView[];
  /** A teen's invite the parent still needs to review, if any. */
  invitePendingReview: { teenName: string } | null;
  /**
   * The family's wallet teen — the one whose money figures are in
   * scope. Labels balances honestly instead of implying they belong
   * to every listed teen.
   */
  walletTeenId: string | null;
}

function identityOf(user: User): ParentCenterIdentity {
  return {
    accountId: user.id,
    displayName: user.displayName,
    fullName: user.name,
    handle: formatUsername(user),
    initials: user.avatarInitials,
  };
}

/**
 * The center for one linked teen, or null when this parent may not
 * view them. Authorization comes from the existing architecture —
 * the projection never widens it.
 */
export function selectTeenCenter(
  state: SandboxState,
  parentId: string,
  teenId: string,
): TeenCenterView | null {
  const teen = teensOfGuardian(state, parentId).find((t) => t.id === teenId);
  if (!teen) return null; // linked teens only — never an arbitrary id
  if (!canViewTeenOverview(state, parentId, teenId)) return null;

  // The wallet is only in scope for the family's wallet teen — the
  // scope itself already excludes everyone else's money. Each sandbox
  // account owns exactly one wallet, so a plain lookup is enough.
  const wallet: Wallet | null =
    state.wallets.find((w) => w.ownerAccountId === teenId) ?? null;
  const walletVisible = wallet !== null;

  const member = state.family.members.find((m) => m.accountId === teenId);
  const open = selectOpenSchedule(state, parentId, teenId);

  return {
    teen: identityOf(teen),
    family: {
      membership: member?.status ?? null,
      connected: selectControls(state, teenId) !== null,
      walletVisible,
    },
    money: walletVisible
      ? {
          available: getBalance(state, wallet.id),
          allocated: selectAllocatedTotal(state),
          total: selectTotal(state),
        }
      : null,
    wallet: walletVisible ? { walletId: wallet.id, status: wallet.status } : null,
    controls: selectControls(state, teenId),
    mayManageRules: canManageSpendingRules(state, parentId, teenId),
    approvals: {
      pending: selectPendingApprovals(state, { teenId, guardianId: parentId }),
      recentDecisions: selectRecentApprovalDecisions(state, 3).filter(
        (a) => a.teenId === teenId && a.guardianId === parentId,
      ),
    },
    allowance: open
      ? {
          scheduleId: open.id,
          status: open.status,
          amount: open.amount,
          cadence: describePocketMoneyCadence(open),
          nextRunAt: open.nextRunAt,
          version: open.version,
        }
      : null,
    activity: walletVisible
      ? listWalletEntries(state, wallet.id)
          .slice(0, 4)
          .map((entry) => {
            const row = toTransaction(state, entry);
            return {
              id: row.id,
              title: row.title,
              subtitle: formatDayLabel(entry.createdAt),
              amount: row.amount,
              direction: row.direction,
              when: formatDayLabel(entry.createdAt),
              entryType: entry.type,
              ...(row.statusLabel ? { statusLabel: row.statusLabel } : {}),
            };
          })
      : [],
  };
}

/**
 * The whole center for the signed-in parent: their linked teens and
 * nothing else. Returns null for unknown or unavailable accounts.
 */
export function selectParentCenter(
  state: SandboxState,
  parentId: string,
): ParentCenterView | null {
  const parent = state.users.find((u) => u.id === parentId && u.status === "active");
  if (!parent || parent.role !== "parent") return null;

  const teens = teensOfGuardian(state, parentId)
    .map((teen) => selectTeenCenter(state, parentId, teen.id))
    .filter((view): view is TeenCenterView => view !== null);

  // The wallet summary figures belong to the family's wallet teen —
  // label them honestly instead of implying they're per-teen.
  const claimed = selectClaimedInvite(state, parentId);
  const reviewLink = claimed
    ? state.family.links.find(
        (l) => l.status === "invitation_pending" && l.teenId === claimed.teenId,
      )
    : undefined;
  const reviewTeen = reviewLink
    ? state.users.find((u) => u.id === reviewLink.teenId) ?? null
    : null;

  return {
    parent: identityOf(parent),
    teens,
    invitePendingReview:
      reviewTeen !== null ? { teenName: reviewTeen.displayName } : null,
    walletTeenId: maybePrimaryTeen(state)?.id ?? null,
  };
}
