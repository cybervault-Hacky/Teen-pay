"use client";

import { Copy, ScanLine, Share2, ShieldCheck } from "lucide-react";
import { useSandbox } from "@/sandbox/store";
import { useIdentityActions } from "@/components/identity/use-identity-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { QrCode } from "./qr-code";

/**
 * "My TeenPay QR": the viewer's public identity as a scannable code.
 *
 * Shows only what anyone scanning it would learn — name and TeenPay
 * ID. No balance, account, wallet or family detail is on screen or in
 * the code. Copy and Share come from the shared identity actions
 * (`useIdentityActions`) — the same safe behaviour as the profile's
 * identity card.
 */
export function MyQr() {
  const { qr } = useSandbox();
  const { status, shareSupport, copy, share } = useIdentityActions(qr?.profile.handle ?? "");

  if (!qr) {
    return (
      <>
        <PageHeader title="My TeenPay QR" actions={<Badge tone="warning">Sandbox</Badge>} />
        <Card>
          <EmptyState
            className="py-10"
            icon={ShieldCheck}
            title="No TeenPay QR for this account"
            description="Only active TeenPay teen accounts can receive money, so only they have a QR."
          />
        </Card>
      </>
    );
  }

  const { profile, payload } = qr;

  return (
    <>
      <PageHeader
        title="My TeenPay QR"
        description="Let another TeenPay teen scan this to pay or request from you."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />

      <div className="mx-auto max-w-sm">
        <Card className="flex flex-col items-center p-6 text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">Scan to pay me</p>
          <div className="mt-4 w-full max-w-[248px] rounded-3xl border border-line p-2.5">
            <QrCode
              payload={payload}
              label={`TeenPay QR code for ${profile.handle}. Scanning it shows ${profile.name}'s TeenPay ID only.`}
            />
          </div>
          <div className="mt-5 flex items-center gap-3">
            <Avatar name={profile.name} initials={profile.initials} size="md" />
            <div className="min-w-0 text-left">
              <p className="truncate text-base font-semibold text-ink">{profile.name}</p>
              <p className="truncate text-sm text-ink-muted">{profile.handle}</p>
            </div>
          </div>
          <p className="mt-4 text-xs leading-relaxed text-ink-faint">
            This code only carries your TeenPay ID — no balance, account or family details. Scanning
            it never moves money: the other person still enters an amount and confirms.
          </p>
        </Card>

        <div className="mt-4 grid grid-cols-2 gap-2.5">
          <Button variant="secondary" onClick={copy}>
            <Copy className="h-4 w-4" aria-hidden />
            Copy TeenPay ID
          </Button>
          {shareSupport === "available" ? (
            <Button variant="secondary" onClick={share}>
              <Share2 className="h-4 w-4" aria-hidden />
              Share
            </Button>
          ) : (
            <Button variant="secondary" href="/qr/scan">
              <ScanLine className="h-4 w-4" aria-hidden />
              Scan a code
            </Button>
          )}
        </div>
        {shareSupport === "unavailable" && (
          <p className="mt-2.5 px-1 text-xs text-ink-faint">
            Sharing isn&apos;t available in this browser — copy your TeenPay ID or show this screen.
          </p>
        )}
        {shareSupport === "available" && (
          <Button variant="ghost" size="sm" href="/qr/scan" className="mt-2 w-full">
            <ScanLine className="h-4 w-4" aria-hidden />
            Scan a code
          </Button>
        )}
        <p role="status" aria-live="polite" className={status ? "mt-3 px-1 text-sm text-ink-muted" : "sr-only"}>
          {status}
        </p>
      </div>
    </>
  );
}
