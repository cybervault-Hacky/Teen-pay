import {
  Bike,
  CalendarClock,
  CheckCircle2,
  Gift,
  GraduationCap,
  Headphones,
  Heart,
  Laptop,
  Music,
  PiggyBank,
  Plane,
  Shield,
  ShoppingBag,
  Target,
  type LucideIcon,
} from "lucide-react";
import { deadlineLabel, type SpaceIcon } from "@/domain";
import { cn } from "@/lib/cn";
import { formatINR } from "@/lib/currency";
import { formatLongDateKey } from "@/lib/format";
import type { SpaceView } from "@/sandbox/selectors";
import { Progress } from "@/components/ui/progress";

/**
 * Small presentational pieces shared by every Money Space surface
 * (Home summary, Money list, Space detail, forms). Figures come from
 * `SpaceView` — derived in selectors, never computed here.
 */

export const SPACE_ICON_COMPONENTS: Record<SpaceIcon, LucideIcon> = {
  "piggy-bank": PiggyBank,
  target: Target,
  shield: Shield,
  "shopping-bag": ShoppingBag,
  "graduation-cap": GraduationCap,
  plane: Plane,
  headphones: Headphones,
  bike: Bike,
  gift: Gift,
  laptop: Laptop,
  music: Music,
  heart: Heart,
};

export const SPACE_ICON_LABELS: Record<SpaceIcon, string> = {
  "piggy-bank": "Piggy bank",
  target: "Target",
  shield: "Safety net",
  "shopping-bag": "Shopping",
  "graduation-cap": "Education",
  plane: "Travel",
  headphones: "Headphones",
  bike: "Bike",
  gift: "Gift",
  laptop: "Laptop",
  music: "Music",
  heart: "Heart",
};

export function SpaceIconTile({
  icon,
  size = "md",
  muted = false,
  className,
}: {
  icon: SpaceIcon;
  size?: "sm" | "md" | "lg";
  muted?: boolean;
  className?: string;
}) {
  const Icon = SPACE_ICON_COMPONENTS[icon] ?? Target;
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border",
        muted
          ? "border-line bg-surface-2 text-ink-faint"
          : "border-accent/20 bg-accent/10 text-accent",
        size === "sm" && "h-9 w-9",
        size === "md" && "h-11 w-11",
        size === "lg" && "h-14 w-14 rounded-2xl",
      )}
    >
      <Icon
        className={cn(size === "lg" ? "h-6 w-6" : size === "sm" ? "h-4 w-4" : "h-5 w-5", className)}
      />
    </span>
  );
}

/** "37.5%" — one decimal at most, never rounded up to 100%. */
export function percentLabel(percent: number): string {
  return `${percent}%`;
}

/** Progress bar + words. Renders nothing for Spaces without a target. */
export function SpaceProgressBlock({
  space,
  compact = false,
}: {
  space: SpaceView;
  compact?: boolean;
}) {
  const { progress } = space;
  if (progress.target === undefined || progress.percent === undefined) return null;
  const valueText = `${formatINR(progress.balance)} of ${formatINR(progress.target)}, ${percentLabel(progress.percent)}`;
  return (
    <div className={compact ? "mt-2.5" : "mt-4"}>
      <Progress
        value={progress.percent}
        label={`${space.name} progress`}
        valueText={valueText}
        tone={progress.reached ? "success" : "accent"}
      />
      {!compact && (
        <div className="mt-2 flex items-center justify-between gap-3 text-xs">
          {progress.reached ? (
            <span className="inline-flex items-center gap-1.5 font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
              Target reached
            </span>
          ) : (
            <span className="text-ink-muted">
              {percentLabel(progress.percent)} · {formatINR(progress.remaining ?? 0)} to go
            </span>
          )}
          <span className="text-ink-faint">of {formatINR(progress.target)}</span>
        </div>
      )}
    </div>
  );
}

/** "Nov 30, 2026 · 65 days left" — neutral wording, never a promise. */
export function DeadlineLine({ space, className }: { space: SpaceView; className?: string }) {
  if (!space.deadlineInfo) return null;
  const info = space.deadlineInfo;
  return (
    <p className={cn("inline-flex items-center gap-1.5 text-xs text-ink-muted", className)}>
      <CalendarClock className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        <span className="sr-only">Target date: </span>
        {formatLongDateKey(info.date)} · {deadlineLabel(info)}
      </span>
    </p>
  );
}
