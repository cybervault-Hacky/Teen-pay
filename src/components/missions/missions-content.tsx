"use client";

import Link from "next/link";
import { ChevronRight, Compass, ShieldCheck } from "lucide-react";
import { MISSION_CATEGORIES, MISSION_CATEGORY_LABEL, type MissionBoard } from "@/domain";
import { cn } from "@/lib/cn";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { MissionCard } from "./mission-card";
import { useMissionBoard } from "./use-missions";

/**
 * Money Missions — the overview. Grouped by category (four, so no
 * filters are needed). Progress is a count in words; there are no
 * scores, streaks, timers or rewards.
 */
export function MissionsContent() {
  const result = useMissionBoard();
  return (
    <div>
      <PageHeader
        title="Money Missions"
        description="Short, optional lessons and challenges about your own money. They never move money."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      {!result.ok ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="Money Missions aren't available right now"
            description={
              result.error.code === "not_permitted"
                ? "Money Missions are available on teen accounts."
                : "Nothing was changed. Try again in a moment."
            }
            className="py-10"
          />
        </Card>
      ) : result.value.missions.length === 0 ? (
        <Card>
          <EmptyState
            icon={Compass}
            title="No missions right now"
            description="Check back later for new lessons and challenges."
            className="py-10"
          />
        </Card>
      ) : (
        <Board board={result.value} />
      )}
    </div>
  );
}

function Board({ board }: { board: MissionBoard }) {
  return (
    <div className="space-y-6">
      <section aria-label="Your progress">
        <Card className="p-4 sm:p-5">
          <p className="text-sm text-ink-muted">Your progress</p>
          <p className="mt-1 text-xl font-semibold tracking-tight text-ink">
            {board.completed} of {board.total} completed
          </p>
          <div className="mt-3 flex gap-1" aria-hidden>
            {board.missions.map((m) => (
              <span
                key={m.id}
                className={cn(
                  "h-1.5 flex-1 rounded-full",
                  m.status === "completed" ? "bg-success" : m.status === "in_progress" ? "bg-accent/60" : "bg-surface-2",
                )}
              />
            ))}
          </div>
          {board.next ? (
            <Link
              href={board.next.href}
              className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-accent transition-colors duration-150 hover:text-accent-strong motion-reduce:transition-none"
            >
              {board.next.status === "in_progress" ? "Continue" : "Explore"}: {board.next.title}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          ) : (
            <p className="mt-4 text-sm text-ink-muted">You&apos;ve completed every mission. You can review any of them below.</p>
          )}
        </Card>
      </section>

      {MISSION_CATEGORIES.map((category) => {
        const missions = board.missions.filter((m) => m.category === category);
        if (missions.length === 0) return null;
        const label = MISSION_CATEGORY_LABEL[category];
        return (
          <section key={category} aria-label={label}>
            <SectionHeader title={label} />
            <ul className="grid gap-2.5 lg:grid-cols-2">
              {missions.map((mission) => (
                <li key={mission.id} className="min-w-0">
                  <MissionCard mission={mission} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-xs leading-relaxed text-ink-faint">
        Missions are for learning. They never move money, give rewards or change your limits, and your progress is
        private to you. Sandbox only.
      </p>
    </div>
  );
}
