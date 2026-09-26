import { cn } from "@/lib/cn";

export interface SkeletonProps {
  className?: string;
}

/** Pulsing placeholder block. Compose with sizing utilities. */
export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn("animate-pulse-soft rounded-xl bg-surface-3", className)}
    />
  );
}
