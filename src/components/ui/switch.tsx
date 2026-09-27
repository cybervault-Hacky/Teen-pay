"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

interface SwitchProps {
  label: string;
  description?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}

/**
 * An accessible on/off switch (role="switch") with a visible label
 * and optional description, both wired for assistive tech.
 */
export function Switch({
  label,
  description,
  checked,
  onChange,
  disabled,
  className,
}: SwitchProps) {
  const id = useId();
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="min-w-0">
        <label htmlFor={id} className="block text-sm font-medium text-ink">
          {label}
        </label>
        {description && (
          <p id={`${id}-desc`} className="mt-0.5 text-xs text-ink-muted">
            {description}
          </p>
        )}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border",
          "transition-colors duration-150 disabled:opacity-50",
          checked ? "border-accent/40 bg-accent" : "border-line bg-surface-3",
        )}
      >
        <span
          aria-hidden
          className={cn(
            "inline-block h-4.5 w-4.5 rounded-full shadow-soft transition-transform duration-150",
            checked ? "translate-x-[22px] bg-on-accent" : "translate-x-[3px] bg-ink-muted",
          )}
        />
      </button>
    </div>
  );
}
