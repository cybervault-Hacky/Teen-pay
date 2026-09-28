"use client";

import { CalendarClock, Pause, Pencil, Play, Plus, X, Zap } from "lucide-react";
import { useId, useState } from "react";
import {
  describePocketMoneyCadence,
  isOpenSchedule,
  SCHEDULE_STATUS_LABEL,
  type PocketMoneyScheduleStatus,
} from "@/domain";
import { formatINR } from "@/lib/currency";
import { formatDateKey } from "@/lib/format";
import {
  getBalance,
  selectOpenSchedule,
  selectViewerWallet,
  selectPocketMoneyExecutions,
  selectScheduleSummary,
  selectSchedulesForParent,
  selectSession,
} from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { PocketMoneyForm } from "./pocket-money-form";

export const STATUS_TONE: Record<PocketMoneyScheduleStatus, "success" | "warning" | "neutral"> = {
  active: "success",
  paused: "warning",
  completed: "neutral",
  cancelled: "neutral",
};

type Notice = { tone: "info" | "danger"; text: string };

/**
 * Pocket Money Autopilot on the parent dashboard: the schedule for
 * this teen (with Edit / Pause / Resume / Cancel), a clearly labelled
 * sandbox control that processes the next transfer day, and the
 * history. Every action goes through the engine, which re-authorizes
 * it — nothing here decides who may do what.
 */
