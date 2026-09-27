"use client";

import { Info } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { Modal } from "@/components/ui/modal";

/**
 * The "What are money spaces?" affordance. Also the live demo of
 * the app's Modal/Sheet primitive (bottom sheet on phones,
 * centered dialog on larger screens).
 */
export function SpacesInfoButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <IconButton
        label="What are Money Spaces?"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
      >
        <Info className="h-4 w-4" aria-hidden />
      </IconButton>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Money Spaces"
      >
        <p className="text-sm leading-relaxed text-ink-muted">
          A Money Space sets part of your wallet aside for a purpose — Save,
          a goal like a new bike, or anything you name. Money in a space is
          still yours; it just isn&apos;t available to spend until you move
          it back.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-faint">
          Available + in spaces = your total. Every space balance is derived
          in real time from the sandbox ledger, and every move has its own
          reference. Pending requests are never counted as money.
        </p>
      </Modal>
    </>
  );
}
