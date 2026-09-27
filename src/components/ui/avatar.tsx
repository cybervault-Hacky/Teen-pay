import { cn } from "@/lib/cn";

interface AvatarProps extends React.ComponentPropsWithoutRef<"span"> {
  /** Full name — used as the accessible label. */
  name: string;
  /** Up to two characters shown when no photo exists. */
  initials: string;
  size?: "sm" | "md" | "lg";
  /** Accent ring for the signed-in user. */
  ring?: boolean;
}

const sizeClasses = {
  sm: "h-8 w-8 text-xs",
  md: "h-10 w-10 text-sm",
  lg: "h-16 w-16 text-xl",
} as const;

/**
 * An initials-based avatar. Always exposes an accessible name,
 * even when it renders as plain text.
 */
export function Avatar({
  name,
  initials,
  size = "md",
  ring,
  className,
  ...props
}: AvatarProps) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center rounded-full",
        "bg-accent/15 font-semibold text-accent",
        ring && "ring-2 ring-accent/40 ring-offset-2 ring-offset-bg",
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {initials}
    </span>
  );
}
