"use client";

import { Search, Store, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Container } from "@/components/shell";
import {
  Avatar,
  Card,
  ComingSoonSheet,
  Divider,
  EmptyState,
  Input,
  Notice,
  Reveal,
  SectionHeader,
} from "@/components/ui";
import { mockMerchants, mockRecipients } from "@/data/mock";
import type { PayDestination } from "@/domain";
import { formatINR } from "@/lib/format";

/** Pay — trusted destinations only. Real rails arrive in Phase 2. */
export default function PayPage() {
  const [query, setQuery] = useState("");
  const [destination, setDestination] = useState<PayDestination | null>(null);

  const q = query.trim().toLowerCase();
  const recipients = useMemo(
    () =>
      mockRecipients.filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.relationship.toLowerCase().includes(q),
      ),
    [q],
  );
  const merchants = useMemo(
    () =>
      mockMerchants.filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q),
      ),
    [q],
  );
  const hasResults = recipients.length > 0 || merchants.length > 0;

  return (
    <Container width="narrow">
      <div className="flex flex-col gap-6 pt-5 sm:pt-8">
        <Reveal>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
            Pay
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            Send to people and places you trust.
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <Input
            label="Search people or places"
            placeholder="Name, relationship, or shop…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            startIcon={Search}
            autoComplete="off"
          />
        </Reveal>

        {!hasResults ? (
          <Card className="px-4 py-2">
            <EmptyState
              icon={Search}
              title="No matches"
              body={`Nobody matches “${query.trim()}”. Try another name.`}
            />
          </Card>
        ) : (
          <>
            {recipients.length > 0 && (
              <Reveal>
                <section aria-labelledby="pay-people">
                  <SectionHeader title="People" caption="Approved by your parent" />
                  <Card className="mt-3 px-3 py-1.5">
                    <h2 id="pay-people" className="sr-only">
                      People
                    </h2>
                    {recipients.map((recipient, index) => (
                      <div key={recipient.id}>
                        {index > 0 && <Divider className="mx-2" />}
                        <button
                          type="button"
                          onClick={() =>
                            setDestination({ kind: "recipient", recipient })
                          }
                          className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3"
                        >
                          <Avatar name={recipient.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-ink">
                              {recipient.name}
                            </span>
                            <span className="mt-0.5 block text-[13px] text-faint">
                              {recipient.relationship}
                              {recipient.lastAmountPaise !== undefined &&
                                ` · Last ${formatINR(recipient.lastAmountPaise)}`}
                            </span>
                          </span>
                          <UsersRound className="size-[18px] shrink-0 text-faint" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </Card>
                </section>
              </Reveal>
            )}

            {merchants.length > 0 && (
              <Reveal>
                <section aria-labelledby="pay-places">
                  <SectionHeader title="Places" caption="Everyday merchants" />
                  <Card className="mt-3 px-3 py-1.5">
                    <h2 id="pay-places" className="sr-only">
                      Places
                    </h2>
                    {merchants.map((merchant, index) => (
                      <div key={merchant.id}>
                        {index > 0 && <Divider className="mx-2" />}
                        <button
                          type="button"
                          onClick={() => setDestination({ kind: "merchant", merchant })}
                          className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3"
                        >
                          <Avatar name={merchant.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-ink">
                              {merchant.name}
                            </span>
                            <span className="mt-0.5 block text-[13px] text-faint">
                              {merchant.category}
                            </span>
                          </span>
                          <Store className="size-[18px] shrink-0 text-faint" aria-hidden="true" />
                        </button>
                      </div>
                    ))}
                  </Card>
                </section>
              </Reveal>
            )}
          </>
        )}

        <Reveal>
          <Notice tone="info" title="Built-in guardrails">
            Teens can only pay parent-approved people and vetted places. Real
            payments go live in the next phase — nothing moves money today.
          </Notice>
        </Reveal>
      </div>

      <ComingSoonSheet
        open={destination !== null}
        onClose={() => setDestination(null)}
        feature={
          destination?.kind === "recipient"
            ? `Pay ${destination.recipient.name}`
            : destination?.kind === "merchant"
              ? `Pay ${destination.merchant.name}`
              : "Pay"
        }
        body="Choose an amount, add a note, and send — coming in Phase 2."
      />
    </Container>
  );
}
