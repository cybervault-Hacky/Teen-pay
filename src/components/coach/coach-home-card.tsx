"use client";

import Link from "next/link";
import { ChevronRight, Compass } from "lucide-react";
import { formatINR } from "@/lib/currency";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { SectionHeader } from "@/components/ui/section-header";
import { useCoachReport } from "./use-coach";

/**
 * The compact Coach card on Home: this month's one-line summary and
 * the closest open goal, one tap from the full Coach. Read-only;
 * renders nothing for accounts that don't have a Coach.
 */
export function CoachHomeCard() {
  const result = useCoachReport("month");
  if (!result.ok) return null;
  const report = result.value;
  const goal =
    [...report.goals].filter((g) => !g.reached).sort((a, b) => b.percent - a.percent)[0] ?? report.goals[0];

  return (
    <section aria-label="Money Coach">
      <SectionHeader title="Money Coach" />
      <Card className="p-4 sm:p-5">
        <div className="flex items-start gap-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-ink-muted">
            <Compass className="h-[18px] w-[18px]" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-ink">{report.headline}</p>
            {report.empty ? (
              <p className="mt-0.5 text-xs text-ink-muted">Make a few transactions to see insights here.</p>
            ) : (
              goal && (
                <div className="mt-3">
                  <p className="text-xs text-ink-muted">
                    {goal.reached
                      ? `${goal.name} reached its target`
                      : `${goal.name} is ${goal.percent}% complete`}
                  </p>
                  <Progress
                    value={goal.percent}
                    label={`${goal.name}, Money Coach progress`}
                    valueText={`${formatINR(goal.balance)} of ${formatINR(goal.target)}, ${goal.percent}%`}
                    tone={goal.reached ? "success" : "accent"}
                    className="mt-2"
                  />
                </div>
              )
            )}
          </div>
        </div>
        <Link
          href="/coach"
          className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent transition-colors duration-150 hover:text-accent-strong motion-reduce:transition-none"
        >
          View insights
          <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      </Card>
    </section>
  );
}
