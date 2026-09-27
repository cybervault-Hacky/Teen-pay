import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { MissionView } from "@/domain";
import { MissionIcon, MissionStatusLabel, missionMeta } from "./mission-parts";

/** One mission in the list: what it is, how long, and where you are. */
export function MissionCard({ mission }: { mission: MissionView }) {
  return (
    <Link
      href={mission.href}
      className="flex items-start gap-3.5 rounded-2xl border border-line bg-surface px-4 py-4 transition-[background-color,border-color] duration-150 hover:border-line-strong hover:bg-surface-2 motion-reduce:transition-none sm:px-5"
    >
      <MissionIcon mission={mission} />
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium leading-snug text-ink">{mission.title}</span>
        <span className="mt-0.5 block text-sm leading-relaxed text-ink-muted">{mission.summary}</span>
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <MissionStatusLabel mission={mission} />
          <span className="text-xs text-ink-faint">{missionMeta(mission)}</span>
        </span>
      </span>
      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
    </Link>
  );
}
