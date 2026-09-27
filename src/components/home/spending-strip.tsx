"use client";

import { ChevronRight, Gauge } from "lucide-react";
import Link from "next/link";
import { formatINR } from "@/lib/currency";
import { selectSpendingStatus } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Progress } from "@/components/ui/progress";

/**
 * A quiet line on Home when family rules are on: how much of
 * today's limit is left, one tap from the full rules.
 */
export function SpendingStrip({ teenId }: { teenId: string }) {
  const { state } = useSandbox();
  const status = selectSpendingStatus(state, teenId);
  if (!status.controlsActive) return null;
  const hasRules =
    status.dailyLimit !== null ||
    status.perTransactionLimit !== null ||
    status.approvalThreshold !== null;
  if (!hasRules) return null;

  return (
    <Link
      href="/family"
      className="flex items-center gap-3.5 rounded-2xl border border-line bg-surface px-4 py-3.5 transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
        <Gauge className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        {status.dailyLimit !== null ? (
          <>
            <span className="block text-sm font-medium text-ink">
              {formatINR(status.remainingToday ?? 0)} left today
            </span>
            <Progress
              value={(status.todaySpent / status.dailyLimit) * 100}
              label="Spent today against the daily limit"
              className="mt-2"
            />
          </>
        ) : (
          <span className="block text-sm font-medium text-ink">Family money rules are on</span>
        )}
        <span className="mt-1.5 block text-xs text-ink-muted">
          {status.dailyLimit !== null
            ? `${formatINR(status.todaySpent)} of ${formatINR(status.dailyLimit)} daily limit`
            : "See what applies"}
          {status.approvalThreshold !== null &&
            ` · approval above ${formatINR(status.approvalThreshold)}`}
        </span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
      <span className="sr-only">View your money rules</span>
    </Link>
  );
}
