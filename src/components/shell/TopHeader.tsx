"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { NAV_ITEMS, isNavActive } from "@/design/navigation";
import { useSandbox } from "@/sandbox";
import { AppLogo, Avatar, iconButtonClassName, Notice } from "@/components/ui";

/** Slim sticky header — brand + alerts + identity. */
export function TopHeader() {
  const pathname = usePathname();
  const { teen, unreadCount, storageIssue } = useSandbox();
  const current = NAV_ITEMS.find((item) => isNavActive(pathname, item.href));

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-[1080px] items-center justify-between gap-3 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/" aria-label="TeenPay home" className="rounded-lg lg:hidden">
            <AppLogo />
          </Link>
          <p className="hidden truncate font-display text-[15px] font-semibold tracking-tight text-ink lg:block">
            {current?.label ?? "TeenPay"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="relative">
            <Link
              href="/notifications"
              aria-label={
                unreadCount > 0
                  ? `Notifications, ${unreadCount} unread`
                  : "Notifications"
              }
              className={iconButtonClassName({ variant: "ghost" })}
            >
              <Bell aria-hidden="true" />
            </Link>
            {unreadCount > 0 && (
              <span
                className="absolute top-2 right-2.5 size-2 rounded-full bg-accent ring-2 ring-canvas"
                aria-hidden="true"
              />
            )}
          </span>
          <Link
            href="/profile"
            aria-label={`${teen.displayName}, open profile`}
            className="rounded-full transition-opacity hover:opacity-85"
          >
            <Avatar name={teen.displayName} />
          </Link>
        </div>
      </div>
      {storageIssue && (
        <div className="border-t border-line px-4 py-2 sm:px-6">
          <div className="mx-auto w-full max-w-[1080px]">
            <Notice tone="warning">
              {storageIssue === "corrupted"
                ? "Saved sandbox data was unreadable, so we started fresh."
                : "This device isn't saving sandbox changes — they'll last for this visit only."}
            </Notice>
          </div>
        </div>
      )}
    </header>
  );
}
