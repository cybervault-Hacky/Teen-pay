"use client";

import { useId, useState } from "react";
import type { AllowanceFrequency } from "@/domain";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/currency";
import { formatDateKey } from "@/lib/format";
import {
  describeScheduleCadence,
  nextAllowanceDate,
  WEEKDAY_NAMES,
} from "@/sandbox/rules";
import { selectControls } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AllowanceScheduleFormProps {
  teenId: string;
  teenName: string;
  onSaved: (message: string) => void;
  onCancel: () => void;
}

const selectClass =
  "h-11 w-full rounded-xl border border-line bg-surface px-3.5 text-sm text-ink transition-colors duration-150 hover:border-line-strong";

/**
 * Sets a recurring pocket-money plan. Phase 3 stores and previews
 * the schedule only — nothing sends automatically.
 */
export function AllowanceScheduleForm({
  teenId,
  teenName,
  onSaved,
  onCancel,
}: AllowanceScheduleFormProps) {
  const { state, actions } = useSandbox();
  const current = selectControls(state, teenId)?.allowance ?? null;
  const ids = useId();

  const [digits, setDigits] = useState(String(current?.amount ?? 500));
  const [frequency, setFrequency] = useState<AllowanceFrequency>(
    current?.frequency ?? "weekly",
  );
  const [weekday, setWeekday] = useState(current?.weekday ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(current?.dayOfMonth ?? 1);
  const [error, setError] = useState<string | null>(null);

  const draft = {
    amount: digits === "" ? 0 : Number(digits),
    frequency,
    weekday,
    dayOfMonth,
  };
  const preview =
    draft.amount > 0
      ? `${formatINR(draft.amount)} · ${describeScheduleCadence(draft)} · next ${formatDateKey(
          nextAllowanceDate(draft, new Date().toISOString()),
        )}`
      : null;

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const result = actions.setAllowanceSchedule({ teenId, schedule: draft });
    if (result.ok) {
      onSaved(`Pocket money schedule saved: ${formatINR(draft.amount)} ${describeScheduleCadence(draft).toLowerCase()}.`);
    } else {
      setError(result.error.message);
    }
  };

  const turnOff = () => {
    const result = actions.setAllowanceSchedule({ teenId, schedule: null });
    if (result.ok) onSaved("Pocket money schedule turned off.");
    else setError(result.error.message);
  };

  return (
    <form onSubmit={save} className="space-y-4" noValidate>
      <p className="text-sm text-ink-muted">
        A plan {teenName} can see. In the sandbox nothing sends by itself —
        use Send pocket money when it&apos;s due.
      </p>

      <Input
        label="Amount"
        inputMode="numeric"
        autoComplete="off"
        value={digits}
        onChange={(event) => {
          setDigits(event.target.value.replace(/\D/g, "").slice(0, 5));
          setError(null);
        }}
        hint="Whole rupees"
      />

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">How often</legend>
        <div className="flex gap-1 rounded-full border border-line bg-surface p-1">
          {(["weekly", "monthly"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={frequency === option}
              onClick={() => setFrequency(option)}
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
          <label htmlFor={`${ids}-weekday`} className="mb-1.5 block text-sm font-medium text-ink">
            Day of the week
          </label>
          <select
            id={`${ids}-weekday`}
            className={selectClass}
            value={weekday}
            onChange={(event) => setWeekday(Number(event.target.value))}
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
            onChange={(event) => setDayOfMonth(Number(event.target.value))}
          >
            {Array.from({ length: 28 }, (_, i) => i + 1).map((day) => (
              <option key={day} value={day}>
                {day}
              </option>
            ))}
          </select>
        </div>
      )}

      {preview && (
        <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-muted">
          Preview: <span className="text-ink">{preview}</span>
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2.5 pt-1">
        {current && (
          <Button type="button" variant="ghost" onClick={turnOff}>
            Turn off
          </Button>
        )}
        <Button type="button" variant="secondary" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1">
          Save schedule
        </Button>
      </div>
    </form>
  );
}
