/**
 * Canonical navigation model. Bottom nav (mobile), sidebar (desktop) and
 * tests all derive from this single definition — add a tab here and it
 * appears everywhere with correct active state.
 */

import {
  ArrowLeftRight,
  House,
  ReceiptText,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  id: string;
  href: string;
  label: string;
  /** Short label for the compact bottom bar. */
  shortLabel: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { id: "home", href: "/", label: "Home", shortLabel: "Home", icon: House },
  { id: "pay", href: "/pay", label: "Pay", shortLabel: "Pay", icon: ArrowLeftRight },
  { id: "money", href: "/money", label: "Money", shortLabel: "Money", icon: Wallet },
  {
    id: "activity",
    href: "/activity",
    label: "Activity",
    shortLabel: "Activity",
    icon: ReceiptText,
  },
  {
    id: "profile",
    href: "/profile",
    label: "Profile",
    shortLabel: "You",
    icon: UserRound,
  },
] as const;

/** True when `pathname` belongs to `href` (exact for "/", prefix otherwise). */
export function isNavActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
