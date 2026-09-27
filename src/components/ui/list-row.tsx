import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/cn";

interface ListRowProps {
  icon?: LucideIcon;
  title: string;
  subtitle?: string;
  /** Right-aligned element (badge, value, chevron…). */
  right?: React.ReactNode;
  /** Makes the row a navigable link. */
  href?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * A single item in a settings/profile list. Renders a link when
 * `href` is set, a plain row otherwise.
 */
export function ListRow({
  icon: Icon,
  title,
  subtitle,
  right,
  href,
  disabled,
  className,
}: ListRowProps) {
  const content = (
    <>
      {Icon && (
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2 text-ink-muted">
          <Icon className="h-[18px] w-[18px]" aria-hidden />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {title}
        </span>
        {subtitle && (
          <span className="mt-0.5 block truncate text-xs text-ink-muted">
            {subtitle}
          </span>
        )}
      </span>
      {right}
    </>
  );

  const classes = cn(
    "flex items-center gap-3.5 rounded-xl px-4 py-3.5",
    !disabled && href && "transition-colors duration-150 hover:bg-surface-2",
    disabled && "opacity-50",
    className,
  );

  if (href && !disabled) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }

  return (
    <div className={classes} aria-disabled={disabled || undefined}>
      {content}
    </div>
  );
}
