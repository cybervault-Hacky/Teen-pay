"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, isNavActive } from "@/design/navigation";
import { useSandbox } from "@/sandbox";
import { AppLogo, Avatar } from "@/components/ui";
import { cn } from "@/lib/cn";

/** Desktop sidebar — same model as the bottom bar, roomier treatment. */
export function SideNav() {
  const pathname = usePathname();
  const { teen, parent } = useSandbox();

  return (
    <nav
      aria-label="Primary"
      className="sticky top-0 z-40 hidden h-dvh w-[248px] shrink-0 flex-col border-r border-line bg-canvas px-4 py-6 lg:flex"
    >
      <Link href="/" aria-label="TeenPay home" className="rounded-lg px-2">
        <AppLogo />
      </Link>
      <ul className="mt-8 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-[15px] font-medium transition-colors duration-150",
                  active
                    ? "bg-surface-2 text-ink"
                    : "text-muted hover:bg-surface-2/60 hover:text-ink",
                )}
              >
                <span
                  className={cn(
                    "flex size-9 items-center justify-center rounded-lg transition-colors duration-150",
                    active ? "bg-accent-soft text-accent" : "text-faint",
                  )}
                  aria-hidden="true"
                >
                  <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-auto">
        <Link
          href="/profile"
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 transition-colors hover:bg-surface-2"
        >
          <Avatar name={teen.displayName} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-ink">
              {teen.displayName}
            </span>
            <span className="block truncate text-xs text-faint">
              {parent ? `Family · ${parent.displayName}` : "Teen account"}
            </span>
          </span>
        </Link>
      </div>
    </nav>
  );
}
