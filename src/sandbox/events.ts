import {
  describePocketMoneyCadence,
  isFamilyEvent,
  type AppNotification,
  type LegacyAllowancePreview,
  type ApprovalRule,
  type DomainEvent,
  type GuardianNotificationSettings,
  type NotificationKind,
  type SpendingLimits,
} from "@/domain";
import { formatINR } from "@/lib/currency";
import { activeControls, findUser } from "./identity";
import { FAMILY_EVENT_LOG_LIMIT, type SandboxState } from "./types";

/**
 * The event projector.
 *
 * Transitions report what happened as `DomainEvent`s; this module
 * is the only place those events become notifications (per
 * recipient) and family-log entries. Notification copy therefore
 * always matches a real domain change.
 *
 * Replays are safe: event and notification ids are deterministic,
 * and anything already recorded is skipped.
 */

function nameOf(state: SandboxState, userId: string): string {
  return findUser(state, userId)?.displayName ?? "Someone";
}

/** The Phase 3 preview's cadence, in today's cadence shape. */
function legacyCadence(preview: LegacyAllowancePreview): string {
  return describePocketMoneyCadence({
    frequency: preview.frequency,
    dayOfWeek: preview.weekday,
    dayOfMonth: preview.dayOfMonth,
  });
}

type ScheduleChanged = Extract<DomainEvent, { type: "pocket_money_schedule_changed" }>;

function planText(event: ScheduleChanged): string {
  return `${formatINR(event.amount)} · ${describePocketMoneyCadence(event)}`;
}

/**
 * Pocket money notifications. The parent hears about pausing,
 * resuming and completion; the teen about anything that changes what
 * they'll receive. Stopping on disconnect is announced by the
 * disconnect itself, so it adds nothing.
 */
function scheduleDrafts(state: SandboxState, event: ScheduleChanged): Draft[] {
  const parent = nameOf(state, event.guardianId);
  const teen = nameOf(state, event.teenId);
  const plan = planText(event);
  switch (event.change) {
    case "created":
      return [{ to: event.teenId, kind: "money", title: "Pocket money scheduled", body: `${plan} from ${parent}.` }];
    case "updated":
      return [{ to: event.teenId, kind: "money", title: "Pocket money updated", body: `Now ${plan} from ${parent}.` }];
    case "paused":
      return [
        { to: event.guardianId, kind: "money", title: "Pocket money paused", body: `${plan} to ${teen}. Nothing is sent until you resume.` },
        { to: event.teenId, kind: "money", title: "Pocket money paused", body: `${parent} paused your ${formatINR(event.amount)} pocket money.` },
      ];
    case "resumed":
      return [
        { to: event.guardianId, kind: "money", title: "Pocket money resumed", body: `${plan} to ${teen}, from the next transfer day.` },
        { to: event.teenId, kind: "money", title: "Pocket money resumed", body: `${plan} from ${parent}.` },
      ];
    case "cancelled":
      return event.endedReason === "family_disconnected"
        ? []
        : [{ to: event.teenId, kind: "money", title: "Pocket money stopped", body: `${parent} cancelled ${plan}. Past pocket money stays in your history.` }];
    case "completed":
      return [
        { to: event.guardianId, kind: "money", title: "Schedule completed", body: `The last ${formatINR(event.amount)} pocket money to ${teen} was processed.` },
        { to: event.teenId, kind: "money", title: "Schedule completed", body: `Your ${formatINR(event.amount)} pocket money from ${parent} has finished.` },
      ];
  }
}

