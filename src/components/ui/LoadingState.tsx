import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

export interface LoadingStateProps {
  label?: string;
  className?: string;
}

/** Announced loading indicator for async regions. */
export function LoadingState({ label = "Loading…", className }: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn("flex flex-col items-center gap-3 py-10 text-center", className)}
    >
      <LoaderCircle className="size-7 animate-spin text-accent" aria-hidden="true" />
      <p className="text-sm text-muted">{label}</p>
    </div>
  );
}
