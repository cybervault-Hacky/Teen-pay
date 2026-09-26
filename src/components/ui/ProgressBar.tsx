"use client";

import { motion } from "framer-motion";
import { formatPercent } from "@/lib/format";
import { cn } from "@/lib/cn";

export type ProgressTone = "accent" | "success";

const toneStyles: Record<ProgressTone, string> = {
  accent: "bg-accent",
  success: "bg-success",
};

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  tone?: ProgressTone;
  label: string;
  className?: string;
}

/** Accessible linear progress (goals, limits). Animates on view. */
export function ProgressBar({ value, tone = "accent", label, className }: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(clamped * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={formatPercent(clamped, 1)}
      className={cn("h-2 w-full overflow-hidden rounded-full bg-surface-3", className)}
    >
      <motion.div
        className={cn("h-full rounded-full", toneStyles[tone])}
        initial={{ width: 0 }}
        whileInView={{ width: `${clamped * 100}%` }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
