"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavActive, type NavItem } from "@/lib/navigation";
import { cn } from "@/lib/cn";

interface NavItemProps {
  item: NavItem;
  /** "rail" is the desktop sidebar item, "tab" the mobile bottom tab. */
  variant?: "rail" | "tab";
}

/**
 * The shared navigation item. Both the desktop rail and the mobile
 * tab bar render from the same `navItems` source with the same
 * active-state logic, so they can never drift apart.
 */
export function NavItem({ item, variant = "rail" }: NavItemProps) {
  const pathname = usePathname();
  const active = isNavActive(item.href, pathname);
  const Icon = item.icon;

  if (variant === "tab") {
    return (
      <Link
        href={item.href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex flex-col items-center gap-1 rounded-xl py-1.5 text-[11px] font-medium",
          "transition-colors duration-150",
          active ? "text-ink" : "text-ink-faint hover:text-ink-muted",
        )}
      >
        <span
          className={cn(
            "flex h-7 w-12 items-center justify-center rounded-full",
            "transition-colors duration-150",
            active && "bg-accent/15",
          )}
        >
          <Icon
            className={cn("h-5 w-5 transition-colors duration-150", active && "text-accent")}
            aria-hidden
          />
        </span>
        {item.label}
      </Link>
    );
  }

  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium",
        "transition-colors duration-150",
        active
          ? "bg-surface-2 text-ink"
          : "text-ink-muted hover:bg-surface-2/60 hover:text-ink",
      )}
    >
      <Icon
        className={cn(
          "h-[18px] w-[18px] transition-colors duration-150",
          active
            ? "text-accent"
            : "text-ink-faint group-hover:text-ink-muted",
        )}
        aria-hidden
      />
      {item.label}
    </Link>
  );
}
