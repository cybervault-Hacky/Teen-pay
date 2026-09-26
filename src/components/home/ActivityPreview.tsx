import { Fragment } from "react";
import { getRecentTransactions } from "@/data/mock";
import { Card, Divider, SectionHeader, TransactionRow } from "@/components/ui";

/** Latest transactions teaser linking to full Activity. */
export function ActivityPreview() {
  const recent = getRecentTransactions(4);
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
        {recent.map((tx, index) => (
          <Fragment key={tx.id}>
            {index > 0 && <Divider className="mx-2" />}
            <TransactionRow transaction={tx} />
          </Fragment>
        ))}
      </Card>
    </section>
  );
}
