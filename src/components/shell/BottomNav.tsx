"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { NAV_ITEMS, isNavActive } from "@/design/navigation";
import { navIndicatorTransition } from "@/design/motion";
import { cn } from "@/lib/cn";

/** Mobile-first bottom tab bar. */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-canvas/90 backdrop-blur-md lg:hidden"
    >
      <ul className="mx-auto grid max-w-[560px] grid-cols-5 px-2 pt-1 pb-safe">
        {NAV_ITEMS.map((item) => {
          const active = isNavActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <li key={item.id}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-label={item.label}
                className={cn(
                  "relative flex flex-col items-center gap-1 rounded-xl py-2 text-[11px] font-medium transition-colors duration-150",
                  active ? "text-ink" : "text-faint hover:text-muted",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="bottom-nav-pill"
                    transition={navIndicatorTransition}
                    className="absolute -top-px h-[3px] w-8 rounded-full bg-accent"
                    aria-hidden="true"
                  />
                )}
                <Icon className="size-[22px]" aria-hidden="true" strokeWidth={active ? 2.2 : 1.8} />
                {item.shortLabel}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
