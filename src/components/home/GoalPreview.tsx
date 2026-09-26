import Link from "next/link";
import { Target } from "lucide-react";
import { mockGoals } from "@/data/mock";
import { goalProgress } from "@/domain";
import { formatPercent } from "@/lib/format";
import { Amount, Card, ProgressBar, SectionHeader } from "@/components/ui";

/** First savings goal at a glance. */
export function GoalPreview() {
  const goal = mockGoals[0];
  if (!goal) return null;
  const progress = goalProgress(goal);

  return (
    <section aria-labelledby="goal-heading">
      <SectionHeader
        title="Saving for"
        action={{ label: "All goals", href: "/money" }}
      />
      <Link href="/money" className="mt-3 block" id="goal-heading" aria-label={`${goal.name}, ${formatPercent(progress, 1)} saved`}>
        <Card className="p-4 transition-colors duration-150 hover:border-line-strong sm:p-5">
          <span className="flex items-center gap-3.5">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent"
              aria-hidden="true"
            >
              <Target className="size-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[15px] font-semibold text-ink">
                {goal.name}
              </span>
              <span className="mt-0.5 block text-[13px] text-muted">
                <Amount value={goal.savedPaise} size="sm" tone="muted" />
                {" of "}
                <Amount value={goal.targetPaise} size="sm" tone="muted" />
              </span>
            </span>
            <span className="tnum shrink-0 text-sm font-semibold text-accent">
              {formatPercent(progress, 1)}
            </span>
          </span>
          <ProgressBar value={progress} label={`${goal.name} progress`} className="mt-3.5" />
        </Card>
      </Link>
    </section>
  );
}
