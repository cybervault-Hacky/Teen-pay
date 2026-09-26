import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SectionAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

export interface SectionHeaderProps {
  title: string;
  caption?: string;
  action?: SectionAction;
  className?: string;
}

/** Consistent section heading with an optional trailing action. */
export function SectionHeader({ title, caption, action, className }: SectionHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h2 className="font-display text-[17px] font-semibold tracking-tight text-ink">
          {title}
        </h2>
        {caption && <p className="mt-0.5 text-[13px] text-faint">{caption}</p>}
      </div>
      {action &&
        (action.href ? (
          <Link
            href={action.href}
            className="inline-flex shrink-0 items-center gap-0.5 rounded-lg pb-0.5 text-sm font-medium text-accent transition-opacity hover:opacity-80"
          >
            {action.label}
            <ChevronRight className="size-4" aria-hidden="true" />
          </Link>
        ) : (
          <button
            type="button"
            onClick={action.onClick}
            className="inline-flex shrink-0 cursor-pointer items-center gap-0.5 rounded-lg pb-0.5 text-sm font-medium text-accent transition-opacity hover:opacity-80"
          >
            {action.label}
            <ChevronRight className="size-4" aria-hidden="true" />
          </button>
        ))}
    </div>
  );
}
