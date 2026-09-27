"use client";

import { useEffect, useRef, useState } from "react";
import { formatINR } from "@/lib/currency";
import { makeId } from "@/lib/ids";
import type { SpaceView } from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

interface ArchiveSpaceSheetProps {
  space: SpaceView | null;
  frozen: boolean;
  onClose: () => void;
  onDone?: (summary: string) => void;
}

/**
 * Archiving never deletes or hides money: any balance moves back to
 * available first (one referenced, idempotent move), then the Space
 * is archived. Its history stays in Activity and on its page.
 */
export function ArchiveSpaceSheet({ space, frozen, onClose, onDone }: ArchiveSpaceSheetProps) {
  const { actions } = useSandbox();
  const open = space !== null;
  const [error, setError] = useState<string | null>(null);
  const [intentId, setIntentId] = useState(() => makeId("spcop"));
  const busy = useRef(false);
  const shown = useRef<SpaceView | null>(space);
  if (space) shown.current = space;
  const current = shown.current;

  useEffect(() => {
    if (open) {
      setError(null);
      setIntentId(makeId("spcop"));
      busy.current = false;
    }
  }, [open]);

  if (!current) return null;
  const blocked = frozen && current.balance > 0;

  const confirm = () => {
    if (busy.current || blocked) return;
    busy.current = true;
    const result = actions.archiveSpace(current.id, intentId);
    busy.current = false;
    if (result.ok) {
      onDone?.(
        result.value.returned > 0
          ? `${current.name} was archived. ${formatINR(result.value.returned)} moved back to available.`
          : `${current.name} was archived.`,
      );
      onClose();
    } else {
      setError(result.error.message);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Archive ${current.name}?`}>
      <div className="space-y-3 text-sm leading-relaxed text-ink-muted">
        {current.balance > 0 ? (
          <p>
            {formatINR(current.balance)} in {current.name} will move back to your available
            balance first. Nothing is lost.
          </p>
        ) : (
          <p>{current.name} is empty, so no money moves.</p>
        )}
        <p>Its history stays on its page and in Activity. Archived spaces can&apos;t take money.</p>
        {blocked && (
          <p className="text-ink">
            Your wallet is frozen, so the money in this space can&apos;t move back right now.
            Unfreeze it first.
          </p>
        )}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex gap-2.5">
        <Button variant="secondary" className="flex-1" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" className="flex-1" disabled={blocked} onClick={confirm}>
          Archive
        </Button>
      </div>
    </Modal>
  );
}
