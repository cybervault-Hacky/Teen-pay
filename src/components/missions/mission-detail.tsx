"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronLeft, Circle, CircleDot, Compass, Lock } from "lucide-react";
import type { MissionStepView, MissionView } from "@/domain";
import { cn } from "@/lib/cn";
import { formatLongDateKey } from "@/lib/format";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { MissionIcon, MissionStatusLabel, missionMeta } from "./mission-parts";
import { MissionStepPanel } from "./mission-step-panel";
import { useMission, useMissionBoard } from "./use-missions";

function BackLink() {
  return (
    <Link
      href="/missions"
      className="mb-4 inline-flex items-center gap-1 text-sm text-ink-muted transition-colors duration-150 hover:text-ink motion-reduce:transition-none"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden />
      Missions
    </Link>
  );
}

/**
 * One mission. The id comes from the URL but only selects a public
 * catalog entry; progress is always the signed-in teen's own. An
 * unknown id shows a calm "not found" — nothing is created.
 */
export function MissionDetail({ missionId }: { missionId: string }) {
  const result = useMission(missionId);

  if (!result.ok) {
    const unknown = result.error.code === "unknown_mission";
    return (
      <div>
        <BackLink />
        <Card>
          <EmptyState
            icon={Compass}
            title={unknown ? "We couldn't find that mission" : "This mission isn't available right now"}
            description={
              unknown
                ? "It may have been renamed. Your other missions are still here."
                : result.error.code === "not_permitted"
                  ? "Money Missions are available on teen accounts."
                  : "Nothing was changed. Try again in a moment."
            }
            action={
              <Button href="/missions" variant="secondary" size="sm">
                All missions
              </Button>
            }
            className="py-10"
          />
        </Card>
      </div>
    );
  }

  return <MissionScreen mission={result.value} />;
}

function MissionScreen({ mission }: { mission: MissionView }) {
  const { actions } = useSandbox();
  const [error, setError] = useState<string | null>(null);
  const panelHeading = useRef<HTMLHeadingElement>(null);
  // Focus follows the step as it changes — never on first arrival.
  const stepKey = `${mission.status}:${mission.progress.completedSteps}`;
  const firstKey = useRef(stepKey);
  useEffect(() => {
    if (stepKey !== firstKey.current) panelHeading.current?.focus();
  }, [stepKey]);

  function start() {
    const res = actions.startMission(mission.id);
    setError(res.ok ? null : res.error.message);
  }

  function advance(step: MissionStepView, answer?: number): boolean {
    const res = actions.advanceMission(mission.id, step.id, answer);
    setError(res.ok ? null : res.error.message);
    return res.ok;
  }

  return (
    <div>
      <BackLink />
      <header className="mb-6 flex items-start gap-4">
        <MissionIcon mission={mission} size="lg" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium uppercase tracking-[0.08em] text-ink-faint">{mission.categoryLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-ink">{mission.title}</h1>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">{mission.purpose}</p>
          <p className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            <MissionStatusLabel mission={mission} />
            <span className="text-xs text-ink-faint">{missionMeta(mission)}</span>
          </p>
        </div>
      </header>

      <div className="space-y-6">
        <section aria-label={mission.status === "in_progress" ? "Current step" : "Mission"}>
          {mission.status === "locked" ? (
            <LockedPanel mission={mission} />
          ) : mission.status === "completed" ? (
            <CompletedPanel mission={mission} headingRef={panelHeading} />
          ) : mission.status === "available" ? (
            <Card className="p-4 sm:p-5">
              <h2 ref={panelHeading} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
                What you&apos;ll do
              </h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-muted">
                {mission.progress.totalSteps} short steps, about {mission.estimatedMinutes} minutes. You can stop any
                time and pick up where you left off. Nothing here moves money.
              </p>
              <Button className="mt-4" onClick={start}>
                Start mission
              </Button>
            </Card>
          ) : mission.currentStep ? (
            <MissionStepPanel
              key={mission.currentStep.id}
              mission={mission}
              step={mission.currentStep}
              headingRef={panelHeading}
              onAdvance={advance}
            />
          ) : null}
          {error && (
            <p role="alert" className="mt-3 text-sm text-danger">
              {error}
            </p>
          )}
        </section>

        <StepsOverview mission={mission} />
      </div>
    </div>
  );
}

function LockedPanel({ mission }: { mission: MissionView }) {
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <Lock className="mt-0.5 h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-ink">Locked for now</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">
            {mission.lockedReason} You can try the other missions in the meantime.
          </p>
          <Button href="/missions" variant="secondary" size="sm" className="mt-4">
            All missions
          </Button>
        </div>
      </div>
    </Card>
  );
}

function CompletedPanel({
  mission,
  headingRef,
}: {
  mission: MissionView;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
}) {
  const board = useMissionBoard();
  const next = board.ok ? board.value.next : null;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden />
        <div className="min-w-0">
          <h2 ref={headingRef} tabIndex={-1} className="text-[15px] font-semibold text-ink outline-none">
            Mission completed
          </h2>
          <p className="mt-1 text-sm font-medium text-ink">{mission.completion.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-muted">{mission.completion.body}</p>
          {mission.completedOn && (
            <p className="mt-2 text-xs text-ink-faint">Completed on {formatLongDateKey(mission.completedOn)}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            {next && (
              <Button href={next.href} size="sm">
                Next: {next.title}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            )}
            <Button href="/missions" variant="secondary" size="sm">
              All missions
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

const STEP_STATE_LABEL = { done: "Done", current: "Current step", upcoming: "Not yet" } as const;

/** Every step in order, with its state in words. Done steps can be re-read. */
function StepsOverview({ mission }: { mission: MissionView }) {
  return (
    <section aria-label="Steps">
      <SectionHeader title="Steps" />
      <Card>
        <ol className="divide-y divide-line">
          {mission.steps.map((step) => {
            const Icon = step.state === "done" ? CheckCircle2 : step.state === "current" ? CircleDot : Circle;
            const title = step.kind === "check" ? "Quick check" : step.title;
            const body = step.kind === "check" ? null : step.body;
            const row = (
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <Icon
                  className={cn(
                    "h-4 w-4 shrink-0",
                    step.state === "done" ? "text-success" : step.state === "current" ? "text-accent" : "text-ink-faint",
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 text-sm text-ink">
                  <span className="text-ink-faint">{step.number}. </span>
                  {title}
                </span>
                <span className="shrink-0 text-xs text-ink-muted">{STEP_STATE_LABEL[step.state]}</span>
              </span>
            );
            return (
              <li key={step.id} className="px-4 py-3 sm:px-5" aria-current={step.state === "current" ? "step" : undefined}>
                {step.state === "done" && body ? (
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center gap-2 [&::-webkit-details-marker]:hidden">
                      {row}
                    </summary>
                    <div className="mt-2 space-y-2 pl-7">
                      {body.map((p) => (
                        <p key={p} className="text-sm leading-relaxed text-ink-muted">
                          {p}
                        </p>
                      ))}
                    </div>
                  </details>
                ) : (
                  row
                )}
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}
