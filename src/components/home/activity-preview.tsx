import { ReceiptText } from "lucide-react";
import type { LedgerEntry, Transaction } from "@/domain";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { TransactionRow } from "@/components/ui/transaction-row";
import { entryIcon } from "@/lib/transaction-icons";
import { formatDayLabel } from "@/lib/format";

export interface ActivityPreviewRow {
  entry: LedgerEntry;
  /** The display projection from the central transaction query. */
  transaction: Transaction;
}

interface ActivityPreviewProps {
  /** Latest rows (newest first), typically 3. */
  rows: ActivityPreviewRow[];
}

/** The last few transactions, as a quiet teaser for /activity. */
export function ActivityPreview({ rows }: ActivityPreviewProps) {
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No activity yet"
          description="Money in and out of this wallet will show up here."
          className="py-10"
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map(({ entry, transaction }) => (
            <TransactionRow
              key={entry.id}
              transaction={{ ...transaction, when: formatDayLabel(entry.createdAt) }}
              icon={entryIcon(entry)}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}
