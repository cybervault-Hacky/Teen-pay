"use client";

import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { PeerFlow, type PeerMode, type PeerOrigin } from "./peer-flow";

const COPY: Record<PeerMode, { title: string; description: string }> = {
  send: { title: "Send money", description: "To another TeenPay teen, from your available balance." },
  request: { title: "Request money", description: "Ask another TeenPay teen. Nothing moves until they pay." },
};

/**
 * The /send and /request screens.
 *
 * Phase 9: `?to=meera&via=qr|favourite` preselects a recipient (from a
 * scanned QR or a favourite); Phase 12 adds `via=friend` (from the
 * Friend Circle). `to` is only a TeenPay ID — PeerFlow resolves it
 * through the live directory, and the engine re-checks at confirm —
 * so a hand-edited link can't do more than typing that ID into
 * search. `via` changes a caption, nothing else.
 */
export function PeerClient({ mode }: { mode: PeerMode }) {
  const params = useSearchParams();
  const to = params?.get("to")?.slice(0, 40) ?? null;
  const via = params?.get("via");
  const origin: PeerOrigin | null =
    via === "qr" || via === "favourite" || via === "friend" ? via : null;
  return (
    <>
      <PageHeader
        title={COPY[mode].title}
        description={COPY[mode].description}
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      {/* A new preselection starts a fresh flow (and a fresh idempotency key). */}
      <PeerFlow key={`${to ?? ""}|${origin ?? ""}`} mode={mode} initialRecipient={to} origin={origin} />
    </>
  );
}
