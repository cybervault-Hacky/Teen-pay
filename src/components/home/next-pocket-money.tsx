"use client";

import { CalendarClock, ChevronRight } from "lucide-react";
import Link from "next/link";
import { describePocketMoneyCadence } from "@/domain";
import { formatINR } from "@/lib/currency";
import { formatDateKey } from "@/lib/format";
import { selectNextPocketMoney } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";

/**
 * A quiet line on Home when pocket money is scheduled: how much and
 * when, one tap from the details in Family. Read-only.
 */
export function NextPocketMoney({ teenId }: { teenId: string }) {
  const { state } = useSandbox();
  const next = selectNextPocketMoney(state, teenId);
  if (!next) return null;

  return (
    <Link
      href="/family"
      className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
        <CalendarClock className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-ink-faint">Next pocket money</span>
        <span className="block text-sm font-medium text-ink">
          {formatINR(next.schedule.amount)} on {formatDateKey(next.occurrence)}
        </span>
        <span className="mt-0.5 block text-xs text-ink-muted">
          {describePocketMoneyCadence(next.schedule)}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
    </Link>
  );
}
