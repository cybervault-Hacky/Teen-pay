import Link from "next/link";
import { formatINR } from "@/lib/currency";
import { Card } from "@/components/ui/card";

interface PendingRequestsProps {
  /** One line per pending request: { name, amount, note }. */
  items: { name: string; amount: number; note?: string }[];
}

/**
 * A quiet teaser for expected money. Home stays calm: only the
 * first request is shown, the rest live in Activity.
 */
export function PendingRequests({ items }: PendingRequestsProps) {
  const first = items[0];
  if (!first) return null;
  return (
    <Card className="p-4">
      <Link
        href="/activity"
        className="flex items-center justify-between gap-3 transition-opacity duration-150 hover:opacity-80"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">
            {formatINR(first.amount)} expected
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-muted">
            from {first.name}
            {first.note ? ` · ${first.note}` : ""}
            {items.length > 1 ? ` · +${items.length - 1} more` : ""}
          </span>
        </span>
        <span className="shrink-0 text-xs font-medium text-ink-muted">
          View
        </span>
      </Link>
    </Card>
  );
}
