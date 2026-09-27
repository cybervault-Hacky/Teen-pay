"use client";

import { COACH_PERIODS, COACH_PERIOD_SHORT_LABEL, type CoachPeriod } from "@/domain";
import { cn } from "@/lib/cn";

/**
 * Week / Month / 30 days. Native radio buttons (arrow keys move the
 * choice, Tab leaves the group), styled as a segmented control. The
 * selected option is marked by its raised surface and weight, not by
 * colour alone. Changing it only changes what's shown; the status line
 * under it announces the full period and dates.
 */
export function PeriodSelector({
  value,
  onChange,
}: {
  value: CoachPeriod;
  onChange: (period: CoachPeriod) => void;
}) {
  return (
    <fieldset>
      <legend className="sr-only">Period</legend>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-line bg-surface p-1">
        {COACH_PERIODS.map((period) => {
          const checked = period === value;
          return (
            <label
              key={period}
              className={cn(
                "relative cursor-pointer select-none rounded-lg px-3 py-2 text-center text-sm transition-[background-color,color] duration-150 motion-reduce:transition-none",
                "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                checked
                  ? "bg-surface-3 font-semibold text-ink shadow-sm"
                  : "font-medium text-ink-muted hover:text-ink",
              )}
            >
              <input
                type="radio"
                name="coach-period"
                value={period}
                checked={checked}
                onChange={() => onChange(period)}
                className="sr-only"
              />
              {COACH_PERIOD_SHORT_LABEL[period]}
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
