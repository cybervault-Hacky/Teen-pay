"use client";

import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { PeerFlow, type PeerMode } from "./peer-flow";

const COPY: Record<PeerMode, { title: string; description: string }> = {
  send: { title: "Send money", description: "To another TeenPay teen, from your available balance." },
  request: { title: "Request money", description: "Ask another TeenPay teen. Nothing moves until they pay." },
};

/** The /send and /request screens. */
export function PeerClient({ mode }: { mode: PeerMode }) {
  return (
    <>
      <PageHeader
        title={COPY[mode].title}
        description={COPY[mode].description}
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      <PeerFlow mode={mode} />
    </>
  );
}
