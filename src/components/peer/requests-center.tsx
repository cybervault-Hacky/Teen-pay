"use client";

import { ArrowDownLeft, ArrowUpRight, History, Inbox } from "lucide-react";
import { useEffect, useState } from "react";
import {
  selectIncomingRequests,
  selectOutgoingRequests,
  selectRequestHistory,
  type PeerRequestView,
} from "@/sandbox/selectors";
import { useSandbox } from "@/sandbox/store";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { PeerRequestCard, type RequestOutcomeMessage } from "./peer-request-card";

/**
 * The Requests center: requests to pay (Incoming), requests you sent
 * (Sent), and everything settled (History). Views come from the
 * request selectors — only requests the viewer is a party to, with the
 * other side as a display-safe @handle. Requests are not ledger
 * transactions: nothing here moves money except "Pay", which runs the
 * one transfer path.
 */
export function RequestsCenter() {
  const { state, actions } = useSandbox();
  const [message, setMessage] = useState<RequestOutcomeMessage | null>(null);
  const now = new Date().toISOString();
  const incoming = selectIncomingRequests(state, now);
  const outgoing = selectOutgoingRequests(state, now);
  const history = selectRequestHistory(state, now);

  // Expiry is computed from timestamps (no timer); the center writes
  // it down for any request past its 7 days whenever requests change
  // (including once stored data has loaded). Moves no money; a no-op
  // when nothing is due.
  const peerRequests = state.peerRequests;
  useEffect(() => {
    actions.expireMoneyRequests();
  }, [actions, peerRequests]);

  return (
    <>
      <PageHeader
        title="Requests"
        description="Money you've been asked for, and money you've asked for."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      <div className="mb-6 flex gap-2.5">
        <Button variant="secondary" size="sm" href="/request">
          <ArrowDownLeft className="h-4 w-4" aria-hidden />
          New request
        </Button>
        <Button variant="secondary" size="sm" href="/send">
          <ArrowUpRight className="h-4 w-4" aria-hidden />
          Send money
        </Button>
      </div>

      {message && (
        <p
          role={message.tone === "error" ? "alert" : "status"}
          className={`mb-5 rounded-xl bg-surface-2 px-3.5 py-2.5 text-sm ${
            message.tone === "error" ? "text-danger" : "text-success"
          }`}
        >
          {message.text}
        </p>
      )}

      <RequestSection
        label="Incoming"
        items={incoming}
        empty={{ icon: Inbox, title: "No one has asked you for money", description: "Requests to pay you show up here." }}
        onOutcome={setMessage}
      />
      <RequestSection
        label="Sent"
        items={outgoing}
        empty={{ icon: ArrowDownLeft, title: "No open requests", description: "Ask a friend on TeenPay for money you're owed." }}
        onOutcome={setMessage}
      />
      <RequestSection
        label="History"
        items={history}
        empty={{ icon: History, title: "Nothing settled yet", description: "Paid, declined, cancelled and expired requests live here." }}
        onOutcome={setMessage}
      />
    </>
  );
}

function RequestSection({
  label,
  items,
  empty,
  onOutcome,
}: {
  label: string;
  items: PeerRequestView[];
  empty: { icon: typeof Inbox; title: string; description: string };
  onOutcome: (message: RequestOutcomeMessage) => void;
}) {
  return (
    <section aria-label={label} className="mb-8">
      <SectionHeader title={`${label}${items.length ? ` · ${items.length}` : ""}`} />
      {items.length === 0 ? (
        <Card>
          <EmptyState icon={empty.icon} title={empty.title} description={empty.description} className="py-10" />
        </Card>
      ) : (
        <ul className="space-y-3">
          {items.map((request) => (
            <li key={request.requestId}>
              <PeerRequestCard request={request} onOutcome={onOutcome} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
