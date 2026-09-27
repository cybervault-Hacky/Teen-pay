import { cn } from "@/lib/cn";

/**
 * A placeholder block for content that hasn't arrived yet.
 * Pulses only for users who don't prefer reduced motion.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("motion-safe:animate-pulse rounded-lg bg-surface-2", className)}
    />
  );
}

/**
 * A small determinate-agnostic spinner for inline actions.
 */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-4 w-4 rounded-full border-2 border-line border-t-accent",
        "motion-safe:animate-spin",
        className,
      )}
    />
  );
}

/**
 * A full-region loading state. Exposed to screen readers as a
 * live status so waiting never feels silent or broken.
 */
export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex flex-col items-center justify-center gap-3 py-16"
    >
      <Spinner className="h-5 w-5" />
      <span className="text-sm text-ink-muted">{label}</span>
    </div>
  );
}
