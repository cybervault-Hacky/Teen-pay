import type { ApprovalRequest } from "./approval";
import type {
  PocketMoneyFailureReason,
  PocketMoneySchedule,
} from "./allowance";
import type {
  ApprovalRule,
  LegacyAllowancePreview,
  GuardianNotificationSettings,
  SpendingLimits,
} from "./safety";

/**
 * Domain events — the vocabulary for "what just happened".
 *
 * Sandbox transitions return the events they caused. One projector
 * turns events into notifications (and a family activity log), so
 * notifications always reflect real domain changes and are never
 * written by hand in UI code.
 *
 * Financial truth still lives only in the ledger: money events
 * reference ledger entry ids, they don't replace them.
 */

interface EventBase {
  /** Deterministic from the operation id, so replays dedupe. */
  id: string;
  /** Who performed the action. */
  actorId: string;
  /** ISO 8601 timestamp. */
  at: string;
}

export type DomainEvent =
  // Money (the ledger entry is the source of truth)
  | (EventBase & {
      type: "payment_sent";
      entryId: string;
      teenId: string;
      amount: number;
      recipientName: string;
      note?: string;
      approvalId?: string;
    })
  | (EventBase & {
      type: "request_created";
      requestId: string;
      amount: number;
      recipientName: string;
      note?: string;
    })
  | (EventBase & {
      type: "request_paid";
      requestId: string;
      entryId: string;
      amount: number;
      recipientName: string;
    })
  // TeenPay-to-TeenPay (Phase 8). Handles are display snapshots.
  | (EventBase & {
      type: "peer_transfer_completed";
      /** The transfer operation id (its idempotency key). */
      operationId: string;
      reference: string;
      senderId: string;
      recipientId: string;
      senderHandle: string;
      recipientHandle: string;
      amount: number;
      /** Set when this transfer paid a money request. */
      requestId?: string;
      /** Set when a guardian approval released it. */
      approvalId?: string;
    })
  | (EventBase & {
      type: "peer_request_created";
      requestId: string;
      requesterId: string;
      payerId: string;
      requesterHandle: string;
      payerHandle: string;
      amount: number;
      note?: string;
    })
  | (EventBase & {
      type: "peer_request_declined" | "peer_request_cancelled";
      requestId: string;
      requesterId: string;
      payerId: string;
      requesterHandle: string;
      payerHandle: string;
      amount: number;
    })
  | (EventBase & {
      type: "allowance_sent";
      entryId: string;
      teenId: string;
      guardianId: string;
      amount: number;
    })
  | (EventBase & {
      type: "refund_received";
      entryId: string;
      /** The payment being refunded. */
      relatedEntryId: string;
      teenId: string;
      amount: number;
      fromName: string;
      reference: string;
    })
  // Wallet state (sandbox only — not a card or bank freeze)
  | (EventBase & { type: "wallet_frozen"; walletId: string; teenId: string })
  | (EventBase & { type: "wallet_unfrozen"; walletId: string; teenId: string })
  // Money Spaces (the owner's own money, set aside)
  | (EventBase & {
      type: "savings_moved";
      entryId: string;
      teenId: string;
      amount: number;
      spaceId: string;
      /** in = added to the Space; out = moved back to available. */
      direction: "in" | "out";
    })
  | (EventBase & {
      type: "space_goal_reached";
      teenId: string;
      spaceId: string;
      spaceName: string;
      target: number;
    })
  | (EventBase & {
      type: "space_archived";
      teenId: string;
      spaceId: string;
      spaceName: string;
      /** Rupees moved back to available as part of archiving. */
      returned: number;
    })
  // Family
  | (EventBase & { type: "family_invite_created"; teenId: string; code: string })
  | (EventBase & { type: "family_invite_cancelled"; teenId: string })
  | (EventBase & {
      type: "family_invite_claimed";
      teenId: string;
      guardianId: string;
    })
  | (EventBase & { type: "family_linked"; teenId: string; guardianId: string })
  | (EventBase & {
      type: "family_unlinked";
      teenId: string;
      guardianId: string;
      cancelledApprovals: number;
    })
  // Controls
  | (EventBase & {
      type: "spending_limit_updated";
      teenId: string;
      limits: SpendingLimits;
      approval: ApprovalRule;
    })
  | (EventBase & {
      type: "guardian_notifications_updated";
      teenId: string;
      notifications: GuardianNotificationSettings;
    })
  /** Legacy (Phase 3 preview): readable in old logs, never emitted. */
  | (EventBase & {
      type: "allowance_schedule_updated";
      teenId: string;
      schedule: LegacyAllowancePreview | null;
    })
  // Pocket Money Autopilot (the ledger holds the money; these point at it)
  | (EventBase & {
      type: "pocket_money_schedule_changed";
      scheduleId: string;
      teenId: string;
      guardianId: string;
      change: "created" | "updated" | "paused" | "resumed" | "cancelled" | "completed";
      /** A snapshot of the plan after the change (no money data). */
      amount: number;
      frequency: PocketMoneySchedule["frequency"];
      dayOfWeek: number;
      dayOfMonth: number;
      endedReason?: PocketMoneySchedule["endedReason"];
    })
  | (EventBase & {
      type: "pocket_money_paid";
      scheduleId: string;
      runId: string;
      teenId: string;
      guardianId: string;
      amount: number;
      reference: string;
      occurrence: string;
    })
  | (EventBase & {
      type: "pocket_money_failed";
      scheduleId: string;
      runId: string;
      teenId: string;
      guardianId: string;
      amount: number;
      occurrence: string;
      reason: PocketMoneyFailureReason;
      message: string;
    })
  // Approvals
  | (EventBase & { type: "approval_requested"; approval: ApprovalRequest })
  | (EventBase & {
      type: "approval_approved";
      approval: ApprovalRequest;
      entryId: string;
    })
  | (EventBase & { type: "approval_declined"; approval: ApprovalRequest })
  | (EventBase & { type: "approval_cancelled"; approval: ApprovalRequest });

export type DomainEventType = DomainEvent["type"];

/** Events that belong in the family activity log (non-financial). */
export const FAMILY_EVENT_TYPES: ReadonlySet<DomainEventType> = new Set([
  "family_invite_created",
  "family_invite_cancelled",
  "family_invite_claimed",
  "family_linked",
  "family_unlinked",
  "spending_limit_updated",
  "guardian_notifications_updated",
  "allowance_schedule_updated",
  "pocket_money_schedule_changed",
  "approval_requested",
  "approval_approved",
  "approval_declined",
  "approval_cancelled",
  "wallet_frozen",
  "wallet_unfrozen",
]);

export function isFamilyEvent(event: DomainEvent): boolean {
  return FAMILY_EVENT_TYPES.has(event.type);
}
