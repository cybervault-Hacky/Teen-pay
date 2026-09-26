"use client";

import { useId } from "react";
import { formatINR } from "@/lib/format";
import { cn } from "@/lib/cn";

export interface AmountSuggestion {
  label: string;
  paise: number;
}

export interface AmountInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  /** Context line under the field, e.g. available balance. */
  hint?: string;
  suggestions?: readonly AmountSuggestion[];
  onSuggestion?: (paise: number) => void;
  autoFocus?: boolean;
  id?: string;
}

/**
 * Premium amount entry — large centered numerals with a ₹ prefix,
 * labelled + described for assistive tech, keyboard-friendly.
 */
export function AmountInput({
  label,
  value,
  onChange,
  error,
  hint,
  suggestions,
  onSuggestion,
  autoFocus = false,
  id,
}: AmountInputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className="mb-1 block text-center text-[13px] font-medium text-muted"
      >
        {label}
      </label>
      <div className="flex items-baseline justify-center gap-1">
        <span aria-hidden="true" className="text-2xl font-bold text-faint">
          ₹
        </span>
        <input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder="0"
          maxLength={10}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          className={cn(
            "tnum w-44 bg-transparent text-center text-5xl font-bold tracking-tight text-ink outline-none placeholder:text-faint/60",
          )}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-2 text-center text-[13px] text-danger-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-2 text-center text-[13px] text-faint">
          {hint}
        </p>
      ) : null}
      {suggestions && suggestions.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2" role="group" aria-label="Quick amounts">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.paise}
              type="button"
              onClick={() => onSuggestion?.(suggestion.paise)}
              className="tnum cursor-pointer rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-[13px] font-medium text-muted transition-colors hover:border-line-strong hover:text-ink"
            >
              {suggestion.label || formatINR(suggestion.paise)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
