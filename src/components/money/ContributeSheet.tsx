"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck, Target } from "lucide-react";
import { useState, type ReactNode } from "react";
import { goalProgress, type LedgerSpace, type SavingsGoal } from "@/domain";
import { newOperationKey, parseAmountInput, useSandbox } from "@/sandbox";
import { transitionFast } from "@/design/motion";
import { formatINR, formatPercent } from "@/lib/format";
import {
  Amount,
  Button,
  ProgressBar,
  SandboxBadge,
  SegmentedControl,
  Sheet,
  type SegmentOption,
} from "@/components/ui";
import { AmountInput } from "@/components/pay";

type ContributeStep = "details" | "success";

const FROM_OPTIONS: readonly SegmentOption<LedgerSpace>[] = [
  { value: "spend", label: "Spend" },
  { value: "save", label: "Save" },
];

export interface ContributeSheetProps {
  /** Null closes the sheet. */
  goal: SavingsGoal | null;
  onClose: () => void;
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

/** Top up a goal from Spend or Save — posts linked ledger legs. */
export function ContributeSheet({ goal, onClose }: ContributeSheetProps) {
  const { wallet, contributeToGoal } = useSandbox();
  const [step, setStep] = useState<ContributeStep>("details");
  const [fromSpace, setFromSpace] = useState<LedgerSpace>("spend");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [addedPaise, setAddedPaise] = useState(0);
  const [snapshotSaved, setSnapshotSaved] = useState(0);
  const [lastGoalId, setLastGoalId] = useState(goal?.id);

  // Fresh flow per goal (render-time adjustment, not an effect).
  if (goal?.id !== lastGoalId) {
    setLastGoalId(goal?.id);
    setStep("details");
    setFromSpace("spend");
    setText("");
    setError(null);
    setAddedPaise(0);
    setSnapshotSaved(0);
  }

  const fromBalance = wallet.spaces[fromSpace].balancePaise;

  const handleAdd = () => {
    if (!goal) return;
    const parsed = parseAmountInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const result = contributeToGoal({
      goalId: goal.id,
      fromSpace,
      amountPaise: parsed.paise,
      idempotencyKey: newOperationKey(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setAddedPaise(parsed.paise);
    setSnapshotSaved(goal.savedPaise);
    setStep("success");
  };

  const completed =
    goal !== null && snapshotSaved + addedPaise >= goal.targetPaise && goal.targetPaise > 0;

  return (
    <Sheet
      open={goal !== null}
      onClose={onClose}
      title={step === "details" ? `Add to ${goal?.name ?? "goal"}` : completed ? "Goal reached" : "Added"}
      description={
        step === "details" && goal
          ? `${formatINR(goal.savedPaise)} of ${formatINR(goal.targetPaise)} saved`
          : undefined
      }
    >
      {goal && (
        <AnimatePresence mode="wait" initial={false}>
          {step === "details" && (
            <StepShell stepKey="details">
              <div className="flex flex-col items-center gap-5 py-2">
                <div>
                  <p className="mb-1.5 text-[13px] font-medium text-muted">From</p>
                  <SegmentedControl
                    label="From space"
                    options={FROM_OPTIONS}
                    value={fromSpace}
                    onChange={setFromSpace}
                  />
                </div>
                <AmountInput
                  label="How much?"
                  value={text}
                  onChange={(value) => {
                    setText(value);
                    if (error) setError(null);
                  }}
                  error={error}
                  hint={`${formatINR(fromBalance)} in ${fromSpace === "spend" ? "Spend" : "Save"}`}
                  autoFocus
                />
                <div className="flex w-full gap-2.5">
                  <Button variant="secondary" fullWidth onClick={onClose}>
                    Cancel
                  </Button>
                  <Button fullWidth onClick={handleAdd}>
                    Add money
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
                  {completed ? <Target className="size-7" /> : <CircleCheck className="size-7" />}
                </span>
                <p className="mt-2 font-display text-xl font-semibold tracking-tight text-ink">
                  {completed ? "Goal reached" : "Added"}
                </p>
                <Amount value={addedPaise} size="lg" />
                <p className="text-sm text-muted">to {goal.name}</p>
                <div className="mt-2 w-full">
                  <ProgressBar
                    value={goalProgress({ ...goal, savedPaise: snapshotSaved + addedPaise })}
                    label={`${goal.name} progress`}
                  />
                  <p className="tnum mt-1.5 text-xs text-faint">
                    {formatPercent(snapshotSaved + addedPaise, goal.targetPaise)} saved
                  </p>
                </div>
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
      )}
    </Sheet>
  );
}
