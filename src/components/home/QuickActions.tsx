"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, UsersRound, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { staggerContainer, staggerItem } from "@/design/motion";
import { ComingSoonSheet } from "@/components/ui";
import { cn } from "@/lib/cn";

interface QuickAction {
  id: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  sheet?: { feature: string; body: string };
  primary?: boolean;
}

const ACTIONS: readonly QuickAction[] = [
  { id: "pay", label: "Pay", icon: ArrowUpRight, href: "/pay", primary: true },
  {
    id: "request",
    label: "Request",
    icon: ArrowDownLeft,
    sheet: {
      feature: "Request money",
      body: "Ask a parent or friend for money with a note.",
    },
  },
  { id: "move", label: "Move", icon: ArrowLeftRight, href: "/money" },
  {
    id: "split",
    label: "Split",
    icon: UsersRound,
    sheet: {
      feature: "Split bills",
      body: "Split movies, food and outings with friends.",
    },
  },
];

/** Four one-tap shortcuts under the balance. */
export function QuickActions() {
  const [sheet, setSheet] = useState<{ feature: string; body: string } | null>(null);

  return (
    <>
      <motion.ul
        variants={staggerContainer}
        initial="hidden"
        whileInView="show"
        viewport={{ once: true, margin: "-32px" }}
        className="grid grid-cols-4 gap-2.5"
        aria-label="Quick actions"
      >
        {ACTIONS.map((action) => {
          const Icon = action.icon;
          const tile = (
            <>
              <span
                className={cn(
                  "flex size-[52px] items-center justify-center rounded-2xl transition-all duration-150",
                  action.primary
                    ? "bg-accent text-accent-ink shadow-[0_8px_24px_-8px_var(--tp-accent)]"
                    : "border border-line bg-surface text-ink group-hover:border-line-strong group-hover:bg-surface-2",
                )}
                aria-hidden="true"
              >
                <Icon className="size-[22px]" />
              </span>
              <span className="text-[13px] font-medium text-muted group-hover:text-ink">
                {action.label}
              </span>
            </>
          );
          return (
            <motion.li key={action.id} variants={staggerItem}>
              {action.href ? (
                <Link
                  href={action.href}
                  className="group flex flex-col items-center gap-2 rounded-2xl py-1"
                >
                  {tile}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={() => action.sheet && setSheet(action.sheet)}
                  className="group flex w-full cursor-pointer flex-col items-center gap-2 rounded-2xl py-1"
                >
                  {tile}
                </button>
              )}
            </motion.li>
          );
        })}
      </motion.ul>
      <ComingSoonSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        feature={sheet?.feature ?? ""}
        body={sheet?.body}
      />
    </>
  );
}
