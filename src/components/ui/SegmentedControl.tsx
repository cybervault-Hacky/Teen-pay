"use client";

import { motion } from "framer-motion";
import { useId } from "react";
import { transitionFast } from "@/design/motion";
import { cn } from "@/lib/cn";

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}

/** Single-select pill group (filters, density toggles). Keyboard-friendly. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: SegmentedControlProps<T>) {
  const groupId = useId();
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex items-center gap-1 rounded-xl border border-line bg-surface p-1",
        className,
      )}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative cursor-pointer rounded-lg px-3.5 py-1.5 text-[13px] font-medium transition-colors duration-150",
              selected ? "text-ink" : "text-faint hover:text-muted",
            )}
          >
            {selected && (
              <motion.span
                layoutId={`segment-${groupId}`}
                transition={transitionFast}
                className="absolute inset-0 rounded-lg bg-surface-3"
                aria-hidden="true"
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
