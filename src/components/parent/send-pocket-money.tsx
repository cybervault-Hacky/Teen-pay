"use client";

import { Check, Send } from "lucide-react";
import { useRef, useState } from "react";
import { formatINR } from "@/lib/currency";
import { makeId } from "@/lib/ids";
import { amountError } from "@/sandbox/engine";
import { getBalance, selectViewerWallet } from "@/sandbox/selectors";
import { MAX_SANDBOX_AMOUNT } from "@/sandbox/types";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AmountInput } from "@/components/pay/amount-input";

/**
 * One-time pocket money: one atomic transfer from the guardian's
 * sandbox wallet to the teen's, through the same operation path as
 * every other money movement. One idempotency key per send intent,
 * so a double click, retry or stale re-submit sends once.
 */
export function SendPocketMoney({ teenName, paused = false }: { teenName: string; paused?: boolean }) {
  const { state, actions } = useSandbox();
  const [intentId, setIntentId] = useState(() => makeId("allow"));
  const ownWallet = selectViewerWallet(state);
  const ownBalance = ownWallet ? getBalance(state, ownWallet.id) : 0;
  const [digits, setDigits] = useState("");
  const [note, setNote] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<number | null>(null);

  // Synchronous guard: a fast double-click can never double-send.
  const sendingRef = useRef(false);

  const amount = digits ? Number(digits) : 0;
  const liveError =
    digits === ""
      ? "Enter an amount."
      : (amountError(amount)?.message ??
        (amount > ownBalance ? `Your sandbox wallet has ${formatINR(ownBalance)}.` : null));
  const canSend = liveError === null && !paused;

  const send = () => {
    if (!canSend || sendingRef.current) return;
    sendingRef.current = true;
    const result = actions.sendAllowance({
      amount,
      note: note.trim() || undefined,
      idempotencyId: intentId,
    });
    if (result.ok) {
      setLastSent(amount);
      setDigits("");
      setNote("");
    } else {
      setActionError(result.error.message);
      sendingRef.current = false;
    }
  };

  if (lastSent !== null) {
    return (
      <div className="flex flex-col items-start gap-3" role="status">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent/12 text-accent">
            <Check className="h-5 w-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-medium text-ink">
              {formatINR(lastSent)} sent to {teenName}
            </p>
            <p className="mt-0.5 text-xs text-ink-muted">
              {teenName}&apos;s available balance updated instantly.
            </p>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setLastSent(null);
            setActionError(null);
            setIntentId(makeId("allow"));
            sendingRef.current = false;
          }}
        >
          Send more
        </Button>
      </div>
    );
  }

  return (
    <div>
      <AmountInput
        label="Amount"
        value={digits}
        onChange={(next) => {
          setDigits(next);
          setActionError(null);
        }}
        error={actionError ?? liveError}
        hint={`From your sandbox wallet · ${formatINR(ownBalance)} available · cap ${formatINR(MAX_SANDBOX_AMOUNT)} per send`}
      />
      <Input
        className="mt-3.5"
        label="Note (optional)"
        placeholder="e.g. Pocket money for the week"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        maxLength={60}
      />
      <Button className="mt-4 w-full" disabled={!canSend} onClick={send}>
        <Send className="h-4 w-4" aria-hidden />
        {amount > 0 ? `Send ${formatINR(amount)}` : "Send pocket money"}
      </Button>
    </div>
  );
}
