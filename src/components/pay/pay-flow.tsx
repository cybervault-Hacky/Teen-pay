"use client";

import { Check, Hourglass, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { makeId } from "@/lib/ids";
import { formatINR } from "@/lib/currency";
import { initialsOf } from "@/lib/format";
import { amountError } from "@/sandbox/engine";
import { MAX_SANDBOX_AMOUNT } from "@/sandbox/types";
import { evaluatePayment } from "@/sandbox/rules";
import { selectAvailableBalance, selectTeen, selectTeenWallet } from "@/sandbox/selectors";
import { findUser } from "@/sandbox/identity";
import { FrozenBanner } from "@/components/wallet/frozen-banner";
import { useSandbox } from "@/sandbox/store";
import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FlowTransition } from "@/components/motion/flow-transition";
import { AmountInput } from "./amount-input";
import { RecipientPicker } from "./recipient-picker";

type PayMode = "send" | "request";
type Step = "recipient" | "amount" | "review" | "success";

interface PayFlowProps {
  mode: PayMode;
}

/**
 * The complete sandbox money flow:
 * recipient → amount → review → success (or pending approval).
 *
 * One idempotency key is generated when the user reaches review,
 * so double-confirming can never create two payments. Guidance on
 * the amount step comes from the engine's own `evaluatePayment`
 * — the same decision the store makes on confirm — so the UI never
 * re-implements a rule.
 */
