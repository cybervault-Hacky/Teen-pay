import { forwardRef, useId } from "react";
import { cn } from "@/lib/cn";

interface InputProps
  extends React.ComponentPropsWithoutRef<"input"> {
  label: string;
  hint?: string;
  error?: string;
}

/**
 * A text input with a real, always-associated label and optional
 * hint/error lines wired through aria-describedby.
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, className, ...props },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error
    ? `${inputId}-error`
    : hint
      ? `${inputId}-hint`
      : undefined;

  return (
    <div className={className}>
      <label
        htmlFor={inputId}
        className="mb-1.5 block text-sm font-medium text-ink"
      >
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "h-11 w-full rounded-xl border bg-surface-2 px-3.5 text-sm text-ink",
          "placeholder:text-ink-faint transition-colors duration-150",
          error ? "border-danger/60" : "border-line",
        )}
        {...props}
      />
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${inputId}-hint`} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
});
