import { CircleAlert } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "./Button";

export interface ErrorStateProps {
  title?: string;
  body?: string;
  retryLabel?: string;
  onRetry?: () => void;
  className?: string;
}

/** Something failed — always paired with a recovery action. */
export function ErrorState({
  title = "Something went wrong",
  body = "Please try again. If it keeps happening, let us know.",
  retryLabel = "Try again",
  onRetry,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn("flex flex-col items-center gap-2.5 py-10 text-center", className)}
    >
      <span
        className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger"
        aria-hidden="true"
      >
        <CircleAlert className="size-6" />
      </span>
      <p className="mt-1 font-display text-[15px] font-semibold tracking-tight text-ink">
        {title}
      </p>
      <p className="max-w-[300px] text-sm text-muted">{body}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-2">
          {retryLabel}
        </Button>
      )}
    </div>
  );
}
