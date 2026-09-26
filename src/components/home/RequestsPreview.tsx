"use client";

import Link from "next/link";
import { ArrowDownLeft } from "lucide-react";
import { useSandbox } from "@/sandbox";
import { Amount, Card, SectionHeader } from "@/components/ui";

/** Pending money requests at a glance — hidden when there are none. */
export function RequestsPreview() {
  const { pendingRequests } = useSandbox();
  if (pendingRequests.length === 0) return null;

  return (
    <section aria-label="Pending requests">
      <SectionHeader
        title="Pending requests"
        caption={`${pendingRequests.length} waiting`}
        action={{ label: "Activity", href: "/activity" }}
      />
      <div className="mt-3 flex flex-col gap-2">
        {pendingRequests.slice(0, 3).map((request) => (
          <Link key={request.id} href="/activity" className="block">
            <Card className="flex items-center gap-3.5 p-4 transition-colors duration-150 hover:border-line-strong">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning"
                aria-hidden="true"
              >
                <ArrowDownLeft className="size-5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] font-medium text-ink">
                  {request.targetName}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-faint">
                  {request.note ?? "Waiting for a response"}
                </span>
              </span>
              <Amount value={request.amountPaise} direction="in" signed />
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}
