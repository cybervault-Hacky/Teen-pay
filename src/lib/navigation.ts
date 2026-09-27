import {
  Activity,
  Home,
  Send,
  User,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "@/domain";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * The single source of truth for primary navigation.
 * The desktop rail, the mobile tab bar, and any future tab systems
 * all render from these lists. The list follows the sandbox role:
 * same product, a different perspective.
 */
export const teenNavItems: NavItem[] = [
  { href: "/", label: "Home", icon: Home },
  { href: "/pay", label: "Pay", icon: Send },
  { href: "/money", label: "Money", icon: Wallet },
  { href: "/activity", label: "Activity", icon: Activity },
  { href: "/profile", label: "Profile", icon: User },
];

export const parentNavItems: NavItem[] = [
  { href: "/parent", label: "Overview", icon: Home },
  { href: "/family", label: "Family", icon: Users },
  { href: "/profile", label: "Profile", icon: User },
];

/** Back-compat alias: the teen navigation. */
export const navItems = teenNavItems;

export function navItemsFor(role: UserRole): NavItem[] {
  return role === "parent" ? parentNavItems : teenNavItems;
}

/** Where each role "starts". */
export function homeHrefFor(role: UserRole): string {
  return role === "parent" ? "/parent" : "/";
}

/** True when a nav destination matches the current route. */
export function isNavActive(href: string, pathname: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Screens reachable without a session. */
export const AUTH_ROUTES = ["/sign-in", "/create-account"] as const;

/** Screens that need a signed-in account. */
export const PROTECTED_ROUTES = [
  "/",
  "/pay",
  "/money",
  "/activity",
  "/family",
  "/parent",
  "/profile",
  // Phase 8: TeenPay-to-TeenPay money.
  "/send",
  "/request",
  "/requests",
  // Phase 9: QR & favourites ("/qr" covers "/qr/scan").
  "/qr",
  "/contacts",
  // Phase 11: Money Missions (teen-only; covers "/missions/[id]").
  "/missions",
  // Phase 10: Money Coach (read-only, teen-only).
  "/coach",
] as const;

export function isAuthRoute(pathname: string): boolean {
  return AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

export function isProtectedRoute(pathname: string): boolean {
  return PROTECTED_ROUTES.some((route) =>
    route === "/" ? pathname === "/" : pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * Where to go after signing in. Only same-app protected paths are
 * accepted (no open redirects); anything else goes to the role's home.
 */
export function safeNextPath(next: string | null | undefined, role: UserRole): string {
  if (next && next.startsWith("/") && !next.startsWith("//") && isProtectedRoute(next.split(/[?#]/)[0] ?? "")) {
    return next;
  }
  return homeHrefFor(role);
}
