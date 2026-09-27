"use client";

import { Check, Hourglass, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { PEER_NOTE_MAX, PEER_REQUEST_TTL_DAYS, type PeerProfile } from "@/domain";
import { makeId } from "@/lib/ids";
import { formatINR } from "@/lib/currency";
import { formatFullDateTime } from "@/lib/format";
import { amountError } from "@/sandbox/engine";
import { MAX_SANDBOX_AMOUNT } from "@/sandbox/types";
import { evaluateTransfer } from "@/sandbox/rules";
import { selectSendableBalance, selectTeenWallet } from "@/sandbox/selectors";
import { findUser } from "@/sandbox/identity";
import { useSandbox } from "@/sandbox/store";
import { FrozenBanner } from "@/components/wallet/frozen-banner";
import { AmountDisplay } from "@/components/ui/amount";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { FlowTransition } from "@/components/motion/flow-transition";
import { AmountInput } from "@/components/pay/amount-input";
import { PeerSearch } from "./peer-search";

export type PeerMode = "send" | "request";
type Step = "recipient" | "amount" | "review" | "done";

/** What the engine confirmed — the success screen shows only this. */
type Receipt =
  | { kind: "sent"; amount: number; party: PeerProfile; reference: string; at: string }
  | { kind: "approval"; amount: number; party: PeerProfile; guardianName: string }
  | { kind: "requested"; amount: number; party: PeerProfile; note?: string; expiresAt: string };

/**
 * TeenPay-to-TeenPay: recipient → amount → review → done.
 *
 * - The idempotency key is created once, when review opens. Double
 *   clicks, retries and stale re-submits reuse it, so the engine can
 *   never post twice; going back and changing anything gets a new key.
 * - Amount guidance is the engine's own decision (`evaluateTransfer`),
 *   so the screen never re-implements a rule; the engine checks again
 *   on confirm.
 * - Success is shown only from the engine's result.
 */
export function PeerFlow({ mode }: { mode: PeerMode }) {
  const { state, actions, viewer } = useSandbox();

  const [step, setStep] = useState<Step>("recipient");
  const [party, setParty] = useState<PeerProfile | null>(null);
  const [digits, setDigits] = useState("");
  const [note, setNote] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const sendable = selectSendableBalance(state);
  const amount = digits ? Number(digits) : 0;
  const wallet = selectTeenWallet(state);
  const paused = mode === "send" && wallet !== null && wallet.status !== "active";

  const decision =
    mode === "send" && digits !== ""
      ? evaluateTransfer(state, { teenId: viewer.id, amount, at: new Date().toISOString() })
      : null;
  const needsApproval = decision?.kind === "needs_approval";
  const approverName = decision?.kind === "needs_approval" ? decision.guardian.displayName : "your parent";

  const amountMessage = (() => {
    if (digits === "") return "Enter an amount.";
    const invalid = amountError(amount);
    if (invalid) return invalid.message;
    if (decision?.kind === "rejected") return decision.error.message;
    return null;
  })();

  useEffect(() => {
    setActionError(null);
  }, [step]);

  const enterReview = () => {
    setKey(makeId(mode === "send" ? "snd" : "prq"));
    setStep("review");
  };

  const confirm = () => {
    if (!party || !key) return;
    if (mode === "send") {
      const result = actions.sendMoney({
        recipient: party.handle,
        amount,
        note: note.trim() || undefined,
        idempotencyKey: key,
      });
      if (!result.ok) return setActionError(result.error.message);
      const value = result.value;
      setReceipt(
        value.status === "completed"
          ? { kind: "sent", amount: value.amount, party: value.recipient, reference: value.reference, at: value.completedAt }
          : { kind: "approval", amount: value.amount, party: value.recipient, guardianName: value.guardianName },
      );
    } else {
      const result = actions.createMoneyRequest({
        payer: party.handle,
        amount,
        note: note.trim() || undefined,
        idempotencyKey: key,
      });
      if (!result.ok) return setActionError(result.error.message);
      setReceipt({
        kind: "requested",
        amount: result.value.amount,
        party: result.value.payer,
        ...(note.trim() ? { note: note.trim() } : {}),
        expiresAt: result.value.expiresAt,
      });
    }
    setStep("done");
  };

  const restart = () => {
    setStep("recipient");
    setParty(null);
    setDigits("");
    setNote("");
    setKey(null);
    setReceipt(null);
  };

  return (
    <div>
      {paused && wallet && step !== "done" && (
        <div className="mb-5">
          <FrozenBanner
            wallet={wallet}
            ownerName="Your"
            frozenByName={
              wallet.statusChangedBy && wallet.statusChangedBy !== viewer.id
                ? findUser(state, wallet.statusChangedBy)?.displayName
                : undefined
            }
            href="/money"
          />
        </div>
      )}
      <FlowTransition step={step}>
        {step === "recipient" && (
          <PeerSearch
            question={mode === "send" ? "Who are you sending to?" : "Who are you asking?"}
            onSelect={(profile) => {
              setParty(profile);
              setStep("amount");
            }}
          />
        )}

        {step === "amount" && party && (
          <div>
            <StepHeading title={mode === "send" ? `Send to ${party.handle}` : `Request from ${party.handle}`} />
            <AmountInput
              label="Amount"
              value={digits}
              onChange={setDigits}
              error={digits === "" ? null : amountMessage}
              hint={
                mode === "send"
                  ? `Available ${formatINR(sendable)} · sandbox cap ${formatINR(MAX_SANDBOX_AMOUNT)}`
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
                  This needs parent approval. {approverName} will be asked before anything is sent.
                </span>
              </p>
            )}
            <Input
              className="mt-4"
              label="Note (optional)"
              placeholder={mode === "send" ? "What is it for?" : "What is this for?"}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={PEER_NOTE_MAX}
            />
            <div className="mt-5 flex gap-2.5">
              <Button variant="secondary" className="flex-1" onClick={() => setStep("recipient")}>
                Back
              </Button>
              <Button className="flex-1" disabled={amountMessage !== null} onClick={enterReview}>
                Continue
              </Button>
            </div>
          </div>
        )}

        {step === "review" && party && (
          <div>
            <StepHeading
              title={mode === "send" ? `Send ${formatINR(amount)}` : `Request ${formatINR(amount)}`}
            />
            <Card className="p-5">
              <dl className="space-y-4">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                    {mode === "send" ? "To" : "From"}
                  </dt>
                  <dd className="mt-2 flex items-center gap-3.5">
                    <Avatar name={party.name} initials={party.initials} size="md" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">{party.handle}</span>
                      <span className="block truncate text-xs text-ink-muted">{party.name}</span>
                    </span>
                  </dd>
                </div>
                <div className="border-t border-line pt-4">
                  <dt className="sr-only">Amount</dt>
                  <dd>
                    <AmountDisplay value={amount} size="lg" />
                    {note.trim() && <p className="mt-1 text-sm text-ink-muted">“{note.trim()}”</p>}
                  </dd>
                </div>
                <div>
                  <dt className="sr-only">{mode === "send" ? "Paid from" : "What happens"}</dt>
                  <dd className="text-sm text-ink-muted">
                    {mode === "send"
                      ? "From your available balance"
                      : `Nothing moves until ${party.handle} pays. Requests expire after ${PEER_REQUEST_TTL_DAYS} days.`}
                  </dd>
                </div>
              </dl>
              <div className="mt-4 flex flex-wrap gap-2">
                <Badge tone="warning">{mode === "send" ? "Sandbox transfer" : "Sandbox request"}</Badge>
                {needsApproval && <Badge tone="accent">Approval required</Badge>}
              </div>
              {needsApproval && (
                <p className="mt-3 text-sm text-ink-muted">
                  {approverName} will get a request — nothing moves until they approve.
                </p>
              )}
            </Card>
            {actionError && (
              <p role="alert" className="mt-3 px-1 text-sm text-danger">
                {actionError}
              </p>
            )}
            <div className="mt-5 flex gap-2.5">
              <Button variant="secondary" className="flex-1" onClick={() => setStep("amount")}>
                Back
              </Button>
              <Button className="flex-1" onClick={confirm}>
                {mode === "request"
                  ? "Send request"
                  : needsApproval
                    ? `Ask ${approverName} to approve`
                    : `Send ${formatINR(amount)}`}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && receipt && (
          <div className="flex flex-col items-center px-4 py-10 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent/12 text-accent">
              {receipt.kind === "approval" ? (
                <Hourglass className="h-7 w-7" aria-hidden />
              ) : (
                <Check className="h-7 w-7" aria-hidden />
              )}
            </span>
            <StepHeading
              className="mt-5 text-xl font-semibold tracking-tight text-ink outline-none"
              title={receipt.kind === "sent" ? "Money sent" : receipt.kind === "approval" ? "Waiting for approval" : "Request sent"}
            />
            <AmountDisplay value={receipt.amount} size="display" className="mt-2" />
            <p className="mt-1.5 text-sm text-ink-muted">
              {receipt.kind === "requested" ? `from ${receipt.party.handle}` : `to ${receipt.party.handle}`}
              {receipt.kind === "requested" && receipt.note ? ` · “${receipt.note}”` : ""}
            </p>
            {receipt.kind === "sent" && (
              <dl className="mt-4 space-y-1 text-xs text-ink-muted">
                <div>
                  <dt className="sr-only">Reference</dt>
                  <dd className="font-mono">{receipt.reference}</dd>
                </div>
                <div>
                  <dt className="sr-only">Time</dt>
                  <dd>{formatFullDateTime(receipt.at)}</dd>
                </div>
              </dl>
            )}
            {receipt.kind === "approval" && (
              <p className="mt-3 max-w-xs text-sm text-ink-muted">
                {receipt.guardianName} has been asked. Nothing has been sent yet — you&apos;ll get a
                notification when they decide.
              </p>
            )}
            {receipt.kind === "requested" && (
              <p className="mt-3 max-w-xs text-sm text-ink-muted">
                Nothing has moved. {receipt.party.handle} can pay or decline until{" "}
                {formatFullDateTime(receipt.expiresAt)}.
              </p>
            )}
            <div className="mt-8 flex w-full max-w-xs gap-2.5">
              <Button
                variant="secondary"
                className="flex-1"
                href={receipt.kind === "sent" ? "/activity" : receipt.kind === "approval" ? "/family" : "/requests"}
              >
                {receipt.kind === "sent" ? "View activity" : receipt.kind === "approval" ? "View family" : "View requests"}
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

/**
 * A step heading that takes focus when it mounts — after the step
 * transition has swapped the content in — so screen readers and
 * keyboard users land on the new step.
 */
function StepHeading({ title, className }: { title: string; className?: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <h2
      ref={ref}
      tabIndex={-1}
      className={className ?? "mb-4 text-[22px] font-semibold tracking-tight text-ink outline-none"}
    >
      {title}
    </h2>
  );
}
