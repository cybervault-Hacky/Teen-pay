import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  CalendarClock,
  ChevronRight,
  PiggyBank,
  Repeat,
  Target,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { COACH_CATEGORY_LABEL, type CoachCategory, type CoachInsight } from "@/domain";
import { cn } from "@/lib/cn";

export const CATEGORY_ICONS: Record<CoachCategory, LucideIcon> = {
  balance: Wallet,
  spending: ArrowUpRight,
  saving: PiggyBank,
  goals: Target,
  pocket_money: CalendarClock,
  habit: Repeat,
  education: BookOpen,
};

/**
 * One insight: its category in words, a factual title, the
 * explanation (what the number means, the period, where it came
 * from) and at most one navigation-only action.
 */
export function InsightCard({ insight, headingId }: { insight: CoachInsight; headingId: string }) {
  const Icon = CATEGORY_ICONS[insight.category];
  const action = insight.action;
  const actionClass =
    "mt-3 inline-flex items-center gap-1 text-sm font-medium text-accent transition-colors duration-150 hover:text-accent-strong motion-reduce:transition-none";
  return (
    <article aria-labelledby={headingId} className="flex gap-3.5 px-4 py-4 sm:px-5">
      <span
        className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
          insight.tone === "positive" ? "bg-success/10 text-success" : "bg-surface-2 text-ink-muted",
        )}
      >
        <Icon className="h-[18px] w-[18px]" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-ink-faint">
          {COACH_CATEGORY_LABEL[insight.category]}
          {insight.tone === "positive" && " · Milestone"}
        </p>
        <h3 id={headingId} className="mt-0.5 text-[15px] font-medium leading-snug text-ink">
          {insight.title}
        </h3>
        <p className="mt-1 text-sm leading-relaxed text-ink-muted">{insight.explanation}</p>
        {action &&
          (action.href.startsWith("#") ? (
            <a href={action.href} className={actionClass}>
              {action.label}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </a>
          ) : (
            <Link href={action.href} className={actionClass}>
              {action.label}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          ))}
      </div>
    </article>
  );
}