export function PayFlow({ mode }: PayFlowProps) {
  const { state, actions } = useSandbox();

  const [step, setStep] = useState<Step>("recipient");
  const [recipientId, setRecipientId] = useState<string | null>(null);
  const [digits, setDigits] = useState("");
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState(false);

  const confirmRef = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const recipient = state.recipients.find((r) => r.id === recipientId) ?? null;
  const available = selectAvailableBalance(state);
  const amount = digits ? Number(digits) : 0;
  const teen = selectTeen(state);
  // A frozen wallet can't pay (the engine enforces it; this explains it).
  const wallet = selectTeenWallet(state);
  const paused = mode === "send" && wallet !== null && wallet.status !== "active";

  // What the engine would decide right now (send mode only).
  const decision =
    mode === "send" && recipient && digits !== ""
      ? evaluatePayment(state, {
          teenId: teen.id,
          recipientId: recipient.id,
          amount,
          at: new Date().toISOString(),
        })
      : null;
  const needsApproval = decision?.kind === "needs_approval";
  const approverName =
    decision?.kind === "needs_approval"
      ? decision.guardian.displayName
      : "your parent";

  // Live validation — the engine's own rules, not a copy.
  const amountMessage = (() => {
    if (digits === "") return "Enter an amount.";
    if (decision?.kind === "rejected") return decision.error.message;
    const error = amountError(amount);
    if (error) return error.message;
    return null;
  })();

  // Move focus to the step heading on every step change.
  useEffect(() => {
    headingRef.current?.focus();
    confirmRef.current = false;
    setActionError(null);
  }, [step]);

  const enterReview = () => {
    // The idempotency key lives for exactly one review visit.
    setConfirmId(
      mode === "send" ? makeId("pay") : makeId("req"),
    );
    setStep("review");
  };

  const confirm = () => {
    if (confirmRef.current || !recipient || !confirmId) return;
    confirmRef.current = true;
    if (mode === "send") {
      const result = actions.pay({
        idempotencyId: confirmId,
        recipientId: recipient.id,
        amount,
      });
      if (result.ok) {
        setPendingApproval(result.value.status === "approval_requested");
        setStep("success");
      } else {
        setActionError(result.error.message);
        confirmRef.current = false;
      }
      return;
    }
    const result = actions.createRequest({
      idempotencyId: confirmId,
      recipientId: recipient.id,
      amount,
      note: note.trim() || undefined,
    });
    if (result.ok) {
      setStep("success");
    } else {
      setActionError(result.error.message);
      confirmRef.current = false;
    }
  };

  const restart = () => {
    setStep("recipient");
    setRecipientId(null);
    setDigits("");
    setNote("");
    setConfirmId(null);
    setPendingApproval(false);
  };

  const question =
    mode === "send"
      ? "Who are you paying?"
      : "Who are you requesting from?";

  return (
    <div>
      {paused && wallet && step !== "success" && (
        <div className="mb-5">
          <FrozenBanner
            wallet={wallet}
            ownerName="Your"
            frozenByName={
              wallet.statusChangedBy && wallet.statusChangedBy !== teen.id
                ? findUser(state, wallet.statusChangedBy)?.displayName
                : undefined
            }
            href="/money"
          />
        </div>
      )}
      <FlowTransition step={step}>
        {step === "recipient" && (
          <RecipientPicker
            question={question}
            recipients={state.recipients}
            onSelect={(id) => {
              setRecipientId(id);
              setStep("amount");
            }}
          />
        )}

        {step === "amount" && (
          <div>
            <StepHeading ref={headingRef} title={recipient?.name ?? ""} />
            <AmountInput
              label="Amount"
              value={digits}
              onChange={setDigits}
              error={amountMessage}
              hint={
                mode === "send"
                  ? `Available ${formatINR(available)} · sandbox cap ${formatINR(MAX_SANDBOX_AMOUNT)}`
                  : `Sandbox cap ${formatINR(MAX_SANDBOX_AMOUNT)}`
              }
            />
            {needsApproval && amountMessage === null && (
              <p
                role="status"
                className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm text-ink-muted"
              >
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-accent" aria-hidden />
                <span>
                  This payment needs parent approval. {approverName} will be
                  asked before anything is sent.
                </span>
              </p>
            )}
            {mode === "request" && (
              <Input
                className="mt-4"
                label="Note (optional)"
                placeholder="What is this for?"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={60}
              />
            )}
            <div className="mt-5 flex gap-2.5">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={() => setStep("recipient")}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                disabled={amountMessage !== null || !recipient}
                onClick={enterReview}
              >
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === "review" && recipient && (
          <div>
            <StepHeading ref={headingRef} title="Confirm" />
            <Card className="p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                {mode === "send" ? "Sending to" : "Requesting from"}
              </p>
              <div className="mt-3 flex items-center gap-3.5">
                <Avatar
                  name={recipient.name}
                  initials={initialsOf(recipient.name)}
                  size="md"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {recipient.name}
                  </p>
                  <p className="text-xs text-ink-muted">{recipient.handle}</p>
                </div>
              </div>
              <div className="mt-5 border-t border-line pt-4">
                <AmountDisplay value={amount} size="lg" />
                {mode === "request" && note.trim() && (
                  <p className="mt-1 text-sm text-ink-muted">“{note.trim()}”</p>
                )}
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="warning">
                  {mode === "send"
                    ? "Sandbox payment"
                    : "Sandbox request — nothing moves yet"}
                </Badge>
                {needsApproval && <Badge tone="accent">Approval required</Badge>}
              </div>
              {needsApproval && (
                <p className="mt-3 text-sm text-ink-muted">
                  This payment needs parent approval. {approverName} will get a
                  request — nothing moves until they approve.
                </p>
              )}
            </Card>
            {actionError && (
              <p role="alert" className="mt-3 px-1 text-sm text-danger">
                {actionError}
              </p>
            )}
            <div className="mt-5 flex gap-2.5">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={restart}
              >
                Cancel
              </Button>
              <Button className="flex-1" onClick={confirm}>
                {mode === "request"
                  ? "Send request"
                  : needsApproval
                    ? `Ask ${approverName} to approve`
                    : "Confirm payment"}
              </Button>
            </div>
          </div>
        )}

        {step === "success" && recipient && (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/12 text-accent">
              {pendingApproval ? (
                <Hourglass className="h-7 w-7" aria-hidden />
              ) : (
                <Check className="h-7 w-7" aria-hidden />
              )}
            </span>
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="mt-5 text-xl font-semibold tracking-tight text-ink outline-none"
            >
              {pendingApproval
                ? "Pending approval"
                : mode === "send"
                  ? "Payment sent"
                  : "Request sent"}
            </h2>
            <AmountDisplay value={amount} size="display" className="mt-2" />
            <p className="mt-1.5 text-sm text-ink-muted">
              {mode === "send"
                ? `to ${recipient.name}`
                : `from ${recipient.name}${note.trim() ? ` · “${note.trim()}”` : ""}`}
            </p>
            {pendingApproval && (
              <p className="mt-3 max-w-xs text-sm text-ink-muted">
                {approverName === "your parent" ? "Your parent" : approverName} has
                been asked. Nothing has been sent yet — you&apos;ll get a
                notification when they decide.
              </p>
            )}
            <div className="mt-4">
              <Badge tone={pendingApproval ? "accent" : "neutral"}>
                {pendingApproval ? "Waiting for approval" : "Sandbox transaction"}
              </Badge>
            </div>
            <div className="mt-8 flex w-full max-w-xs gap-2.5">
              <Button
                variant="secondary"
                className="flex-1"
                href={pendingApproval ? "/family" : "/activity"}
              >
                {pendingApproval ? "View family" : "View activity"}
              </Button>
              <Button className="flex-1" onClick={restart}>
                Done
              </Button>
            </div>
          </div>
        )}
      </FlowTransition>
    </div>
  );
}

/** Step heading that receives focus on step change. */
function StepHeading({
  ref,
  title,
}: {
  ref: React.RefObject<HTMLHeadingElement | null>;
  title: string;
}) {
  return (
    <h2
      ref={ref}
      tabIndex={-1}
      className="mb-4 text-[22px] font-semibold tracking-tight text-ink outline-none"
    >
      {title}
    </h2>
  );
}
