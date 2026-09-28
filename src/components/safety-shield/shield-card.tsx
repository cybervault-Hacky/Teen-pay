"use client";

import { ShieldCheck } from "lucide-react";
import type { ShieldAssessment } from "@/domain";
import { Card } from "@/components/ui/card";

/**
 * A calm Safety Shield assessment — context, never a verdict. No
 * scores, no labels, no urgency styling: each reason is one plain
 * title and one plain explanation. Hidden entirely when the shield
 * has nothing to add (`allow`).
 */
export function ShieldCard({
  assessment,
  heading = "Before you continue",
}: {
  assessment: ShieldAssessment;
  heading?: string;
}) {
  if (assessment.outcome === "allow" || assessment.reasons.length === 0) return null;

  return (
    <Card className="border-accent/25 p-4" role="note" aria-label="Safety Shield">
      <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
        Safety Shield · {heading}
      </p>
      <ul className="mt-3 space-y-3">
        {assessment.reasons.map((reason) => (
          <li key={reason.code}>
            <p className="text-sm font-medium text-ink">{reason.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-ink-muted">{reason.explanation}</p>
          </li>
        ))}
      </ul>
      <p className="mt-3 border-t border-line pt-3 text-[11px] leading-relaxed text-ink-faint">
        You&apos;re in control — nothing moves until you confirm.
      </p>
    </Card>
  );
}
