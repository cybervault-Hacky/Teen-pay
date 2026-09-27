"use client";

import { navItemsFor } from "@/lib/navigation";
import { cn } from "@/lib/cn";
import { selectSession } from "@/sandbox/selectors";
import { useOptionalSandbox } from "@/sandbox/store";
import { NavItem } from "./nav-item";

/**
 * Mobile bottom tab bar. Fixed, floating on a translucent surface,
 * and padded for the device safe area. Hidden at `md` and up.
 * Destinations follow the current sandbox role.
 */
export function TabBar() {
  const sandbox = useOptionalSandbox();
  const items = navItemsFor(sandbox ? selectSession(sandbox.state).role : "teen");
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden"
    >
      <div
        className={cn(
          "mx-auto grid max-w-md px-2 pb-2 pt-1.5",
          items.length === 3 ? "grid-cols-3" : "grid-cols-5",
        )}
      >
        {items.map((item) => (
          <NavItem key={item.href} item={item} variant="tab" />
        ))}
      </div>
    </nav>
  );
}
