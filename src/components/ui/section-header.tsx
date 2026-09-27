import Link from "next/link";
import { cn } from "@/lib/cn";

interface SectionHeaderProps {
  title: string;
  /** Custom right-hand action. */
  action?: React.ReactNode;
  /** Or a quiet link: `href` + `linkLabel`. */
  href?: string;
  linkLabel?: string;
  className?: string;
}

/**
 * The label row above a content section — small caps on the left,
 * an optional quiet action on the right.
 */
export function SectionHeader({
  title,
  action,
  href,
  linkLabel,
  className,
}: SectionHeaderProps) {
  return (
    <div
      className={cn(
        "mb-3 flex items-center justify-between gap-4",
        className,
      )}
    >
      <h2 className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
        {title}
      </h2>
      {action ??
        (href && linkLabel ? (
          <Link
            href={href}
            className="text-xs font-medium text-ink-faint transition-colors duration-150 hover:text-ink"
          >
            {linkLabel}
          </Link>
        ) : null)}
    </div>
  );
}
