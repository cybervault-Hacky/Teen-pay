import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  body?: string;
  children?: ReactNode;
  compact?: boolean;
  className?: string;
}

/** Friendly dead-end — the app never looks unfinished when data is missing. */
export function EmptyState({ icon: Icon, title, body, children, compact = false, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center text-center",
        compact ? "gap-2 py-6" : "gap-2.5 py-10",
        className,
      )}
    >
      <span
        className="flex size-12 items-center justify-center rounded-2xl bg-surface-3 text-muted"
        aria-hidden="true"
      >
        <Icon className="size-6" />
      </span>
      <p className="mt-1 font-display text-[15px] font-semibold tracking-tight text-ink">
        {title}
      </p>
      {body && <p className="max-w-[280px] text-sm text-muted">{body}</p>}
      {children && <div className="mt-3 flex flex-col items-center gap-2">{children}</div>}
    </div>
  );
}
