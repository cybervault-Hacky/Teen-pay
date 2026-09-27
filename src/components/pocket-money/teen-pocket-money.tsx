"use client";

import { CalendarClock } from "lucide-react";
import { isOpenSchedule } from "@/domain";
import { formatINR } from "@/lib/currency";
import { formatDateKey } from "@/lib/format";
import {
  selectPocketMoneyExecutions,
  selectPocketMoneyTotals,
  selectScheduleSummary,
  selectSchedulesForTeen,
} from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { STATUS_TONE } from "./parent-pocket-money";

/**
 * The teen's read-only view of their pocket money: amount, how often,
 * the next date, whether it's active, and recent receipts. There are
 * no controls — only the paying parent can change a schedule — and a
 * failed transfer shows as "Not sent", never as money received.
 */
export function TeenPocketMoney({ teenId }: { teenId: string }) {
  const { state } = useSandbox();
  const schedules = selectSchedulesForTeen(state, teenId);
  const open = schedules.find(isOpenSchedule) ?? null;
  const summary = open ? selectScheduleSummary(state, open.id) : null;
  const recent = selectPocketMoneyExecutions(state, teenId).slice(0, 3);
  const { received } = selectPocketMoneyTotals(state, teenId);

  return (
    <Card>
      <div className="flex items-start gap-3.5 px-4 py-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-muted">
          <CalendarClock className="h-[18px] w-[18px]" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs text-ink-faint">Pocket money</p>
          {summary && open ? (
            <>
              <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-medium text-ink">
                {formatINR(open.amount)} · {summary.cadence}
                <Badge tone={STATUS_TONE[open.status]}>{summary.statusLabel}</Badge>
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {summary.nextOccurrence
                  ? `Next: ${formatDateKey(summary.nextOccurrence)} · from ${summary.parentName}`
                  : `Paused by ${summary.parentName} — nothing arrives until it resumes`}
              </p>
            </>
          ) : (
            <>
              <p className="mt-0.5 text-sm font-medium text-ink">No schedule set</p>
              <p className="mt-1 text-xs text-ink-muted">
                When your parent sets up pocket money, it shows here.
              </p>
            </>
          )}
        </div>
      </div>
      {recent.length > 0 && (
        <ul className="divide-y divide-line border-t border-line" aria-label="Recent pocket money">
          {recent.map((run) => (
            <li key={run.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="text-sm text-ink">
                  {run.status === "completed" ? `+${formatINR(run.amount)}` : formatINR(run.amount)}
                </p>
                <p className="text-xs text-ink-faint">
                  {formatDateKey(run.occurrence)}
                  {run.reference ? (
                    <>
                      {" · "}
                      <span className="font-mono">{run.reference}</span>
                    </>
                  ) : null}
                </p>
              </div>
              <Badge tone={run.status === "completed" ? "success" : "neutral"}>
                {run.status === "completed" ? "Received" : "Not sent"}
              </Badge>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-line px-4 py-3 text-xs text-ink-muted">
        {received > 0 ? `${formatINR(received)} received on schedule so far. ` : ""}
        Pocket money lands in your available balance — move it to a Space whenever you like.
      </p>
    </Card>
  );
}
