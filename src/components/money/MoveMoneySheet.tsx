"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ArrowRight, CircleCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { LedgerSpace } from "@/domain";
import { newOperationKey, parseAmountInput, useSandbox } from "@/sandbox";
import { transitionFast } from "@/design/motion";
import { formatINR } from "@/lib/format";
import {
  Amount,
  Button,
  Notice,
  SandboxBadge,
  SegmentedControl,
  Sheet,
  type SegmentOption,
} from "@/components/ui";
import { AmountInput } from "@/components/pay";

type MoveStep = "details" | "success";

const SPACE_OPTIONS: readonly SegmentOption<LedgerSpace>[] = [
  { value: "spend", label: "Spend" },
  { value: "save", label: "Save" },
  { value: "goals", label: "Goals" },
];

const SPACE_LABELS: Record<LedgerSpace, string> = {
  spend: "Spend",
  save: "Save",
  goals: "Goals",
};

export interface MoveMoneySheetProps {
  open: boolean;
  onClose: () => void;
  initialFrom?: LedgerSpace;
}

function StepShell({ stepKey, children }: { stepKey: string; children: ReactNode }) {
  return (
    <motion.div
      key={stepKey}
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -24 }}
      transition={transitionFast}
    >
      {children}
    </motion.div>
  );
}

/** Shift money between Spaces — posts linked ledger legs. */
export function MoveMoneySheet({ open, onClose, initialFrom = "spend" }: MoveMoneySheetProps) {
  const { wallet, moveBetweenSpaces } = useSandbox();
  const [step, setStep] = useState<MoveStep>("details");
  const [fromSpace, setFromSpace] = useState<LedgerSpace>(initialFrom);
  const [toSpace, setToSpace] = useState<LedgerSpace>("save");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [movedPaise, setMovedPaise] = useState(0);
  const [movedRoute, setMovedRoute] = useState<[LedgerSpace, LedgerSpace]>(["spend", "save"]);
  const [wasOpen, setWasOpen] = useState(open);

  // Fresh flow per opening (render-time adjustment, not an effect).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep("details");
      setFromSpace(initialFrom);
      setToSpace(initialFrom === "save" ? "spend" : "save");
      setText("");
      setError(null);
      setMovedPaise(0);
    }
  }

  const fromBalance = wallet.spaces[fromSpace].balancePaise;

  const handleMove = () => {
    const parsed = parseAmountInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const result = moveBetweenSpaces({
      fromSpace,
      toSpace,
      amountPaise: parsed.paise,
      idempotencyKey: newOperationKey(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setMovedPaise(parsed.paise);
    setMovedRoute([fromSpace, toSpace]);
    setStep("success");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={step === "details" ? "Move money" : "Moved"}
      description={step === "details" ? "Shift money between Spaces." : undefined}
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === "details" && (
          <StepShell stepKey="details">
            <div className="flex flex-col items-center gap-5 py-2">
              <div className="flex w-full flex-col gap-4">
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-muted" >From</p>
                  <SegmentedControl
                    label="From space"
                    options={SPACE_OPTIONS}
                    value={fromSpace}
                    onChange={setFromSpace}
                  />
                </div>
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-muted" >To</p>
                  <SegmentedControl
                    label="To space"
                    options={SPACE_OPTIONS}
                    value={toSpace}
                    onChange={setToSpace}
                  />
                </div>
              </div>
              <AmountInput
                label="How much?"
                value={text}
                onChange={(value) => {
                  setText(value);
                  if (error) setError(null);
                }}
                error={error}
                hint={`${formatINR(fromBalance)} in ${SPACE_LABELS[fromSpace]}`}
                autoFocus
              />
              {error && !parseAmountInput(text).ok && (
                <Notice tone="warning">{error}</Notice>
              )}
              <div className="flex w-full gap-2.5">
                <Button variant="secondary" fullWidth onClick={onClose}>
                  Cancel
                </Button>
                <Button fullWidth onClick={handleMove}>
                  Move money
                </Button>
              </div>
            </div>
          </StepShell>
        )}

        {step === "success" && (
          <StepShell stepKey="success">
            <div className="flex flex-col items-center gap-2 py-2 text-center" role="status">
              <span
                className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success"
                aria-hidden="true"
              >
                <CircleCheck className="size-7" />
              </span>
              <p className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">
                Moved
              </p>
              <Amount value={movedPaise} size="lg" />
              <p className="inline-flex items-center gap-1.5 text-sm text-muted">
                {SPACE_LABELS[movedRoute[0]]}
                <ArrowRight className="size-4" aria-hidden="true" />
                {SPACE_LABELS[movedRoute[1]]}
              </p>
              <div className="mt-1">
                <SandboxBadge />
              </div>
              <div className="mt-4 w-full">
                <Button fullWidth onClick={onClose}>
                  Done
                </Button>
              </div>
            </div>
          </StepShell>
        )}
      </AnimatePresence>
    </Sheet>
  );
}
