"use client";

import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  BadgeCheck,
  Bell,
  HandCoins,
  Info,
  ShieldCheck,
  Target,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Container } from "@/components/shell";
import {
  Button,
  Card,
  Divider,
  EmptyState,
  Reveal,
  SandboxBadge,
} from "@/components/ui";
import { useSandbox } from "@/sandbox";
import type { AppNotification, NotificationKind } from "@/domain";
import { formatDayLabel, formatTime } from "@/lib/format";
import { cn } from "@/lib/cn";

const KIND_ICONS: Record<NotificationKind, { icon: LucideIcon; tile: string }> = {
  money_in: { icon: ArrowDownLeft, tile: "bg-success-soft text-success" },
  money_out: { icon: ArrowUpRight, tile: "bg-surface-3 text-muted" },
  request_created: { icon: HandCoins, tile: "bg-info-soft text-info" },
  request_update: { icon: BadgeCheck, tile: "bg-accent-soft text-accent" },
  approval_request: { icon: ShieldCheck, tile: "bg-warning-soft text-warning" },
  approval_decision: { icon: ShieldCheck, tile: "bg-warning-soft text-warning" },
  goal_milestone: { icon: Target, tile: "bg-accent-soft text-accent" },
  limit_warning: { icon: TriangleAlert, tile: "bg-warning-soft text-warning" },
  system: { icon: Info, tile: "bg-surface-3 text-muted" },
};

/** Notification center — every sandbox event that mattered. */
export default function NotificationsPage() {
  const { notifications, unreadCount, markNotificationRead, markAllNotificationsRead } =
    useSandbox();

  return (
    <Container width="narrow">
      <div className="flex flex-col gap-6 pt-5 sm:pt-8">
        <Reveal>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
                Notifications
              </h1>
              <p className="mt-1 text-[15px] text-muted">
                {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
              </p>
            </div>
            <SandboxBadge />
          </div>
        </Reveal>

        {unreadCount > 0 && (
          <Reveal delay={0.05}>
            <div>
              <Button variant="secondary" size="sm" onClick={markAllNotificationsRead}>
                Mark all read
              </Button>
            </div>
          </Reveal>
        )}

        <Reveal>
          <Card className="px-3 py-1.5">
            {notifications.length === 0 ? (
              <EmptyState
                icon={Bell}
                title="No notifications"
                body="Payments, requests and pocket money will notify you here."
              />
            ) : (
              notifications.map((notification, index) => (
                <div key={notification.id}>
                  {index > 0 && <Divider className="mx-2" />}
                  <NotificationRow
                    notification={notification}
                    onRead={() => markNotificationRead(notification.id)}
                  />
                </div>
              ))
            )}
          </Card>
        </Reveal>
      </div>
    </Container>
  );
}

function NotificationRow({
  notification,
  onRead,
}: {
  notification: AppNotification;
  onRead: () => void;
}) {
  const { icon: Icon, tile } = KIND_ICONS[notification.kind];
  const content = (
    <>
      <span
        className={cn(
          "flex size-11 shrink-0 items-center justify-center rounded-xl",
          tile,
        )}
        aria-hidden="true"
      >
        <Icon className="size-5" />
      </span>
      <span className="min-w-0 flex-1 text-left">
        <span
          className={cn(
            "block truncate text-[15px] text-ink",
            notification.read ? "font-medium" : "font-semibold",
          )}
        >
          {notification.title}
        </span>
        <span className="mt-0.5 block truncate text-[13px] text-faint">
          {notification.body}
        </span>
        <span className="mt-0.5 block text-xs text-faint">
          {formatDayLabel(notification.createdAt)} · {formatTime(notification.createdAt)}
        </span>
      </span>
      {!notification.read && (
        <span className="size-2 shrink-0 rounded-full bg-accent" aria-label="Unread" role="img" />
      )}
    </>
  );

  const classes =
    "flex w-full items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3";

  if (notification.href) {
    return (
      <Link
        href={notification.href}
        onClick={onRead}
        className={cn(classes, "cursor-pointer")}
      >
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onRead} className={cn(classes, "cursor-pointer")}>
      {content}
    </button>
  );
}
