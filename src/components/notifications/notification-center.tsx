"use client";

import {
  BellOff,
  Info,
  Shield,
  ShieldCheck,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useState } from "react";
import {
  notificationCategory,
  type NotificationCategory,
  type NotificationKind,
} from "@/domain";
import { cn } from "@/lib/cn";
import { formatDateTime } from "@/lib/format";
import { selectMyNotifications } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
}

const kindIcon: Record<NotificationKind, LucideIcon> = {
  money: Wallet,
  goal: Target,
  family: Users,
  approval: ShieldCheck,
  safety: Shield,
  system: Info,
};

type Filter = "all" | NotificationCategory;

const filters: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "money", label: "Money" },
  { id: "family", label: "Family" },
  { id: "approvals", label: "Approvals" },
];

/**
 * The local notification center for the current sandbox identity.
 * Notifications come from domain events (payments, requests,
 * allowance, family links, approvals). Reading them never changes
 * financial state.
 */
export function NotificationCenter({ open, onClose }: NotificationCenterProps) {
  const { state, actions } = useSandbox();
  const [filter, setFilter] = useState<Filter>("all");

  const mine = selectMyNotifications(state);
  const unread = mine.filter((n) => !n.read).length;
  const unreadIn = (id: Filter) =>
    mine.filter(
      (n) => !n.read && (id === "all" || notificationCategory(n.kind) === id),
    ).length;
  const visible = mine.filter(
    (n) => filter === "all" || notificationCategory(n.kind) === filter,
  );

  return (
    <Modal open={open} onClose={onClose} title="Notifications">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div
          role="group"
          aria-label="Notification type"
          className="flex flex-wrap gap-1.5"
        >
          {filters.map((option) => {
            const count = unreadIn(option.id);
            return (
              <button
                key={option.id}
                type="button"
                aria-pressed={filter === option.id}
                aria-label={
                  count > 0 ? `${option.label}, ${count} unread` : option.label
                }
                onClick={() => setFilter(option.id)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                  "transition-colors duration-150",
                  filter === option.id
                    ? "border-accent/30 bg-accent/10 text-accent"
                    : "border-line bg-surface text-ink-muted hover:text-ink",
                )}
              >
                {option.label}
                {count > 0 && (
                  <span aria-hidden className="tabular-nums text-[11px] opacity-80">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {unread > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={actions.markAllNotificationsRead}
          >
            Mark all read
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center px-4 py-10 text-center">
          <BellOff className="h-5 w-5 text-ink-faint" aria-hidden />
          <p className="mt-3 text-sm text-ink-muted">Nothing here yet.</p>
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-line">
          {visible.map((notification) => {
            const Icon = kindIcon[notification.kind];
            return (
              <li key={notification.id}>
                <button
                  type="button"
                  onClick={() => actions.markNotificationRead(notification.id)}
                  className={cn(
                    "flex w-full items-start gap-3.5 px-1 py-3.5 text-left",
                    "rounded-xl transition-colors duration-150 hover:bg-surface-2",
                  )}
                  aria-label={`${notification.title}. ${
                    notification.read ? "Read" : "Unread"
                  }. Mark as read.`}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
                      notification.read
                        ? "bg-surface-2 text-ink-muted"
                        : "bg-accent/10 text-accent",
                    )}
                  >
                    <Icon className="h-[18px] w-[18px]" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span
                        className={cn(
                          "truncate text-sm",
                          notification.read
                            ? "font-medium text-ink-muted"
                            : "font-semibold text-ink",
                        )}
                      >
                        {notification.title}
                      </span>
                      {!notification.read && (
                        <span
                          aria-hidden
                          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
                        />
                      )}
                    </span>
                    <span className="mt-0.5 block text-xs leading-relaxed text-ink-muted">
                      {notification.body}
                    </span>
                    <span className="mt-1 block text-xs text-ink-faint">
                      {formatDateTime(notification.createdAt)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-faint">
        Notifications are generated by sandbox events on this device.
      </p>
    </Modal>
  );
}
