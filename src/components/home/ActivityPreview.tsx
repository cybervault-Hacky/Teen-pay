"use client";

import { Fragment } from "react";
import { ReceiptText } from "lucide-react";
import { useSandbox } from "@/sandbox";
import { Card, Divider, EmptyState, SectionHeader, TransactionRow } from "@/components/ui";

/** Latest transactions teaser linking to full Activity. */
export function ActivityPreview() {
  const { transactions } = useSandbox();
  const recent = transactions.slice(0, 4);
  return (
    <section aria-labelledby="recent-heading">
      <SectionHeader
        title="Recent activity"
        action={{ label: "See all", href: "/activity" }}
      />
      <Card className="mt-3 px-3 py-1.5" >
        <h2 id="recent-heading" className="sr-only">
          Recent activity
        </h2>
        {recent.length === 0 ? (
          <EmptyState
            icon={ReceiptText}
            title="No activity yet"
            body="Payments, requests and pocket money will show up here."
            compact
          />
        ) : (
          recent.map((tx, index) => (
            <Fragment key={tx.id}>
              {index > 0 && <Divider className="mx-2" />}
              <TransactionRow transaction={tx} />
            </Fragment>
          ))
        )}
      </Card>
    </section>
  );
}
