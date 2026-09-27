"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/section-header";
import { MissionIcon, MissionStatusLabel } from "./mission-parts";
import { useMissionBoard } from "./use-missions";

/**
 * Home: a calm pointer to Money Missions — how many are done, in
 * words, and the next one. No pressure, no streaks, no rewards.
 */
export function MissionsHomeCard() {
  const result = useMissionBoard();
  if (!result.ok) return null;
  const { completed, total, next } = result.value;
  return (
    <section aria-label="Money Missions">
      <SectionHeader title="Money Missions" href="/missions" linkLabel="All missions" />
      <Card className="p-4 sm:p-5">
        <p className="text-sm text-ink-muted">
          {completed} of {total} completed
        </p>
        {next ? (
          <Link
            href={next.href}
            className="mt-3 flex items-center gap-3.5 rounded-xl transition-opacity duration-150 hover:opacity-90 motion-reduce:transition-none"
          >
            <MissionIcon mission={next} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium text-accent">
                {next.status === "in_progress" ? "Continue learning" : "Up next"}
              </span>
              <span className="block truncate text-[15px] font-medium text-ink">{next.title}</span>
              <MissionStatusLabel mission={next} className="mt-0.5" />
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          </Link>
        ) : (
          <p className="mt-1 text-[15px] font-medium text-ink">You&apos;ve completed every mission.</p>
        )}
      </Card>
    </section>
  );
}
