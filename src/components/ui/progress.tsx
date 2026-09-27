import { cn } from "@/lib/cn";

interface ProgressProps {
  /** 0–100. Values outside the range are clamped. */
  value: number;
  /** Accessible name, e.g. "New Bike progress". */
  label: string;
  /**
   * Spoken value, e.g. "₹1,500 of ₹2,500, 60%". Screen readers read
   * this instead of a bare number, so meaning never rests on the bar.
   */
  valueText?: string;
  /** "success" once a target is reached (always paired with text). */
  tone?: "accent" | "success";
  className?: string;
}

/** A thin determinate progress bar (savings goals, etc.). */
export function Progress({ value, label, valueText, tone = "accent", className }: ProgressProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(value * 10) / 10));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      aria-valuetext={valueText}
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-surface-2",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
          tone === "success" ? "bg-success" : "bg-accent",
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
