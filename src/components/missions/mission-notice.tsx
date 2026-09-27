"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import type { MissionSurface } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";

export type NoticeScreen = "activity" | "coach" | "money";

const SCREEN_SURFACES: Record<NoticeScreen, readonly MissionSurface[]> = {
  activity: ["activity", "transaction"],
  coach: ["coach"],
  money: [],
};

const WAITING: Record<MissionSurface, string> = {
  activity: "",
  transaction: "Open any transaction below to see its details first.",
  coach: "Open any lesson under Learn first.",
};

/**
 * A quiet note on an existing screen when the teen arrives from a
 * mission (`?mission=<catalog slug>`). It explains the step and, for
 * a "visit" step, lets the teen mark it done once they've actually
 * done the thing (opened a transaction or a lesson). Everything else
 * on the screen works exactly as usual. An unknown or stale slug
 * shows nothing.
 */
interface NoticeProps {
  screen: NoticeScreen;
  transactionOpened?: boolean;
  lessonOpened?: boolean;
}

export function MissionNotice(props: NoticeProps) {
  const missionId = useSearchParams().get("mission");
  return missionId ? <Notice {...props} missionId={missionId} /> : null;
}

function Notice({ screen, transactionOpened = false, lessonOpened = false, missionId }: NoticeProps & { missionId: string }) {
  const router = useRouter();
  const { actions } = useSandbox();
  const [error, setError] = useState<string | null>(null);
  const result = actions.missionDetail(missionId);
  if (!result.ok) return null;
  const mission = result.value;
  const step = mission.currentStep;

  let body: React.ReactNode;
  if (step?.kind === "visit" && SCREEN_SURFACES[screen].includes(step.surface)) {
    const ready =
      step.surface === "activity" || (step.surface === "transaction" ? transactionOpened : lessonOpened);
    const markDone = () => {
      const res = actions.advanceMission(mission.id, step.id);
      if (res.ok) router.push(mission.href);
      else setError(res.error.message);
    };
    body = (
      <>
        <p className="mt-1 text-sm text-ink">{step.instruction}</p>
        {!ready && <p className="mt-1 text-xs text-ink-muted">{WAITING[step.surface]}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" disabled={!ready} onClick={markDone}>
            Mark step done
          </Button>
          <Button size="sm" variant="ghost" href={mission.href}>
            Back to mission
          </Button>
        </div>
      </>
    );
  } else if (step?.kind === "evidence" && screen === "money" && step.evidence) {
    body = (
      <>
        <p className="mt-1 flex items-start gap-2 text-sm text-ink">
          {step.evidence.met ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
          ) : (
            <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          )}
          <span>
            {step.evidence.met
              ? `${step.evidence.text} Head back to the mission to continue.`
              : `${step.evidence.text} ${step.body.join(" ")}`}
          </span>
        </p>
        <div className="mt-3">
          <Button size="sm" variant={step.evidence.met ? "primary" : "ghost"} href={mission.href}>
            Back to mission
          </Button>
        </div>
      </>
    );
  } else {
    body = (
      <div className="mt-2">
        <Button size="sm" variant="ghost" href={mission.href}>
          Back to mission
        </Button>
      </div>
    );
  }

  return (
    <section aria-label="Mission step" className="mb-6 rounded-2xl border border-accent/25 bg-accent/5 px-4 py-3.5 sm:px-5">
      <p className="flex items-center gap-1.5 text-xs font-medium text-accent">
        <ListChecks className="h-3.5 w-3.5" aria-hidden />
        Mission · {mission.title}
      </p>
      {body}
      {error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
