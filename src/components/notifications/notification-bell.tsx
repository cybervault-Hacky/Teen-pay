"use client";

import { Bell } from "lucide-react";
import { useState } from "react";
import { selectUnreadNotificationCount } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { IconButton } from "@/components/ui/icon-button";
import { NotificationCenter } from "./notification-center";

/**
 * Bell + notification center for the current sandbox identity.
 * The accessible name carries the unread count.
 */
export function NotificationBell() {
  const { state } = useSandbox();
  const [open, setOpen] = useState(false);
  const unreadCount = selectUnreadNotificationCount(state);

  return (
    <>
      <div className="relative">
        <IconButton
          label={
            unreadCount > 0
              ? `Notifications, ${unreadCount} unread`
              : "Notifications"
          }
          variant="ghost"
          onClick={() => setOpen(true)}
        >
          <Bell className="h-5 w-5" aria-hidden />
        </IconButton>
        {unreadCount > 0 && (
          <span
            aria-hidden
            className="absolute right-2 top-2 h-2 w-2 rounded-full bg-accent ring-2 ring-bg"
          />
        )}
      </div>
      <NotificationCenter open={open} onClose={() => setOpen(false)} />
    </>
  );
}
