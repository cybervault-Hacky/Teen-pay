"use client";

import { useSearchParams } from "next/navigation";
import { Search, Store, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";
import { Container } from "@/components/shell";
import {
  Avatar,
  Badge,
  Card,
  ComingSoonSheet,
  Divider,
  EmptyState,
  Input,
  Notice,
  Reveal,
  SectionHeader,
  SegmentedControl,
  type SegmentOption,
} from "@/components/ui";
import { PayFlowSheet, RequestFlowSheet } from "@/components/pay";
import { useSandbox } from "@/sandbox";
import type { Merchant, TrustedRecipient } from "@/domain";
import { formatINR } from "@/lib/format";

type PayMode = "send" | "request";

const MODES: readonly SegmentOption<PayMode>[] = [
  { value: "send", label: "Send" },
  { value: "request", label: "Request" },
];

/** Pay content — mode-aware recipient picker driving the send/request flows. */
export function PayContent() {
  const searchParams = useSearchParams();
  const { recipients, merchants } = useSandbox();
  const [mode, setMode] = useState<PayMode>(
    searchParams.get("mode") === "request" ? "request" : "send",
  );
  const [query, setQuery] = useState("");
  const [payTarget, setPayTarget] = useState<TrustedRecipient | null>(null);
  const [requestTarget, setRequestTarget] = useState<TrustedRecipient | null>(null);
  const [merchant, setMerchant] = useState<Merchant | null>(null);

  const q = query.trim().toLowerCase();
  const people = useMemo(
    () =>
      recipients.filter(
        (r) =>
          !q ||
          r.name.toLowerCase().includes(q) ||
          r.relationship.toLowerCase().includes(q) ||
          r.handle.toLowerCase().includes(q),
      ),
    [recipients, q],
  );
  const places = useMemo(
    () =>
      merchants.filter(
        (m) =>
          !q ||
          m.name.toLowerCase().includes(q) ||
          m.category.toLowerCase().includes(q),
      ),
    [merchants, q],
  );
  const hasResults = people.length > 0 || places.length > 0;

  const handlePerson = (recipient: TrustedRecipient) => {
    if (mode === "send") setPayTarget(recipient);
    else setRequestTarget(recipient);
  };

  return (
    <Container width="narrow">
      <div className="flex flex-col gap-6 pt-5 sm:pt-8">
        <Reveal>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
            {mode === "send" ? "Pay" : "Request"}
          </h1>
          <p className="mt-1 text-[15px] text-muted">
            {mode === "send"
              ? "Send to people and places you trust."
              : "Ask a parent or friend for money."}
          </p>
        </Reveal>

        <Reveal delay={0.05}>
          <SegmentedControl
            label="Send or request"
            options={MODES}
            value={mode}
            onChange={setMode}
          />
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
            {people.length > 0 && (
              <Reveal>
                <section aria-labelledby="pay-people">
                  <SectionHeader title="People" caption="Approved by your parent" />
                  <Card className="mt-3 px-3 py-1.5">
                    <h2 id="pay-people" className="sr-only">
                      People
                    </h2>
                    {people.map((recipient, index) => (
                      <div key={recipient.id}>
                        {index > 0 && <Divider className="mx-2" />}
                        <button
                          type="button"
                          onClick={() => handlePerson(recipient)}
                          className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3"
                        >
                          <Avatar name={recipient.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-ink">
                              {recipient.name}
                            </span>
                            <span className="mt-0.5 block text-[13px] text-faint">
                              {recipient.relationship} · {recipient.handle}
                              {recipient.lastAmountPaise !== undefined &&
                                ` · Last ${formatINR(recipient.lastAmountPaise)}`}
                            </span>
                          </span>
                          {!recipient.parentApproved ? (
                            <Badge tone="warning">Approval needed</Badge>
                          ) : (
                            <UsersRound className="size-[18px] shrink-0 text-faint" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    ))}
                  </Card>
                </section>
              </Reveal>
            )}

            {places.length > 0 && mode === "send" && (
              <Reveal>
                <section aria-labelledby="pay-places">
                  <SectionHeader title="Places" caption="Everyday merchants" />
                  <Card className="mt-3 px-3 py-1.5">
                    <h2 id="pay-places" className="sr-only">
                      Places
                    </h2>
                    {places.map((place, index) => (
                      <div key={place.id}>
                        {index > 0 && <Divider className="mx-2" />}
                        <button
                          type="button"
                          onClick={() => setMerchant(place)}
                          className="flex w-full cursor-pointer items-center gap-3.5 rounded-xl px-2 py-3 text-left transition-colors duration-150 hover:bg-surface-2 active:bg-surface-3"
                        >
                          <Avatar name={place.name} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium text-ink">
                              {place.name}
                            </span>
                            <span className="mt-0.5 block text-[13px] text-faint">
                              {place.category}
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
            Teens can only pay parent-approved people and vetted places. Every
            flow here runs against the local sandbox ledger — nothing is real money.
          </Notice>
        </Reveal>
      </div>

      <PayFlowSheet recipient={payTarget} onClose={() => setPayTarget(null)} />
      <RequestFlowSheet recipient={requestTarget} onClose={() => setRequestTarget(null)} />
      <ComingSoonSheet
        open={merchant !== null}
        onClose={() => setMerchant(null)}
        feature={merchant ? `Pay ${merchant.name}` : "Pay"}
        body="Merchant payments arrive in a later phase — people payments work today."
      />
    </Container>
  );
}
