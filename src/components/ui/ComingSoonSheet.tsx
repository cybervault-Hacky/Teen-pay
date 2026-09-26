"use client";

import { Sparkles } from "lucide-react";
import { Button } from "./Button";
import { Sheet } from "./Sheet";

export interface ComingSoonSheetProps {
  open: boolean;
  onClose: () => void;
  feature: string;
  body?: string;
}

/**
 * Honest placeholder for Phase 2+ functionality. Never fakes an action —
 * it names the feature, says plainly it isn't live yet, and closes.
 */
export function ComingSoonSheet({ open, onClose, feature, body }: ComingSoonSheetProps) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={feature}
      description={body ?? "This part of TeenPay is still being built."}
      footer={
        <Button fullWidth onClick={onClose}>
          Got it
        </Button>
      }
    >
      <div className="flex flex-col items-center gap-2 py-2 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent"
          aria-hidden="true"
        >
          <Sparkles className="size-6" />
        </span>
        <p className="max-w-[300px] text-sm leading-relaxed text-muted">
          Real payments, approvals and family controls arrive in the next phase.
          Nothing here moves money today.
        </p>
      </div>
    </Sheet>
  );
}
