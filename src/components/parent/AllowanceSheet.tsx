"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import { newOperationKey, parseAmountInput, useSandbox } from "@/sandbox";
import { transitionFast } from "@/design/motion";
import {
  Amount,
  Avatar,
  Button,
  Input,
  Notice,
  SandboxBadge,
  Sheet,
} from "@/components/ui";
import { AmountInput } from "@/components/pay";

type AllowanceStep = "details" | "success";

export interface AllowanceSheetProps {
  open: boolean;
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

/** Parent sends pocket money — posts an allowance entry to the teen ledger. */
export function AllowanceSheet({ open, onClose }: AllowanceSheetProps) {
  const { teen, sendAllowance } = useSandbox();
  const [step, setStep] = useState<AllowanceStep>("details");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sentPaise, setSentPaise] = useState(0);
  const [wasOpen, setWasOpen] = useState(open);

  // Fresh flow per opening (render-time adjustment, not an effect).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep("details");
      setText("");
      setNote("");
      setError(null);
      setSentPaise(0);
    }
  }

  const firstName = teen.displayName.split(" ")[0];

  const handleSend = () => {
    const parsed = parseAmountInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const result = sendAllowance({
      amountPaise: parsed.paise,
      note: note.trim() ? note.trim() : undefined,
      idempotencyKey: newOperationKey(),
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setSentPaise(parsed.paise);
    setStep("success");
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={step === "details" ? "Send pocket money" : "Sent"}
      description={step === "details" ? `To ${teen.displayName} · lands in Spend` : undefined}
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === "details" && (
          <StepShell stepKey="details">
            <div className="flex flex-col items-center gap-5 py-2">
              <Avatar name={teen.displayName} size="lg" />
              <AmountInput
                label={`How much for ${firstName}?`}
                value={text}
                onChange={(value) => {
                  setText(value);
                  if (error) setError(null);
                }}
                error={error}
                hint="Allowance always lands in Spend"
                suggestions={[
                  { label: "₹100", paise: 10_000 },
                  { label: "₹200", paise: 20_000 },
                  { label: "₹500", paise: 50_000 },
                ]}
                onSuggestion={(paise) => {
                  setText(String(paise / 100));
                  setError(null);
                }}
                autoFocus
              />
              <div className="w-full">
                <Input
                  label="Note (optional)"
                  placeholder="e.g. September allowance"
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={60}
                  autoComplete="off"
                />
              </div>
              {error && <Notice tone="warning">{error}</Notice>}
              <div className="flex w-full gap-2.5">
                <Button variant="secondary" fullWidth onClick={onClose}>
                  Cancel
                </Button>
                <Button fullWidth onClick={handleSend}>
                  Send
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
                Sent
              </p>
              <Amount value={sentPaise} size="lg" tone="positive" />
              <p className="text-sm text-muted">to {teen.displayName}</p>
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
