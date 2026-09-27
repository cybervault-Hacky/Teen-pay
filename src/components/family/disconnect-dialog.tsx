"use client";

import { useState } from "react";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface DisconnectDialogProps {
  open: boolean;
  onClose: () => void;
  teenId: string;
  /** The other side's name, e.g. "Priya" or "Aarav". */
  otherName: string;
  perspective: "teen" | "guardian";
  onDisconnected?: () => void;
}

/**
 * Confirmation before disconnecting. Explains exactly what changes
 * — and what doesn't: money and history stay put.
 */
export function DisconnectDialog({
  open,
  onClose,
  teenId,
  otherName,
  perspective,
  onDisconnected,
}: DisconnectDialogProps) {
  const { actions } = useSandbox();
  const [error, setError] = useState<string | null>(null);

  const confirm = () => {
    const result = actions.disconnectFamily(teenId);
    if (result.ok) {
      setError(null);
      onClose();
      onDisconnected?.();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={perspective === "teen" ? "Disconnect parent?" : `Disconnect from ${otherName}?`}
    >
      <p className="text-sm leading-relaxed text-ink-muted">
        {perspective === "teen"
          ? `${otherName} will no longer be connected as your parent/guardian.`
          : `You'll no longer be connected as ${otherName}'s parent/guardian.`}
      </p>
      <ul className="mt-4 space-y-2.5 text-sm text-ink-muted">
        <li className="flex gap-2.5">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
          Family controls switch off — spending limits, approval rules and the
          pocket money schedule.
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
          Pending approval requests are cancelled. No money moves.
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
          The balance, Money Spaces and activity history stay exactly as they
          are.
        </li>
        <li className="flex gap-2.5">
          <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-ink-faint" />
          You can reconnect anytime with a new invite code.
        </li>
      </ul>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-6 flex gap-2.5">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Keep connected
        </Button>
        <Button variant="danger" className="flex-1" onClick={confirm}>
          Disconnect
        </Button>
      </div>
    </Modal>
  );
}
