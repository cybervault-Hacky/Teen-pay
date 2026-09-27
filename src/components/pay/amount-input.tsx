"use client";

import { useId } from "react";
import { formatINRDigits } from "@/lib/currency";
import { cn } from "@/lib/cn";

interface AmountInputProps {
  label: string;
  /** Raw digit string (no separators). The component formats it. */
  value: string;
  onChange: (digits: string) => void;
  hint?: string;
  error?: string | null;
  /** Max digits, default 7 (up to 99,99,999 — the engine caps lower). */
  maxDigits?: number;
  className?: string;
}

/**
 * The financial number field. Big tabular digits, a calm ₹ glyph,
 * numeric keypad on touch, and strict digits-only handling.
 * Labels and errors are fully wired for assistive tech.
 */
export function AmountInput({
  label,
  value,
  onChange,
  hint,
  error,
  maxDigits = 7,
  className,
}: AmountInputProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const formatted = value ? formatINRDigits(Number(value)) : "";

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-ink">
        {label}
      </label>
      <div
        className={cn(
          "flex h-[76px] items-baseline gap-1.5 rounded-2xl border bg-surface-2 px-4",
          "transition-colors duration-150",
          error ? "border-danger/60" : "border-line",
        )}
      >
        <span aria-hidden className="text-2xl font-medium text-ink-muted">
          ₹
        </span>
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0"
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          value={formatted}
          onChange={(event) =>
            onChange(event.target.value.replace(/\D/g, "").slice(0, maxDigits))
          }
          className="w-full min-w-0 bg-transparent text-[38px] font-semibold leading-none tracking-tight text-ink outline-none tabular-nums placeholder:text-ink-faint"
        />
      </div>
      {error ? (
        <p
          id={`${id}-error`}
          role="alert"
          className="mt-2 text-sm text-danger"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-2 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
