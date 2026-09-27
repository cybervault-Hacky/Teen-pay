/**
 * Domain: notifications.
 *
 * Lightweight, per-person display notifications generated from
 * domain events (payments, requests, allowance, family links,
 * approvals). Never a source of financial truth — that is the
 * ledger's job — and reading one never changes financial state.
 */
export type NotificationKind =
  | "money"
  | "goal"
  | "family"
  | "approval"
  | "safety"
  | "system";

/** The three groups shown in the notification center. */
export type NotificationCategory = "money" | "family" | "approvals";

export interface AppNotification {
  id: string;
  /** The user this notification is for. */
  recipientId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  read: boolean;
  /** ISO 8601 timestamp. */
  createdAt: string;
}

export function notificationCategory(
  kind: NotificationKind,
): NotificationCategory {
  switch (kind) {
    case "money":
    case "goal":
      return "money";
    case "approval":
      return "approvals";
    case "family":
    case "safety":
    case "system":
      return "family";
  }
}
