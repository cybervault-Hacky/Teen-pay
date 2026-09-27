"use client";

import Link from "next/link";
import type { User } from "@/domain";
import { Avatar } from "@/components/ui/avatar";
import { NotificationBell } from "@/components/notifications/notification-bell";

interface HomeHeaderProps {
  user: User;
}

/** The Home greeting, notification bell, and a tap to Profile. */
export function HomeHeader({ user }: HomeHeaderProps) {
  return (
    <header className="mb-6 flex items-center justify-between gap-3">
      <h1 className="text-[22px] font-semibold tracking-tight text-ink">
        Hi, {user.displayName}.
      </h1>
      <div className="flex items-center gap-1.5">
        <NotificationBell />
        <Link
          href="/profile"
          aria-label="Open profile"
          className="rounded-full transition-transform duration-150 hover:scale-[1.03] active:scale-95"
        >
          <Avatar name={user.name} initials={user.avatarInitials} size="md" />
        </Link>
      </div>
    </header>
  );
}
