"use client";

import { useEffect, useRef, useState } from "react";
import { formatINR } from "@/lib/currency";
import { makeId } from "@/lib/ids";
import { amountError } from "@/sandbox/engine";
import type { SpaceView } from "@/sandbox/selectors";
import type { SandboxResult } from "@/sandbox/types";
import type { SpaceMoveResult } from "@/sandbox/space-transitions";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { AmountInput } from "@/components/pay/amount-input";

export type MoveDirection = "add" | "withdraw";

interface SpaceMoveSheetProps {
  /** The Space to move money for; null keeps the sheet closed. */
  space: SpaceView | null;
  direction: MoveDirection;
  /** Derived available balance of the wallet. */
  available: number;
  onClose: () => void;
  /** Called once money moved, with a human summary for a live region. */
  onDone?: (summary: string) => void;
}

/**
 * Add money to a Space (from available) or move it back. The limits
 * shown are the domain's (available balance, Space balance, a goal's
 * remaining amount); the store re-checks everything anyway.
 *
 * Idempotency: one key per opening of the sheet, so a double click,
 * a retry after a slow response, or a stale re-submit moves money
 * once. A failed attempt recorded nothing, so a corrected amount
 * gets a fresh key.
 */
export function SpaceMoveSheet({ space, direction, available, onClose, onDone }: SpaceMoveSheetProps) {
  const { actions } = useSandbox();
  const open = space !== null;
  const [digits, setDigits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [intentId, setIntentId] = useState(() => makeId("spcop"));
  const confirming = useRef(false);
  // Keep the last Space while the sheet animates out.
  const shown = useRef<SpaceView | null>(space);
  if (space) shown.current = space;
  const current = shown.current;

  useEffect(() => {
    if (open) {
      setDigits("");
      setError(null);
      setIntentId(makeId("spcop"));
      confirming.current = false;
    }
  }, [open, direction]);

  if (!current) return null;
  const add = direction === "add";
  const goalRoom =
    current.type === "goal" && current.progress.remaining !== undefined
      ? current.progress.remaining
      : null;
  const max = add ? (goalRoom === null ? available : Math.min(available, goalRoom)) : current.balance;

  const amount = digits ? Number(digits) : 0;
  const limitMessage = add
    ? goalRoom !== null && amount > goalRoom
      ? goalRoom === 0
        ? `${current.name} has already reached its target.`
        : `${current.name} needs ${formatINR(goalRoom)} more to reach its target.`
      : amount > available
        ? `You have ${formatINR(available)} available.`
        : null
    : amount > current.balance
      ? `${current.name} has ${formatINR(current.balance)}.`
      : null;
  const liveError =
    digits === "" ? null : (amountError(amount)?.message ?? null) || limitMessage;
  const canConfirm = digits !== "" && liveError === null;

  const confirm = () => {
    if (!canConfirm || confirming.current) return;
    confirming.current = true;
    const result: SandboxResult<SpaceMoveResult> = add
      ? actions.addToSpace(current.id, amount, intentId)
      : actions.withdrawFromSpace(current.id, amount, intentId);
    if (result.ok) {
      onDone?.(
        add
          ? `Added ${formatINR(amount)} to ${current.name}.${result.value.reference ? ` Reference ${result.value.reference}.` : ""}`
          : `Moved ${formatINR(amount)} from ${current.name} back to available.${result.value.reference ? ` Reference ${result.value.reference}.` : ""}`,
      );
      onClose();
    } else {
      setError(result.error.message);
      setIntentId(makeId("spcop"));
      confirming.current = false;
    }
  };

  const afterAvailable = add ? available - amount : available + amount;
  const afterSpace = add ? current.balance + amount : current.balance - amount;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={add ? `Add to ${current.name}` : `Move back from ${current.name}`}
    >
      <p className="-mt-2 mb-4 text-sm text-ink-muted">
        {add
          ? `Moves money from your available balance into ${current.name}. It stays yours — just set aside.`
          : `Moves money from ${current.name} back to your available balance.`}
      </p>
      <AmountInput
        label="Amount"
        value={digits}
        onChange={(next) => {
          setDigits(next);
          setError(null);
        }}
        error={error ?? liveError}
        hint={
          add
            ? `Up to ${formatINR(Math.max(0, max))}${goalRoom !== null && goalRoom < available ? " (what the goal still needs)" : " available"}`
            : `Up to ${formatINR(current.balance)} in ${current.name}`
        }
      />
      {max > 0 && (
        <button
          type="button"
          onClick={() => {
            setDigits(String(max));
            setError(null);
          }}
          className="mt-2 text-xs font-medium text-accent hover:underline"
        >
          Use {formatINR(max)}
        </button>
      )}

      {canConfirm && (
        <dl className="mt-4 grid grid-cols-2 gap-3 rounded-xl border border-line bg-surface-2/60 p-3.5 text-sm">
          <div>
            <dt className="text-xs text-ink-faint">Available after</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ink">{formatINR(afterAvailable)}</dd>
          </div>
          <div>
            <dt className="text-xs text-ink-faint">{current.name} after</dt>
            <dd className="mt-0.5 font-semibold tabular-nums text-ink">{formatINR(afterSpace)}</dd>
          </div>
        </dl>
      )}

      <div className="mt-5 flex gap-2.5">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button className="flex-1" disabled={!canConfirm} onClick={confirm}>
          Confirm
        </Button>
      </div>
    </Modal>
  );
}
