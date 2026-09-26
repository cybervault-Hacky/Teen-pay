/**
 * Notifications domain — generated from sandbox ledger events in Phase 2.
 * Money events both teens and parents care about: money in, approvals,
 * goal milestones, and safety signals.
 */

export type NotificationId = string;

export type NotificationKind =
  | "money_in"
  | "money_out"
  | "request_created"
  | "request_update"
  | "approval_request"
  | "approval_decision"
  | "goal_milestone"
  | "limit_warning"
  | "system";

export interface AppNotification {
  id: NotificationId;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  createdAt: string;
  /** Deep link into the app for later phases. */
  href?: string;
}
