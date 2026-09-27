import { cn } from "@/lib/cn";

type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger";

interface BadgeProps extends React.ComponentPropsWithoutRef<"span"> {
  tone?: BadgeTone;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "border border-line bg-surface-2 text-ink-muted",
  accent: "border border-accent/25 bg-accent/10 text-accent",
  success: "border border-success/25 bg-success/10 text-success",
  warning: "border border-warning/25 bg-warning/10 text-warning",
  danger: "border border-danger/25 bg-danger/10 text-danger",
};

/** A small status pill. Keeps state consistent everywhere. */
export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium",
        toneClasses[tone],
        className,
      )}
      {...props}
    />
  );
}
