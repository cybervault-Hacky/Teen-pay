"use client";

import { AtSign, Copy, Pencil, QrCode, Share2 } from "lucide-react";
import { useState } from "react";
import { useIdentityActions } from "./use-identity-actions";
import { ChangeIdModal } from "./change-id-modal";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * The viewer's own TeenPay ID, presented as identity — not a menu.
 * Copy and Share carry only the handle; Change opens the alias-change
 * flow. Everything about the account behind the ID stays private.
 */
export function IdentityCard({
  name,
  initials,
  handle,
  showQrLink = false,
}: {
  name: string;
  initials: string;
  handle: string;
  /** Adds the "My TeenPay QR" shortcut (used on the identity page). */
  showQrLink?: boolean;
}) {
  const { status, setStatus, shareSupport, copy, share } = useIdentityActions(handle);
  const [changeOpen, setChangeOpen] = useState(false);

  return (
    <Card className="p-5">
      <div className="flex items-center gap-4">
        <span
          aria-hidden
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-accent"
        >
          <AtSign className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            TeenPay ID
          </p>
          <p className="mt-0.5 truncate text-xl font-semibold tracking-tight text-ink">{handle}</p>
          <p className="mt-0.5 text-xs text-ink-muted">Your unique identity on TeenPay</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/60 px-3.5 py-2.5">
        <Avatar name={name} initials={initials} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink">{name}</p>
          <p className="truncate text-xs text-ink-faint">
            Carries no balance, history or family details — ever.
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <Button variant="secondary" onClick={copy}>
          <Copy className="h-4 w-4" aria-hidden />
          Copy ID
        </Button>
        <Button
          variant="secondary"
          onClick={share}
          disabled={shareSupport === "unavailable"}
          title={
            shareSupport === "unavailable"
              ? "Sharing isn't available in this browser — copy your ID instead."
              : undefined
          }
        >
          <Share2 className="h-4 w-4" aria-hidden />
          Share ID
        </Button>
      </div>
      <div className={showQrLink ? "mt-2.5 grid grid-cols-2 gap-2.5" : "mt-2.5"}>
        <Button variant="ghost" onClick={() => setChangeOpen(true)}>
          <Pencil className="h-4 w-4" aria-hidden />
          Change TeenPay ID
        </Button>
        {showQrLink && (
          <Button variant="ghost" href="/qr">
            <QrCode className="h-4 w-4" aria-hidden />
            My TeenPay QR
          </Button>
        )}
      </div>

      <p
        role="status"
        aria-live="polite"
        className={status ? "mt-3 text-sm text-ink-muted" : "sr-only"}
      >
        {status}
      </p>

      <ChangeIdModal
        open={changeOpen}
        currentHandle={handle}
        onClose={() => setChangeOpen(false)}
        onSaved={(newHandle) => setStatus(`You're now ${newHandle}.`)}
      />
    </Card>
  );
}
