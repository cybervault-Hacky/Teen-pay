import { cn } from "@/lib/cn";

export interface DividerProps {
  label?: string;
  className?: string;
}

/** Hairline separator, optionally with a centered caption. */
export function Divider({ label, className }: DividerProps) {
  if (!label) {
    return <hr className={cn("border-line", className)} aria-hidden="true" />;
  }
  return (
    <div className={cn("flex items-center gap-3", className)} role="separator">
      <hr className="flex-1 border-line" aria-hidden="true" />
      <span className="text-xs font-medium tracking-wide text-faint uppercase">
        {label}
      </span>
      <hr className="flex-1 border-line" aria-hidden="true" />
    </div>
  );
}
