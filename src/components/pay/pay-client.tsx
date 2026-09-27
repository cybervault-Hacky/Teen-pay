"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/lib/cn";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/layout/page-header";
import { PayFlow } from "./pay-flow";

type PayMode = "send" | "request";

const modes: { id: PayMode; label: string }[] = [
  { id: "send", label: "Send" },
  { id: "request", label: "Request" },
];

/**
 * The Pay screen: a send/request toggle and the live flow.
 * `?mode=request` (used by Home's quick action) opens the
 * request variant.
 */
export function PayClient() {
  const searchParams = useSearchParams();
  const [mode, setMode] = useState<PayMode>(
    searchParams.get("mode") === "request" ? "request" : "send",
  );

  return (
    <>
      <PageHeader
        title="Pay"
        description="Send or request in the sandbox — nothing is real."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />

      <div
        role="group"
        aria-label="Pay mode"
        className="mb-6 flex w-full max-w-[240px] gap-1 rounded-full border border-line bg-surface p-1"
      >
        {modes.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={mode === option.id}
            onClick={() => setMode(option.id)}
            className={cn(
              "flex-1 rounded-full px-4 py-1.5 text-sm font-medium",
              "transition-colors duration-150",
              mode === option.id
                ? "bg-surface-2 text-ink"
                : "text-ink-muted hover:text-ink",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <PayFlow key={mode} mode={mode} />
    </>
  );
}
