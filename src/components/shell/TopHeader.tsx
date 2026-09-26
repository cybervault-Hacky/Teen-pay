"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell } from "lucide-react";
import { useState } from "react";
import { NAV_ITEMS, isNavActive } from "@/design/navigation";
import { mockTeen } from "@/data/mock";
import { AppLogo, Avatar, ComingSoonSheet, IconButton } from "@/components/ui";

/** Slim sticky header — brand + alerts + identity. */
export function TopHeader() {
  const pathname = usePathname();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const current = NAV_ITEMS.find((item) => isNavActive(pathname, item.href));

  return (
    <>
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
              <IconButton
                label="Notifications"
                variant="ghost"
                onClick={() => setAlertsOpen(true)}
              >
                <Bell aria-hidden="true" />
              </IconButton>
              <span
                className="absolute top-2 right-2.5 size-2 rounded-full bg-accent ring-2 ring-canvas"
                aria-hidden="true"
              />
            </span>
            <Link
              href="/profile"
              aria-label={`${mockTeen.displayName}, open profile`}
              className="rounded-full transition-opacity hover:opacity-85"
            >
              <Avatar name={mockTeen.displayName} />
            </Link>
          </div>
        </div>
      </header>
      <ComingSoonSheet
        open={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        feature="Notifications"
        body="Money-in alerts, approvals and goal milestones will live here."
      />
    </>
  );
}
