"use client";

import { motion } from "framer-motion";
import { transitionFast } from "@/design/motion";
import { cn } from "@/lib/cn";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

/** Accessible toggle switch. */
export function Switch({ checked, onChange, label, disabled = false, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-7 w-12 shrink-0 cursor-pointer rounded-full transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-accent" : "bg-surface-3",
        className,
      )}
    >
      <motion.span
        aria-hidden="true"
        className={cn(
          "absolute top-1 left-1 size-5 rounded-full shadow",
          checked ? "bg-accent-ink" : "bg-muted",
        )}
        animate={{ x: checked ? 20 : 0 }}
        transition={transitionFast}
      />
    </button>
  );
}
