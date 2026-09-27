import { formatDayRange, type CoachSummary } from "@/domain";
import { formatINR } from "@/lib/currency";

/**
 * Two bars: spending in this window and in the comparison window.
 * Zero-based and scaled to the larger of the two, with the amounts in
 * words beside each bar — the bars are decoration for the text (they
 * are hidden from screen readers), so nothing depends on them.
 */
export function SpendingCompare({ summary }: { summary: CoachSummary }) {
  const comparison = summary.spendingComparison;
  if (comparison.kind !== "compared") return null;
  const current = summary.totalSpent;
  const previous = comparison.previous;
  const max = Math.max(current, previous);
  if (max <= 0) return null;
  const rows = [
    { label: `This period (${formatDayRange(summary.range)})`, amount: current, tone: "bg-accent" },
    { label: `Before (${formatDayRange(summary.previousRange)})`, amount: previous, tone: "bg-ink-faint" },
  ];
  return (
    <figure className="mt-4 border-t border-line pt-4" aria-labelledby="coach-spending-compared">
      <figcaption id="coach-spending-compared" className="text-xs font-medium text-ink-faint">
        Spending compared
      </figcaption>
      <ul className="mt-2.5 space-y-2.5">
        {rows.map((row) => (
          <li key={row.label}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="text-ink-muted">{row.label}</span>
              <span className="tabular-nums text-ink">{formatINR(row.amount)}</span>
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className={`h-full rounded-full ${row.tone}`} style={{ width: `${(row.amount / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ul>
    </figure>
  );
}
