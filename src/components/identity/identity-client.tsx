"use client";

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { formatUsername } from "@/domain";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { IdentityCard } from "./identity-card";

/**
 * TeenPay ID — the identity home. Your own ID up top (copy, share,
 * change), and below it the canonical lookup: one exact TeenPay ID in,
 * one safe identity surface out (`/id/<handle>`). No directory
 * browsing, no fuzzy people search — the same privacy contract as the
 * Friend Circle lookup and the QR scanner.
 */
export function IdentityClient() {
  const { actions, viewer } = useSandbox();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const inputId = useId();
  const hintId = useId();
  const statusId = useId();

  const lookup = () => {
    const result = actions.identitySearch(query);
    if (!result.ok) {
      setFeedback(result.error.message);
      return;
    }
    setFeedback(null);
    router.push(`/id/${result.value.profile.handle.slice(1)}`);
  };

  return (
    <>
      <PageHeader
        title="TeenPay ID"
        description="One simple identity for finding each other — and nothing more."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />

      <div className="space-y-6">
        <section aria-label="Your TeenPay ID">
          <IdentityCard
            name={viewer.name}
            initials={viewer.avatarInitials}
            handle={formatUsername(viewer)}
            showQrLink
          />
        </section>

        <section aria-label="Find someone">
          <Card className="p-5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (query.trim()) lookup();
              }}
            >
              <label htmlFor={inputId} className="block text-sm font-medium text-ink">
                Find someone
              </label>
              <p id={hintId} className="mt-1 text-xs text-ink-faint">
                Enter their exact TeenPay ID — for example @meera. You&apos;ll only ever see their
                public identity: name, handle and how you&apos;re connected.
              </p>
              <div className="mt-3 flex flex-col gap-2.5 sm:flex-row">
                <div className="flex h-11 flex-1 items-center gap-2.5 rounded-xl border border-line bg-surface-2 px-3.5 focus-within:border-line-strong">
                  <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  <input
                    id={inputId}
                    type="text"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="@teenpay-id"
                    aria-describedby={`${hintId} ${statusId}`}
                    value={query}
                    onChange={(event) => {
                      setQuery(event.target.value.slice(0, 40));
                      setFeedback(null);
                    }}
                    className="w-full min-w-0 break-all bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
                  />
                </div>
                <Button type="submit" variant="secondary" disabled={query.trim() === ""}>
                  Look up
                </Button>
              </div>
            </form>
            <p
              id={statusId}
              role="status"
              aria-live="polite"
              className={feedback ? "mt-3 text-sm text-danger" : "sr-only"}
            >
              {feedback ?? ""}
            </p>
          </Card>
        </section>
      </div>
    </>
  );
}
