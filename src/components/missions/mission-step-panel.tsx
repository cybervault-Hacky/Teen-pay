"use client";

import { useId, useState } from "react";
import { ArrowRight, CheckCircle2, Circle } from "lucide-react";
import type { MissionStepView, MissionView } from "@/domain";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Props {
  mission: MissionView;
  step: MissionStepView;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  /** Asks the engine to finish this step; true when it did. */
  onAdvance: (step: MissionStepView, answer?: number) => boolean;
}

/**
 * The step the teen is on. Every "Continue" goes to the engine, which
 * re-checks order, answers and evidence — the UI never marks a step
 * done by itself. Checks are gentle: a wrong answer shows a hint and
 * can be tried again, with no penalty and no timer.
 */
export function MissionStepPanel({ mission, step, headingRef, onAdvance }: Props) {
  const last = step.number === mission.progress.totalSteps;
  const continueLabel = last ? "Complete mission" : "Continue";
  return (
    <Card className="p-4 sm:p-5">
      <p className="text-xs font-medium text-accent">
        Step {step.number} of {mission.progress.totalSteps}
      </p>
      <h2 ref={headingRef} tabIndex={-1} className="mt-1 text-[15px] font-semibold text-ink outline-none">
        {step.kind === "check" ? "Quick check" : step.title}
      </h2>
      {step.kind === "read" && (
        <>
          <Paragraphs body={step.body} />
          <Button className="mt-4" onClick={() => onAdvance(step)}>
            {continueLabel}
            {!last && <ArrowRight className="h-4 w-4" aria-hidden />}
          </Button>
        </>
      )}
      {step.kind === "check" && <CheckPanel step={step} continueLabel={continueLabel} onAdvance={onAdvance} />}
      {step.kind === "visit" && (
        <>
          <Paragraphs body={step.body} />
          <p className="mt-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink">
            {step.instruction}
          </p>
          <Button className="mt-4" href={step.href}>
            {step.actionLabel}
            <ArrowRight className="h-4 w-4" aria-hidden />
          </Button>
          <p className="mt-2 text-xs text-ink-faint">You&apos;ll mark this step done on that screen.</p>
        </>
      )}
      {step.kind === "evidence" && step.evidence && (
        <>
          <Paragraphs body={step.body} />
          <p className="mt-3 flex items-start gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink">
            {step.evidence.met ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden />
            ) : (
              <Circle className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            )}
            <span>{step.evidence.text}</span>
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {step.evidence.met ? (
              <Button onClick={() => onAdvance(step)}>{continueLabel}</Button>
            ) : (
              <Button href={step.href}>
                {step.actionLabel}
                <ArrowRight className="h-4 w-4" aria-hidden />
              </Button>
            )}
          </div>
          {!step.evidence.met && (
            <p className="mt-2 text-xs text-ink-faint">
              It uses the usual screen and moves no money. Come back here when you&apos;re done.
            </p>
          )}
        </>
      )}
    </Card>
  );
}

function Paragraphs({ body }: { body: readonly string[] }) {
  return (
    <div className="mt-2 space-y-2">
      {body.map((p) => (
        <p key={p} className="text-sm leading-relaxed text-ink-muted">
          {p}
        </p>
      ))}
    </div>
  );
}

function CheckPanel({
  step,
  continueLabel,
  onAdvance,
}: {
  step: Extract<MissionStepView, { kind: "check" }>;
  continueLabel: string;
  onAdvance: Props["onAdvance"];
}) {
  const name = useId();
  const [choice, setChoice] = useState<number | null>(null);
  const [checked, setChecked] = useState<"right" | "wrong" | null>(null);
  const right = checked === "right";

  return (
    <div className="mt-2">
      <fieldset disabled={right}>
        <legend className="text-sm leading-relaxed text-ink">{step.title}</legend>
        <div className="mt-3 space-y-2">
          {step.options.map((option, i) => (
            <label
              key={option}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors duration-150 motion-reduce:transition-none",
                choice === i ? "border-accent/50 bg-accent/5 text-ink" : "border-line bg-surface-2 text-ink-muted hover:text-ink",
              )}
            >
              <input
                type="radio"
                name={name}
                className="mt-0.5 accent-accent"
                checked={choice === i}
                onChange={() => {
                  setChoice(i);
                  setChecked(null);
                }}
              />
              {option}
            </label>
          ))}
        </div>
      </fieldset>
      <div role="status" className="mt-3 text-sm leading-relaxed">
        {checked === "right" && (
          <p className="text-ink">
            <span className="font-medium text-success">That&apos;s right. </span>
            {step.explanation}
          </p>
        )}
        {checked === "wrong" && (
          <p className="text-ink-muted">
            <span className="font-medium text-ink">Not quite. </span>
            {step.hint}
          </p>
        )}
      </div>
      <div className="mt-4">
        {right ? (
          <Button onClick={() => onAdvance(step, choice ?? undefined)}>{continueLabel}</Button>
        ) : (
          <Button
            disabled={choice === null}
            onClick={() => setChecked(choice === step.answer ? "right" : "wrong")}
          >
            Check answer
          </Button>
        )}
      </div>
    </div>
  );
}
