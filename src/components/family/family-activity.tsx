"use client";

import { History } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { describeFamilyEvent } from "@/sandbox/events";
import { selectFamilyEvents } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * Family & approval updates (non-financial). Money movements live
 * in Activity, derived from the ledger — this log never shows a
 * payment that didn't happen.
 */
export function FamilyActivity({ limit = 6 }: { limit?: number }) {
  const { state } = useSandbox();
  const events = selectFamilyEvents(state, limit);
  const viewer = state.session.currentUserId;

  if (events.length === 0) {
    return (
      <Card>
        <EmptyState
          icon={History}
          className="py-10"
          title="No family updates yet"
          description="Connections, rule changes and approvals will show up here."
        />
      </Card>
    );
  }

  return (
    <Card>
      <ul className="divide-y divide-line">
        {events.map((event) => {
          const { title, detail } = describeFamilyEvent(state, event, viewer);
          return (
            <li key={event.id} className="flex items-start justify-between gap-4 px-4 py-3.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{title}</p>
                {detail && <p className="mt-0.5 text-xs text-ink-muted">{detail}</p>}
              </div>
              <span className="shrink-0 text-xs text-ink-faint">
                {formatDateTime(event.at)}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
