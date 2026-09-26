import { cn } from "@/lib/cn";

export interface AppLogoProps {
  /** Show the "TeenPay" wordmark next to the mark. */
  withWordmark?: boolean;
  className?: string;
}

/**
 * Original TeenPay mark — a rising path inside a rounded tile.
 * The wordmark uses the display face with tight tracking.
 */
export function AppLogo({ withWordmark = true, className }: AppLogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg
        width="30"
        height="30"
        viewBox="0 0 30 30"
        role="img"
        aria-label="TeenPay"
        className="shrink-0"
      >
        <rect width="30" height="30" rx="9" fill="var(--tp-accent)" />
        <path
          d="M7.5 19.5 13 14l3.4 3.4L22.5 11"
          fill="none"
          stroke="var(--tp-accent-ink)"
          strokeWidth="2.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="22.5" cy="11" r="1.9" fill="var(--tp-accent-ink)" />
      </svg>
      {withWordmark && (
        <span className="font-display text-[17px] font-bold tracking-tight text-ink">
          TeenPay
        </span>
      )}
    </span>
  );
}
