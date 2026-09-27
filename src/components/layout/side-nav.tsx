"use client";

import Link from "next/link";
import { roleLabel } from "@/domain";
import { navItemsFor } from "@/lib/navigation";
import { selectSession } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Avatar } from "@/components/ui/avatar";
import { AppLogo } from "./app-logo";
import { NavItem } from "./nav-item";

/**
 * Desktop navigation rail. Hidden below the `md` breakpoint,
 * where the mobile tab bar takes over. Destinations and the
 * identity chip follow the current sandbox role.
 */
export function SideNav() {
  const { state } = useSandbox();
  const { user, role } = selectSession(state);

  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-line px-4 py-6 md:flex">
      <AppLogo className="px-3" />
      <nav aria-label="Primary" className="mt-8 flex flex-col gap-1">
        {navItemsFor(role).map((item) => (
          <NavItem key={item.href} item={item} />
        ))}
      </nav>
      <div className="mt-auto border-t border-line pt-4">
        <Link
          href="/profile"
          className="flex items-center gap-3 rounded-xl px-3 py-2 transition-colors duration-150 hover:bg-surface-2"
        >
          <Avatar name={user.name} initials={user.avatarInitials} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-ink">
              {user.name}
            </span>
            <span className="block text-xs text-ink-faint">
              {roleLabel(role)} · Sandbox
            </span>
          </span>
        </Link>
      </div>
    </aside>
  );
}