export function ParentPocketMoney({ teen }: { teen: { id: string; displayName: string } }) {
  const { state, actions } = useSandbox();
  const viewer = selectSession(state).user;
  const open = selectOpenSchedule(state, viewer.id, teen.id);
  const summary = open ? selectScheduleSummary(state, open.id) : null;
  const ended = selectSchedulesForParent(state, viewer.id).filter(
    (s) => s.teenAccountId === teen.id && !isOpenSchedule(s),
  );
  const runs = selectPocketMoneyExecutions(state, viewer.id)
    .filter((r) => r.schedule.teenAccountId === teen.id)
    .slice(0, 6);
  const [sheet, setSheet] = useState<"form" | "cancel" | null>(null);
  // Kept while the dialog animates out, so its title doesn't flip.
  const [formMode, setFormMode] = useState<"create" | "edit">("create");
  const openForm = (mode: "create" | "edit") => {
    setFormMode(mode);
    setSheet("form");
  };
  const [notice, setNotice] = useState<Notice | null>(null);
  const runHintId = useId();
  const ownWallet = selectViewerWallet(state);
  const ownBalance = ownWallet ? getBalance(state, ownWallet.id) : 0;

  const report = (result: { ok: true } | { ok: false; error: { message: string } }, text: string) =>
    setNotice(result.ok ? { tone: "info", text } : { tone: "danger", text: result.error.message });

  const pauseOrResume = () => {
    if (!open) return;
    if (open.status === "active") {
      report(actions.pausePocketMoneySchedule(open.id, open.version), "Pocket money paused. Nothing is sent until you resume.");
    } else {
      const result = actions.resumePocketMoneySchedule(open.id, open.version);
      report(
        result,
        result.ok && result.value.nextOccurrence
          ? `Pocket money resumed. Next transfer ${formatDateKey(result.value.nextOccurrence)}.`
          : "Pocket money resumed.",
      );
    }
  };

  const cancel = () => {
    if (!open) return;
    const result = actions.cancelPocketMoneySchedule(open.id, open.version);
    setSheet(null);
    report(result, "Pocket money cancelled. Its history stays below.");
  };

  // Each click carries the transfer day it was rendered with (asOf =
  // that day). A repeated or stale click therefore targets a day that
  // was already processed, and the engine sends nothing more.
  const processNext = () => {
    if (!open?.nextRunAt) return;
    const result = actions.executeDuePocketMoney({ scheduleId: open.id, asOf: open.nextRunAt });
    if (!result.ok) {
      setNotice({ tone: "danger", text: result.error.message });
      return;
    }
    const outcome = result.value.outcomes[0];
    if (!outcome) {
      setNotice({ tone: "info", text: "That transfer day was already processed. Nothing more was sent." });
    } else if (outcome.status === "completed") {
      setNotice({
        tone: "info",
        text: `Sent ${formatINR(open.amount)} to ${teen.displayName} for ${formatDateKey(outcome.occurrence)} · ${outcome.reference}.`,
      });
    } else if (outcome.status === "failed") {
      setNotice({ tone: "danger", text: outcome.message ?? "Pocket money wasn't sent." });
    } else {
      setNotice({ tone: "info", text: "That transfer day was already processed. Nothing more was sent." });
    }
  };

  return (
    <div className="space-y-3">
      <Card className="p-5">
        {summary && open ? (
          <div>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-ink-faint">Pocket money to {teen.displayName}</p>
                <p className="mt-1 flex flex-wrap items-baseline gap-x-2">
                  <AmountDisplay value={open.amount} size="lg" />
                  <span className="text-sm text-ink-muted">{summary.cadence}</span>
                </p>
              </div>
              <Badge tone={STATUS_TONE[open.status]}>{summary.statusLabel}</Badge>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-ink-faint">Next transfer</dt>
                <dd className="mt-0.5 text-ink">
                  {summary.nextOccurrence ? formatDateKey(summary.nextOccurrence) : "Paused — resume to continue"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Sent so far</dt>
                <dd className="mt-0.5 text-ink">
                  {formatINR(summary.totalPaid)}
                  {summary.failures > 0 ? ` · ${summary.failures} not sent` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">From</dt>
                <dd className="mt-0.5 text-ink">
                  Your wallet · {formatINR(ownBalance)} available
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Ends</dt>
                <dd className="mt-0.5 text-ink">{open.endDate ? formatDateKey(open.endDate) : "No end date"}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Manage pocket money">
              <Button size="sm" variant="secondary" onClick={() => openForm("edit")}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
              <Button size="sm" variant="secondary" onClick={pauseOrResume}>
                {open.status === "active" ? (
                  <Pause className="h-4 w-4" aria-hidden />
                ) : (
                  <Play className="h-4 w-4" aria-hidden />
                )}
                {open.status === "active" ? "Pause" : "Resume"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSheet("cancel")}>
                <X className="h-4 w-4" aria-hidden />
                Cancel schedule
              </Button>
            </div>
            {open.status === "active" && summary.nextOccurrence && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5">
                <p id={runHintId} className="min-w-0 flex-1 text-xs text-ink-muted">
                  Sandbox: transfers don&apos;t run on a timer. Process{" "}
                  {formatDateKey(summary.nextOccurrence)} now, as if the day had arrived.
                </p>
                <Button size="sm" variant="secondary" onClick={processNext} aria-describedby={runHintId}>
                  <Zap className="h-4 w-4" aria-hidden />
                  Process next transfer
                </Button>
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col items-center py-4 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-muted">
              <CalendarClock className="h-5 w-5" aria-hidden />
            </span>
            <p className="mt-3 text-sm font-semibold text-ink">No pocket money scheduled</p>
            <p className="mt-1 max-w-sm text-sm text-ink-muted">
              Choose an amount and a day. It moves from your wallet to {teen.displayName}&apos;s
              on each transfer day.
            </p>
            <Button size="sm" className="mt-4" onClick={() => openForm("create")}>
              <Plus className="h-4 w-4" aria-hidden />
              Create pocket money
            </Button>
          </div>
        )}
        <p
          role="status"
          aria-live="polite"
          className={
            notice
              ? `mt-4 rounded-xl px-3.5 py-2.5 text-sm ${notice.tone === "danger" ? "bg-danger/10 text-danger" : "bg-accent/10 text-ink"}`
              : "sr-only"
          }
        >
          {notice?.text ?? ""}
        </p>
      </Card>

      {(runs.length > 0 || ended.length > 0) && (
        <Card>
          <h3 className="px-5 pb-1 pt-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Pocket money history
          </h3>
          {runs.length > 0 && (
            <ul className="divide-y divide-line" aria-label="Scheduled transfers">
              {runs.map((run) => (
                <li key={run.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="text-sm text-ink">
                      {formatINR(run.amount)} to {teen.displayName}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      {formatDateKey(run.occurrence)}
                      {run.reference ? (
                        <>
                          {" · "}
                          <span className="font-mono">{run.reference}</span>
                        </>
                      ) : null}
                    </p>
                    {run.status === "failed" && run.message && (
                      <p className="mt-1 text-xs text-ink-muted">{run.message}</p>
                    )}
                    {run.missed ? (
                      <p className="mt-1 text-xs text-ink-muted">
                        {run.missed} earlier {run.missed === 1 ? "day was" : "days were"} missed and not paid.
                      </p>
                    ) : null}
                  </div>
                  <Badge tone={run.status === "completed" ? "success" : "danger"}>
                    {run.status === "completed" ? "Completed" : "Not sent"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
          {ended.length > 0 && (
            <ul className="border-t border-line px-5 py-3 text-xs text-ink-muted" aria-label="Past schedules">
              {ended.map((s) => (
                <li key={s.id}>
                  {formatINR(s.amount)} · {describePocketMoneyCadence(s)} — {SCHEDULE_STATUS_LABEL[s.status]}
                  {s.endedReason === "family_disconnected" ? " (family disconnected)" : ""}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Modal
        open={sheet === "form"}
        onClose={() => setSheet(null)}
        title={formMode === "edit" ? "Edit pocket money" : "Create pocket money"}
      >
        <PocketMoneyForm
          teenId={teen.id}
          teenName={teen.displayName}
          parentName={viewer.displayName}
          schedule={formMode === "edit" && open ? open : undefined}
          onDone={(message) => {
            setSheet(null);
            setNotice({ tone: "info", text: message });
          }}
          onCancel={() => setSheet(null)}
        />
      </Modal>

      <Modal open={sheet === "cancel"} onClose={() => setSheet(null)} title="Cancel pocket money?" variant="center">
        <p className="text-sm text-ink-muted">
          Future transfers to {teen.displayName} stop. Money already sent and the history
          stay. You can create a new schedule later.
        </p>
        <div className="mt-5 flex gap-2.5">
          <Button variant="secondary" className="flex-1" onClick={() => setSheet(null)}>
            Keep it
          </Button>
          <Button variant="danger" className="flex-1" onClick={cancel}>
            Cancel pocket money
          </Button>
        </div>
      </Modal>
    </div>
  );
}
