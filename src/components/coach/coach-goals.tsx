import Link from "next/link";
import { CheckCircle2, ChevronRight, Target } from "lucide-react";
import { formatCoachDate, type CoachGoal } from "@/domain";
import { formatINR } from "@/lib/currency";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";

function deadlineText(goal: CoachGoal): string | null {
  if (!goal.deadline) return null;
  const date = formatCoachDate(goal.deadline);
  if (goal.deadlineState === "passed") return `Target date ${date} · passed`;
  if (goal.deadlineState === "today") return `Target date ${date} · today`;
  return `Target date ${date} · ${goal.daysLeft} ${goal.daysLeft === 1 ? "day" : "days"} left`;
}

/**
 * Goal progress, straight from the existing Space progress (never a
 * second calculation). Each bar has a spoken value; the words next to
 * it say the same, so nothing rests on the bar or its colour.
 */
export function CoachGoals({ goals }: { goals: CoachGoal[] }) {
  if (goals.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={Target}
          title="No saving goals yet"
          description="Give a Space a target on the Money screen to follow its progress here."
          className="py-10"
        />
      </Card>
    );
  }
  return (
    <Card>
      <ul className="divide-y divide-line" aria-label="Saving goals">
        {goals.map((goal) => {
          const valueText = `${formatINR(goal.balance)} of ${formatINR(goal.target)}, ${goal.percent}%`;
          const deadline = deadlineText(goal);
          return (
            <li key={goal.href} className="px-4 py-4 sm:px-5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-sm font-medium text-ink">{goal.name}</span>
                <span className="text-sm tabular-nums text-ink-muted">{goal.percent}%</span>
              </div>
              <Progress
                value={goal.percent}
                label={`${goal.name}, progress toward target`}
                valueText={valueText}
                tone={goal.reached ? "success" : "accent"}
                className="mt-2.5"
              />
              <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
                {goal.reached ? (
                  <span className="inline-flex items-center gap-1.5 font-medium text-success">
                    <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                    Target reached · {formatINR(goal.target)}
                  </span>
                ) : (
                  <span className="text-ink-muted">
                    {formatINR(goal.balance)} of {formatINR(goal.target)} · {formatINR(goal.remaining)} to go
                  </span>
                )}
                {deadline && <span className="text-ink-faint">{deadline}</span>}
              </div>
              <Link
                href={goal.href}
                className="mt-2.5 inline-flex items-center gap-1 text-sm font-medium text-accent transition-colors duration-150 hover:text-accent-strong motion-reduce:transition-none"
              >
                View {goal.name}
                <ChevronRight className="h-4 w-4" aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
