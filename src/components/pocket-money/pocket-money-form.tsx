"use client";

import { useId, useRef, useState } from "react";
import {
  describePocketMoneyCadence,
  nextOccurrenceAfter,
  normalizeCadence,
  productDay,
  upcomingOccurrence,
  validatePocketMoneyInput,
  WEEKDAY_NAMES,
  type PocketMoneyField,
  type PocketMoneyFrequency,
  type PocketMoneySchedule,
  type PocketMoneyScheduleInput,
} from "@/domain";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/currency";
import { formatDateKey } from "@/lib/format";
import { makeId } from "@/lib/ids";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface PocketMoneyFormProps {
  teenId: string;
  teenName: string;
  parentName: string;
  /** Edit this schedule; omit to create one. */
  schedule?: PocketMoneySchedule;
  onDone: (message: string) => void;
  onCancel: () => void;
}

const selectClass =
  "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors duration-150 hover:border-line-strong aria-[invalid=true]:border-danger";

/**
 * Create or edit recurring pocket money. The form validates with the
 * same domain rules as the engine (which re-checks everything), and
 * its preview never claims money has moved — nothing does until a
 * transfer day is processed.
 */
export function PocketMoneyForm({
  teenId,
  teenName,
  parentName,
  schedule,
  onDone,
  onCancel,
}: PocketMoneyFormProps) {
  const { actions } = useSandbox();
  const ids = useId();
  // Captured once per open: the idempotency key (create) and the
  // version this edit is based on (a stale edit is refused).
  const [intentId] = useState(() => makeId("pms"));
  const [baseVersion] = useState(() => schedule?.version ?? 0);
  const [today] = useState(() => productDay(new Date().toISOString()));
  const submitting = useRef(false);

  const [digits, setDigits] = useState(schedule ? String(schedule.amount) : "500");
  const [frequency, setFrequency] = useState<PocketMoneyFrequency>(schedule?.frequency ?? "weekly");
  const [dayOfWeek, setDayOfWeek] = useState(schedule?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.dayOfMonth ?? 1);
  const [startDate, setStartDate] = useState(schedule?.startDate ?? today);
  const [endDate, setEndDate] = useState(schedule?.endDate ?? "");
  const [fieldError, setFieldError] = useState<{ field?: PocketMoneyField; message: string } | null>(null);

  const started = schedule !== undefined && (schedule.runs.length > 0 || schedule.startDate < today);
  const plan = normalizeCadence<PocketMoneyScheduleInput>({
    amount: digits === "" ? 0 : Number(digits),
    frequency,
    dayOfWeek,
    dayOfMonth,
    startDate,
    ...(endDate ? { endDate } : {}),
  });
  const livePlanError = validatePocketMoneyInput(plan, today, {
    allowPastStart: started && startDate === schedule?.startDate,
  });
  const first = livePlanError ? null : upcomingOccurrence({ ...plan, runs: schedule?.runs ?? [] }, today);
  const second = first ? nextOccurrenceAfter(plan, first) : null;
  const secondInRange = second && (!plan.endDate || second <= plan.endDate) ? second : null;

  const errorFor = (field: PocketMoneyField) =>
    fieldError?.field === field ? fieldError.message : undefined;
  const clear = () => setFieldError(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (submitting.current) return;
    if (livePlanError) {
      setFieldError(livePlanError);
      return;
    }
    submitting.current = true;
    const result = schedule
      ? actions.updatePocketMoneySchedule({
          scheduleId: schedule.id,
          expectedVersion: baseVersion,
          amount: plan.amount,
          frequency: plan.frequency,
          dayOfWeek: plan.dayOfWeek,
          dayOfMonth: plan.dayOfMonth,
          startDate: plan.startDate,
          endDate: plan.endDate ?? null,
        })
      : actions.createPocketMoneySchedule({
          idempotencyId: intentId,
          teenId,
          ...plan,
        });
    if (result.ok) {
      const next = result.value.nextOccurrence;
      const cadence = describePocketMoneyCadence(plan);
      onDone(
        `${schedule ? "Pocket money updated" : "Pocket money scheduled"}: ${formatINR(plan.amount)} ${cadence.charAt(0).toLowerCase()}${cadence.slice(1)}${
          next ? `. First transfer ${formatDateKey(next)}` : ""
        }. Nothing has been sent yet.`,
      );
    } else {
      submitting.current = false;
      setFieldError({
        ...(result.error.field && result.error.field !== "name" ? { field: result.error.field as PocketMoneyField } : {}),
        message: result.error.message,
      });
    }
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-describedby={`${ids}-intro`}>
      <p id={`${ids}-intro`} className="text-sm text-ink-muted">
        Recurring pocket money from your wallet to {teenName}&apos;s. It lands in
        their available balance — sandbox money only.
      </p>

      <Input
        label="Amount"
        inputMode="numeric"
        autoComplete="off"
        value={digits}
        onChange={(event) => {
          setDigits(event.target.value.replace(/\D/g, "").slice(0, 5));
          clear();
        }}
        hint="Whole rupees, up to ₹10,000"
        error={errorFor("amount")}
      />

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">How often</legend>
        <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
          {(["weekly", "monthly"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={frequency === option}
              onClick={() => {
                setFrequency(option);
                clear();
              }}
              className={cn(
                "flex-1 rounded-full px-3 py-1.5 text-sm font-medium capitalize transition-colors duration-150",
                frequency === option ? "bg-surface-2 text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>

      {frequency === "weekly" ? (
        <div>
          <label htmlFor={`${ids}-dow`} className="mb-1.5 block text-sm font-medium text-ink">
            Day of the week
          </label>
          <select
            id={`${ids}-dow`}
            className={selectClass}
            value={dayOfWeek}
            aria-invalid={errorFor("day") ? true : undefined}
            onChange={(event) => {
              setDayOfWeek(Number(event.target.value));
              clear();
            }}
          >
            {WEEKDAY_NAMES.map((name, index) => (
              <option key={name} value={index}>
                {name}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <div>
          <label htmlFor={`${ids}-dom`} className="mb-1.5 block text-sm font-medium text-ink">
            Day of the month
          </label>
          <select
            id={`${ids}-dom`}
            className={selectClass}
            value={dayOfMonth}
            aria-invalid={errorFor("day") ? true : undefined}
            aria-describedby={`${ids}-dom-hint`}
            onChange={(event) => {
              setDayOfMonth(Number(event.target.value));
              clear();
            }}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
          <p id={`${ids}-dom-hint`} className="mt-1.5 text-xs text-ink-faint">
            1–28, so every month has the day.
          </p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Start date"
          type="date"
          value={startDate}
          min={started ? undefined : today}
          disabled={schedule !== undefined && schedule.runs.length > 0}
          onChange={(event) => {
            setStartDate(event.target.value);
            clear();
          }}
          error={errorFor("startDate")}
        />
        <Input
          label="End date (optional)"
          type="date"
          value={endDate}
          min={startDate || today}
          onChange={(event) => {
            setEndDate(event.target.value);
            clear();
          }}
          hint="Leave empty to keep going"
          error={errorFor("endDate")}
        />
      </div>

      {!livePlanError && first && (
        <section aria-label="Preview" className="rounded-xl bg-surface-2 px-4 py-3.5 text-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Preview</p>
          <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1.5">
            <dt className="text-ink-faint">Amount</dt>
            <dd className="text-ink">{formatINR(plan.amount)}</dd>
            <dt className="text-ink-faint">Frequency</dt>
            <dd className="text-ink">{describePocketMoneyCadence(plan)}</dd>
            <dt className="text-ink-faint">From</dt>
            <dd className="text-ink">{parentName}&apos;s wallet</dd>
            <dt className="text-ink-faint">To</dt>
            <dd className="text-ink">{teenName}&apos;s wallet</dd>
            <dt className="text-ink-faint">First transfer</dt>
            <dd className="text-ink">{formatDateKey(first)}</dd>
            <dt className="text-ink-faint">Next transfer</dt>
            <dd className="text-ink">{secondInRange ? formatDateKey(secondInRange) : "None — ends after the first"}</dd>
          </dl>
          <p className="mt-2.5 text-xs text-ink-muted">
            Nothing moves now. Each transfer uses your available balance on its day; if
            it&apos;s too low, that transfer is skipped — never partly paid.
          </p>
        </section>
      )}

      {/* Field errors show under their field; this announces them too. */}
      {fieldError && (
        <p role="alert" className={fieldError.field ? "sr-only" : "text-sm text-danger"}>
          {fieldError.message}
        </p>
      )}

      <div className="flex flex-wrap gap-2.5 pt-1">
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1">
          {schedule ? "Save changes" : "Create pocket money"}
        </Button>
      </div>
    </form>
  );
}
