import { useId, type InputHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** Helper text shown under the field. */
  hint?: string;
  /** Error message — also flips the field into the error state. */
  error?: string;
  startIcon?: LucideIcon;
}

/** Labelled text field with hint + error states baked in. */
export function Input({ label, hint, error, startIcon: StartIcon, id, className, ...rest }: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  return (
    <div className="w-full">
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-[13px] font-medium text-muted"
      >
        {label}
      </label>
      <div className="relative">
        {StartIcon && (
          <StartIcon
            className="pointer-events-none absolute top-1/2 left-4 size-[18px] -translate-y-1/2 text-faint"
            aria-hidden="true"
          />
        )}
        <input
          id={inputId}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-12 w-full rounded-xl border bg-surface-2 pr-4 text-[15px] text-ink transition-colors duration-150 outline-none placeholder:text-faint",
            StartIcon ? "pl-11" : "pl-4",
            error
              ? "border-danger/60 focus:border-danger"
              : "border-line-strong focus:border-accent",
            className,
          )}
          {...rest}
        />
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-[13px] text-danger-ink">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-[13px] text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
