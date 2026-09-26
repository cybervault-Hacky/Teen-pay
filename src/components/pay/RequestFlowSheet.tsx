"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { TrustedRecipient } from "@/domain";
import { parseAmountInput, useSandbox } from "@/sandbox";
import { transitionFast } from "@/design/motion";
import { formatINR } from "@/lib/format";
import {
  Amount,
  Avatar,
  Button,
  buttonClassName,
  Input,
  Notice,
  SandboxBadge,
  Sheet,
} from "@/components/ui";
import { AmountInput } from "./AmountInput";

type RequestStep = "details" | "success";

export interface RequestFlowSheetProps {
  /** Null closes the sheet. */
  recipient: TrustedRecipient | null;
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

/**
 * Money-request flow: amount + note → created. Moves no money —
 * it records a pending request that appears in Activity.
 */
export function RequestFlowSheet({ recipient, onClose }: RequestFlowSheetProps) {
  const { createRequest } = useSandbox();
  const [step, setStep] = useState<RequestStep>("details");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [createdPaise, setCreatedPaise] = useState(0);
  const [lastRecipientId, setLastRecipientId] = useState(recipient?.id);

  // Fresh flow per recipient (render-time adjustment, not an effect).
  if (recipient?.id !== lastRecipientId) {
    setLastRecipientId(recipient?.id);
    setStep("details");
    setText("");
    setNote("");
    setError(null);
    setCreatedPaise(0);
  }

  const firstName = recipient?.name.split(" ")[0] ?? "";

  const handleCreate = () => {
    if (!recipient) return;
    const parsed = parseAmountInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const result = createRequest({
      targetName: recipient.name,
      targetHandle: recipient.handle,
      targetKind: recipient.kind,
      amountPaise: parsed.paise,
      note: note.trim() ? note.trim() : undefined,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setCreatedPaise(parsed.paise);
    setStep("success");
  };

  return (
    <Sheet
      open={recipient !== null}
      onClose={onClose}
      title={step === "details" ? `Request from ${firstName}` : "Request sent"}
      description={step === "details" ? recipient?.handle : undefined}
    >
      {recipient && (
        <AnimatePresence mode="wait" initial={false}>
          {step === "details" && (
            <StepShell stepKey="details">
              <div className="flex flex-col items-center gap-5 py-2">
                <Avatar name={recipient.name} size="lg" />
                <AmountInput
                  label={`How much from ${firstName}?`}
                  value={text}
                  onChange={(value) => {
                    setText(value);
                    if (error) setError(null);
                  }}
                  error={error}
                  hint="Requests never move money by themselves"
                  autoFocus
                />
                <div className="w-full">
                  <Input
                    label="Note (optional)"
                    placeholder="What’s it for?"
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
                  <Button fullWidth onClick={handleCreate}>
                    Send request
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
                  Request sent
                </p>
                <Amount value={createdPaise} size="lg" />
                <p className="text-sm text-muted">
                  to {recipient.name} · {formatINR(createdPaise)} · pending
                </p>
                <div className="mt-1">
                  <SandboxBadge />
                </div>
                <div className="mt-4 flex w-full gap-2.5">
                  <Link
                    href="/activity"
                    onClick={onClose}
                    className={buttonClassName({ variant: "secondary", fullWidth: true })}
                  >
                    View activity
                  </Link>
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