/** "Daily limit ₹500 · Up to ₹1,000 per payment · Approval above ₹500" */
export function summarizeSpendingRules(
  limits: SpendingLimits,
  approval: ApprovalRule,
): string {
  const parts: string[] = [];
  if (limits.dailyLimit !== null) {
    parts.push(`Daily limit ${formatINR(limits.dailyLimit)}`);
  }
  if (limits.perTransactionLimit !== null) {
    parts.push(`Up to ${formatINR(limits.perTransactionLimit)} per payment`);
  }
  if (approval.threshold !== null) {
    parts.push(`Approval above ${formatINR(approval.threshold)}`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No spending rules are on.";
}

export function summarizeGuardianNotifications(
  settings: GuardianNotificationSettings,
): string {
  const items = [
    settings.payments ? "payments" : null,
    settings.savings ? "savings" : null,
    "approval requests",
  ].filter((item): item is string => item !== null);
  return items.join(", ");
}

interface Draft {
  to: string;
  kind: NotificationKind;
  title: string;
  body: string;
}

function drafts(state: SandboxState, event: DomainEvent): Draft[] {
  switch (event.type) {
    case "payment_sent": {
      const out: Draft[] = [];
      // Approved payments are announced by approval_approved instead.
      if (!event.approvalId) {
        out.push({
          to: event.teenId,
          kind: "money",
          title: "Payment sent",
          body: `${formatINR(event.amount)} to ${event.recipientName}${
            event.note ? ` · ${event.note}` : ""
          }.`,
        });
        const controls = activeControls(state, event.teenId);
        const guardianId = state.family.links.find(
          (l) => l.teenId === event.teenId,
        )?.guardianId;
        if (controls?.notifications.payments && guardianId) {
          out.push({
            to: guardianId,
            kind: "money",
            title: `${nameOf(state, event.teenId)} sent a payment`,
            body: `${formatINR(event.amount)} to ${event.recipientName}.`,
          });
        }
      }
      return out;
    }
    case "request_created":
      return [
        {
          to: event.actorId,
          kind: "money",
          title: "Request sent",
          body: `You requested ${formatINR(event.amount)} from ${event.recipientName}${
            event.note ? ` · ${event.note}` : ""
          }.`,
        },
      ];
    case "request_paid":
      return [
        {
          to: event.actorId,
          kind: "money",
          title: "Request paid",
          body: `${event.recipientName} paid ${formatINR(event.amount)}.`,
        },
      ];
    case "peer_transfer_completed": {
      const amount = formatINR(event.amount);
      const out: Draft[] = [];
      if (event.requestId) {
        out.push({
          to: event.recipientId,
          kind: "money",
          title: `${amount} request was paid.`,
          body: `${event.senderHandle} paid your request · ${event.reference}.`,
        });
      } else {
        out.push({
          to: event.recipientId,
          kind: "money",
          title: `You received ${amount}.`,
          body: `From ${event.senderHandle} · ${event.reference}.`,
        });
      }
      // A guardian-approved transfer is announced to the sender by
      // approval_approved instead (no double notice).
      if (!event.approvalId) {
        out.push({
          to: event.senderId,
          kind: "money",
          title: `${amount} sent to ${event.recipientHandle}.`,
          body: event.requestId
            ? `You paid ${event.recipientHandle}'s request · ${event.reference}.`
            : `Reference ${event.reference}.`,
        });
        const controls = activeControls(state, event.senderId);
        const guardianId = state.family.links.find((l) => l.teenId === event.senderId)?.guardianId;
        if (controls?.notifications.payments && guardianId) {
          out.push({
            to: guardianId,
            kind: "money",
            title: `${nameOf(state, event.senderId)} sent money`,
            body: `${amount} to ${event.recipientHandle}.`,
          });
        }
      }
      return out;
    }
    case "peer_request_created":
      return [
        {
          to: event.requesterId,
          kind: "money",
          title: "Money request sent.",
          body: `You asked ${event.payerHandle} for ${formatINR(event.amount)}${event.note ? ` · ${event.note}` : ""}.`,
        },
        {
          to: event.payerId,
          kind: "money",
          title: `${event.requesterHandle} requested ${formatINR(event.amount)}.`,
          body: event.note ? `${event.note} · Pay or decline in Requests.` : "Pay or decline in Requests.",
        },
      ];
    case "peer_request_declined":
      return [
        {
          to: event.requesterId,
          kind: "money",
          title: "Money request declined.",
          body: `${event.payerHandle} declined your ${formatINR(event.amount)} request. No money moved.`,
        },
      ];
    case "peer_request_cancelled":
      return [
        {
          to: event.payerId,
          kind: "money",
          title: "Money request cancelled.",
          body: `${event.requesterHandle} cancelled their ${formatINR(event.amount)} request. No money moved.`,
        },
      ];
    // Friend Circles: one quiet notice where it's useful — a new
    // request reaches the recipient, an acceptance the requester.
    // Declines, cancellations and removals are deliberately silent
    // (no loops, no pressure). A friendship never moves money.
    case "friend_request_received":
      return [
        {
          to: event.recipientId,
          kind: "system",
          title: "New friend request",
          body: `${event.requesterHandle} wants to join your Friend Circle.`,
        },
      ];
    case "friend_request_accepted":
      return [
        {
          to: event.requesterId,
          kind: "system",
          title: "Friend request accepted",
          body: `${event.recipientHandle} accepted your request. You're now friends.`,
        },
      ];
    case "allowance_sent":
      return [
        {
          to: event.teenId,
          kind: "money",
          title: "Pocket money received",
          body: `${formatINR(event.amount)} from ${nameOf(state, event.guardianId)} is in ${nameOf(state, event.teenId)}'s wallet.`,
        },
      ];
    case "refund_received":
      return [
        {
          to: event.teenId,
          kind: "money",
          title: "Refund received",
          body: `${formatINR(event.amount)} from ${event.fromName} is back in your wallet · ${event.reference}.`,
        },
      ];
    case "wallet_frozen":
    case "wallet_unfrozen": {
      // Tell the other side: the teen when a guardian acts, the linked
      // guardian when the teen acts. The actor sees it on screen.
      const guardianId = state.family.links.find(
        (l) => l.teenId === event.teenId && l.status === "linked",
      )?.guardianId;
      const to = event.actorId === event.teenId ? guardianId : event.teenId;
      if (!to) return [];
      const teen = nameOf(state, event.teenId);
      const who = event.actorId === event.teenId ? teen : nameOf(state, event.actorId);
      return [
        event.type === "wallet_frozen"
          ? {
              to,
              kind: "safety",
              title: "Wallet frozen",
              body: `${who} froze ${teen}'s sandbox wallet. Balance and history stay visible; no money can move until it's unfrozen.`,
            }
          : {
              to,
              kind: "safety",
              title: "Wallet unfrozen",
              body: `${who} unfroze ${teen}'s sandbox wallet. Money can move again.`,
            },
      ];
    }
    case "savings_moved": {
      // Guardians who opted in hear that money was set aside — never
      // which Space, its name or its target (those stay private).
      if (event.direction !== "in") return [];
      const controls = activeControls(state, event.teenId);
      const guardianId = state.family.links.find(
        (l) => l.teenId === event.teenId,
      )?.guardianId;
      if (!controls?.notifications.savings || !guardianId) return [];
      return [
        {
          to: guardianId,
          kind: "goal",
          title: "Saving progress",
          body: `${nameOf(state, event.teenId)} set aside ${formatINR(event.amount)} in a Money Space.`,
        },
      ];
    }
    case "space_goal_reached":
      return [
        {
          to: event.teenId,
          kind: "goal",
          title: "Goal reached",
          body: `${event.spaceName} has reached its ${formatINR(event.target)} target. Nothing moves automatically — the money stays in the goal until you move it.`,
        },
      ];
    case "space_archived":
      return [
        {
          to: event.teenId,
          kind: "goal",
          title: "Space archived",
          body:
            event.returned > 0
              ? `${event.spaceName} was archived and ${formatINR(event.returned)} moved back to your available balance. Its history stays in Activity.`
              : `${event.spaceName} was archived. Its history stays in Activity.`,
        },
      ];
    case "family_invite_created":
    case "family_invite_cancelled":
      return [];
    case "family_invite_claimed":
      return [
        {
          to: event.teenId,
          kind: "family",
          title: "Invite being reviewed",
          body: `${nameOf(state, event.guardianId)} entered your invite code and is reviewing it.`,
        },
      ];
    case "family_linked":
      return [
        {
          to: event.teenId,
          kind: "family",
          title: "Family connected",
          body: `${nameOf(state, event.guardianId)} is connected as your parent/guardian.`,
        },
        {
          to: event.guardianId,
          kind: "family",
          title: "Family connected",
          body: `You're connected with ${nameOf(state, event.teenId)}. Family controls are now available.`,
        },
      ];
    case "family_unlinked": {
      const cancelled =
        event.cancelledApprovals > 0
          ? ` ${event.cancelledApprovals === 1 ? "A pending approval was" : `${event.cancelledApprovals} pending approvals were`} cancelled.`
          : "";
      return [
        {
          to: event.teenId,
          kind: "family",
          title: "Family disconnected",
          body: `${nameOf(state, event.guardianId)} is no longer connected. Your money and activity history are unchanged.${cancelled}`,
        },
        {
          to: event.guardianId,
          kind: "family",
          title: "Family disconnected",
          body: `You're no longer connected with ${nameOf(state, event.teenId)}.${cancelled}`,
        },
      ];
    }
    case "spending_limit_updated":
      return [
        {
          to: event.teenId,
          kind: "safety",
          title: "Spending rules updated",
          body: `${nameOf(state, event.actorId)} updated your rules: ${summarizeSpendingRules(event.limits, event.approval)}`,
        },
      ];
    case "guardian_notifications_updated":
      return [
        {
          to: event.teenId,
          kind: "family",
          title: "Parent notifications updated",
          body: `${nameOf(state, event.actorId)} is notified about ${summarizeGuardianNotifications(event.notifications)}.`,
        },
      ];
    case "allowance_schedule_updated":
      // Legacy preview events are never emitted any more.
      return [];
    case "pocket_money_schedule_changed":
      return scheduleDrafts(state, event);
    case "pocket_money_paid":
      return [
        {
          to: event.guardianId,
          kind: "money",
          title: "Pocket money sent",
          body: `${formatINR(event.amount)} to ${nameOf(state, event.teenId)} · ${event.reference}.`,
        },
        {
          to: event.teenId,
          kind: "money",
          title: "Pocket money received",
          body: `${formatINR(event.amount)} from ${nameOf(state, event.guardianId)} · ${event.reference}.`,
        },
      ];
    case "pocket_money_failed":
      return [
        {
          to: event.guardianId,
          kind: "money",
          title: "Pocket money not sent",
          body: event.message,
        },
        {
          // The reason stays private (it may be about the parent's balance).
          to: event.teenId,
          kind: "money",
          title: "Pocket money didn't arrive",
          body: `The ${formatINR(event.amount)} from ${nameOf(state, event.guardianId)} wasn't sent this time.`,
        },
      ];
    case "approval_requested": {
      const a = event.approval;
      return [
        {
          to: a.teenId,
          kind: "approval",
          title: "Approval requested",
          body: `Your ${formatINR(a.amount)} payment to ${a.recipientName} is waiting for ${nameOf(state, a.guardianId)}.`,
        },
        {
          to: a.guardianId,
          kind: "approval",
          title: "New approval request",
          body: `${nameOf(state, a.teenId)} wants to send ${formatINR(a.amount)} to ${a.recipientName}.`,
        },
      ];
    }
    case "approval_approved": {
      const a = event.approval;
      // A TeenPay transfer: the sender's "sent" notice, with who approved.
      if (a.kind === "transfer") {
        return [
          {
            to: a.teenId,
            kind: "approval",
            title: `${formatINR(a.amount)} sent to ${a.recipientName}.`,
            body: `${nameOf(state, a.guardianId)} approved it.`,
          },
        ];
      }
      return [
        {
          to: a.teenId,
          kind: "approval",
          title: "Payment approved",
          body: `${nameOf(state, a.guardianId)} approved ${formatINR(a.amount)} to ${a.recipientName}. It's been sent.`,
        },
      ];
    }
    case "approval_declined": {
      const a = event.approval;
      return [
        {
          to: a.teenId,
          kind: "approval",
          title: a.kind === "transfer" ? "Transfer not approved" : "Payment not approved",
          body: `${nameOf(state, a.guardianId)} declined ${formatINR(a.amount)} to ${a.recipientName}. No money moved.`,
        },
      ];
    }
    case "approval_cancelled": {
      const a = event.approval;
      // System cancellations (e.g. disconnect) are covered by that event.
      if (event.actorId !== a.teenId || a.cancelReason) return [];
      return [
        {
          to: a.guardianId,
          kind: "approval",
          title: "Approval request withdrawn",
          body: `${nameOf(state, a.teenId)} cancelled the ${formatINR(a.amount)} request to ${a.recipientName}.`,
        },
      ];
    }
  }
}

export function notificationsForEvent(
  state: SandboxState,
  event: DomainEvent,
): AppNotification[] {
  return drafts(state, event).map((draft) => ({
    id: `ntf_${event.id}_${draft.to}`,
    recipientId: draft.to,
    kind: draft.kind,
    title: draft.title,
    body: draft.body,
    read: false,
    createdAt: event.at,
  }));
}

/**
 * Applies events to state: new notifications for each recipient,
 * and family/approval events appended to the (capped) family log.
 * Never touches the ledger.
 */
export function commitEvents(
  state: SandboxState,
  events: DomainEvent[],
): SandboxState {
  let next = state;
  for (const event of events) {
    const known = new Set(next.notifications.map((n) => n.id));
    const fresh = notificationsForEvent(next, event).filter(
      (n) => !known.has(n.id),
    );
    const log =
      isFamilyEvent(event) && !next.familyEvents.some((e) => e.id === event.id)
        ? [event, ...next.familyEvents].slice(0, FAMILY_EVENT_LOG_LIMIT)
        : next.familyEvents;
    if (fresh.length === 0 && log === next.familyEvents) continue;
    next = {
      ...next,
      notifications: [...fresh, ...next.notifications],
      familyEvents: log,
    };
  }
  return next;
}

/** Display copy for one family-log entry, from the viewer's side. */
export function describeFamilyEvent(
  state: SandboxState,
  event: DomainEvent,
  viewerId: string,
): { title: string; detail: string } {
  const you = (userId: string) =>
    userId === viewerId ? "You" : nameOf(state, userId);
  switch (event.type) {
    case "family_invite_created":
      return { title: "Invite code created", detail: `${you(event.actorId)} created ${event.code}` };
    case "family_invite_cancelled":
      return { title: "Invite cancelled", detail: `${you(event.actorId)} cancelled the invite` };
    case "family_invite_claimed":
      return { title: "Invite entered", detail: `${you(event.guardianId)} entered the invite code` };
    case "family_linked":
      return {
        title: "Family connected",
        detail: `${nameOf(state, event.guardianId)} connected as parent/guardian`,
      };
    case "family_unlinked":
      return { title: "Family disconnected", detail: `${you(event.actorId)} disconnected` };
    case "spending_limit_updated":
      return {
        title: "Spending rules updated",
        detail: summarizeSpendingRules(event.limits, event.approval),
      };
    case "guardian_notifications_updated":
      return {
        title: "Parent notifications updated",
        detail: `Notified about ${summarizeGuardianNotifications(event.notifications)}`,
      };
    case "allowance_schedule_updated":
      return {
        title: event.schedule ? "Pocket money scheduled" : "Schedule removed",
        detail: event.schedule
          ? `${formatINR(event.schedule.amount)} · ${legacyCadence(event.schedule)}`
          : "Recurring pocket money preview removed",
      };
    case "pocket_money_schedule_changed": {
      const titles = {
        created: "Pocket money scheduled",
        updated: "Pocket money updated",
        paused: "Pocket money paused",
        resumed: "Pocket money resumed",
        cancelled:
          event.endedReason === "family_disconnected"
            ? "Pocket money stopped"
            : "Pocket money cancelled",
        completed: "Schedule completed",
      } as const;
      return {
        title: titles[event.change],
        detail:
          event.change === "cancelled" && event.endedReason === "family_disconnected"
            ? `${planText(event)} · family disconnected`
            : planText(event),
      };
    }
    case "approval_requested":
      return {
        title: "Approval requested",
        detail: `${formatINR(event.approval.amount)} to ${event.approval.recipientName}`,
      };
    case "approval_approved":
      return {
        title: "Approval given",
        detail: `${formatINR(event.approval.amount)} to ${event.approval.recipientName}`,
      };
    case "approval_declined":
      return {
        title: "Approval declined",
        detail: `${formatINR(event.approval.amount)} to ${event.approval.recipientName}`,
      };
    case "approval_cancelled":
      return {
        title: "Approval cancelled",
        detail: `${formatINR(event.approval.amount)} to ${event.approval.recipientName}${
          event.approval.cancelReason ? ` · ${event.approval.cancelReason}` : ""
        }`,
      };
    case "wallet_frozen":
      return { title: "Wallet frozen", detail: `${you(event.actorId)} froze ${nameOf(state, event.teenId)}'s wallet` };
    case "wallet_unfrozen":
      return { title: "Wallet unfrozen", detail: `${you(event.actorId)} unfroze ${nameOf(state, event.teenId)}'s wallet` };
    default:
      return { title: "Update", detail: "" };
  }
}
