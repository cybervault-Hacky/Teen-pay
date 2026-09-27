import {
  BookOpen,
  CheckCircle2,
  Circle,
  CircleDot,
  Compass,
  Lock,
  PiggyBank,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import type { MissionCategory, MissionStatus, MissionView } from "@/domain";
import { cn } from "@/lib/cn";

export const MISSION_CATEGORY_ICON: Record<MissionCategory, LucideIcon> = {
  basics: BookOpen,
  save: PiggyBank,
  explore: Compass,
  safety: ShieldCheck,
};

const STATUS_ICON: Record<MissionStatus, LucideIcon> = {
  available: Circle,
  in_progress: CircleDot,
  completed: CheckCircle2,
  locked: Lock,
};

const STATUS_TONE: Record<MissionStatus, string> = {
  available: "text-ink-muted",
  in_progress: "text-accent",
  completed: "text-success",
  locked: "text-ink-faint",
};

/**
 * A mission's status as an icon *and* words ("Completed", "In progress ·
 * Step 2 of 3", "Not started", "Locked") — never colour alone.
 */
export function MissionStatusLabel({ mission, className }: { mission: MissionView; className?: string }) {
  const Icon = STATUS_ICON[mission.status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs font-medium", STATUS_TONE[mission.status], className)}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
      {mission.statusLabel}
    </span>
  );
}

/** "About 3 min · 3 steps" */
export function missionMeta(mission: MissionView): string {
  const steps = mission.progress.totalSteps;
  return `About ${mission.estimatedMinutes} min · ${steps} ${steps === 1 ? "step" : "steps"}`;
}

/** The category icon on a quiet tile. */
export function MissionIcon({ mission, size = "md" }: { mission: MissionView; size?: "md" | "lg" }) {
  const Icon = MISSION_CATEGORY_ICON[mission.category];
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl border border-line bg-surface-2",
        mission.status === "completed" ? "text-success" : "text-ink-muted",
        size === "lg" ? "h-12 w-12" : "h-10 w-10",
      )}
    >
      <Icon className={size === "lg" ? "h-5 w-5" : "h-[18px] w-[18px]"} aria-hidden />
    </span>
  );
}
