"use client";

import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CircleCheck } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { TrustedRecipient } from "@/domain";
import { newOperationKey, parseAmountInput, useSandbox } from "@/sandbox";
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

type PayStep = "amount" | "review" | "success";

export interface PayFlowSheetProps {
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
 * Complete sandbox send flow: amount → review → success.
 * Posts one ledger entry on confirm; idempotency-keyed against doubles.
 */
export function PayFlowSheet({ recipient, onClose }: PayFlowSheetProps) {
  const { wallet, sendPayment } = useSandbox();
  const [step, setStep] = useState<PayStep>("amount");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [opKey, setOpKey] = useState(() => newOperationKey());
  const [paidPaise, setPaidPaise] = useState(0);
  const [lastRecipientId, setLastRecipientId] = useState(recipient?.id);

  // Fresh flow per recipient (render-time adjustment, not an effect).
  if (recipient?.id !== lastRecipientId) {
    setLastRecipientId(recipient?.id);
    setStep("amount");
    setText("");
    setNote("");
    setError(null);
    setProcessing(false);
    setOpKey(newOperationKey());
    setPaidPaise(0);
  }

  const firstName = recipient?.name.split(" ")[0] ?? "";
  const spendPaise = wallet.spaces.spend.balancePaise;

  const handleContinue = () => {
    const parsed = parseAmountInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.paise > spendPaise) {
      setError(
        `Only ${formatINR(spendPaise)} in Spend. Move money from Save first.`,
      );
      return;
    }
    setError(null);
    setStep("review");
  };

  const handleConfirm = () => {
    if (!recipient || processing) return;
    const parsed = parseAmountInput(text);
    if (!parsed.ok) {
      setError(parsed.error);
      setStep("amount");
      return;
    }
    setProcessing(true);
    const result = sendPayment({
      recipient,
      amountPaise: parsed.paise,
      note: note.trim() ? note.trim() : undefined,
      idempotencyKey: opKey,
    });
    setProcessing(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setPaidPaise(parsed.paise);
    setStep("success");
  };

  const reviewPaise = parseAmountInput(text);
  const title =
    step === "amount" ? `Pay ${firstName}` : step === "review" ? "Review payment" : "Payment sent";

  return (
    <Sheet
      open={recipient !== null}
      onClose={onClose}
      title={title}
      description={
        step === "amount" ? recipient?.handle : step === "review" ? "Check the details before sending." : undefined
      }
    >
      {recipient && (
        <AnimatePresence mode="wait" initial={false}>
          {step === "amount" && (
            <StepShell stepKey="amount">
              <div className="flex flex-col items-center gap-5 py-2">
                <Avatar name={recipient.name} size="lg" />
                <AmountInput
                  label={`How much for ${firstName}?`}
                  value={text}
                  onChange={(value) => {
                    setText(value);
                    if (error) setError(null);
                  }}
                  error={error}
                  hint={`${formatINR(spendPaise)} in Spend`}
                  autoFocus
                />
                <div className="w-full">
                  <Input
                    label="Note (optional)"
                    placeholder="What’s this for?"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={60}
                    autoComplete="off"
                  />
                </div>
                <Button fullWidth onClick={handleContinue}>
                  Continue
                </Button>
              </div>
            </StepShell>
          )}

          {step === "review" && (
            <StepShell stepKey="review">
              <div className="flex flex-col items-center gap-5 py-2">
                <div className="flex items-center gap-3">
                  <Avatar name={recipient.name} />
                  <div>
                    <p className="text-[15px] font-semibold text-ink">{recipient.name}</p>
                    <p className="text-[13px] text-faint">{recipient.handle}</p>
                  </div>
                </div>
                {reviewPaise.ok && <Amount value={reviewPaise.paise} size="display" />}
                <dl className="flex w-full flex-col gap-3 rounded-2xl bg-surface-2 p-4 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-faint">From</dt>
                    <dd className="font-medium text-ink">Spend space</dd>
                  </div>
                  {note.trim() && (
                    <div className="flex items-center justify-between gap-4">
                      <dt className="text-faint">Note</dt>
                      <dd className="max-w-[220px] truncate font-medium text-ink">{note.trim()}</dd>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-faint">Fee</dt>
                    <dd className="font-medium text-ink">None</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-faint">Type</dt>
                    <dd>
                      <SandboxBadge />
                    </dd>
                  </div>
                </dl>
                {error && (
                  <Notice tone="warning">
                    Payment couldn&apos;t be completed. {error}
                  </Notice>
                )}
                <div className="flex w-full gap-2.5">
                  <Button variant="secondary" fullWidth onClick={onClose} disabled={processing}>
                    Cancel
                  </Button>
                  <Button
                    fullWidth
                    onClick={handleConfirm}
                    loading={processing}
                    disabled={processing}
                  >
                    {processing
                      ? "Sending…"
                      : reviewPaise.ok
                        ? `Pay ${formatINR(reviewPaise.paise)}`
                        : "Pay"}
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
                  Payment sent
                </p>
                <Amount value={paidPaise} size="lg" />
                <p className="text-sm text-muted">
                  to {recipient.name} · {recipient.handle}
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
