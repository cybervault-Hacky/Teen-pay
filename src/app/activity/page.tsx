"use client";

import { ReceiptText, TrendingDown, TrendingUp } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Container } from "@/components/shell";
import {
  Amount,
  Badge,
  Card,
  Divider,
  EmptyState,
  Reveal,
  SegmentedControl,
  Sheet,
  Surface,
  TransactionRow,
  type SegmentOption,
} from "@/components/ui";
import {
  getTransactions,
  groupTransactionsByDay,
  sumByDirection,
} from "@/data/mock";
import { matchesActivityFilter, type ActivityFilter, type Transaction } from "@/domain";
import { formatDayLabel, formatINR, formatTime } from "@/lib/format";

const FILTERS: readonly SegmentOption<ActivityFilter>[] = [
  { value: "all", label: "All" },
  { value: "in", label: "In" },
  { value: "out", label: "Out" },
  { value: "pending", label: "Pending" },
];

/** Activity — filterable ledger of everything that happened. */
export default function ActivityPage() {
  const [filter, setFilter] = useState<ActivityFilter>("all");
  const [selected, setSelected] = useState<Transaction | null>(null);

  const all = useMemo(() => getTransactions(), []);
  const filtered = useMemo(
    () => all.filter((tx) => matchesActivityFilter(tx, filter)),
    [all, filter],
  );
  const groups = useMemo(
    () => groupTransactionsByDay(filtered, (iso) => formatDayLabel(iso)),
    [filtered],
  );
  const monthIn = sumByDirection(all, "in");
  const monthOut = sumByDirection(all, "out");

  return (
    <Container width="narrow">
      <div className="flex flex-col gap-6 pt-5 sm:pt-8">
        <Reveal>
          <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
            Activity
          </h1>
          <p className="mt-1 text-[15px] text-muted">Everything, in one place.</p>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="flex items-center justify-between gap-4 p-5">
            <span className="flex items-center gap-3">
              <span
                className="flex size-10 items-center justify-center rounded-xl bg-success-soft text-success"
                aria-hidden="true"
              >
                <TrendingUp className="size-5" />
              </span>
              <span>
                <span className="block text-xs text-faint">Money in</span>
                <Amount value={monthIn} size="md" tone="positive" />
              </span>
            </span>
            <span className="h-10 w-px bg-line" aria-hidden="true" />
            <span className="flex items-center gap-3">
              <span
                className="flex size-10 items-center justify-center rounded-xl bg-danger-soft text-danger"
                aria-hidden="true"
              >
                <TrendingDown className="size-5" />
              </span>
              <span>
                <span className="block text-xs text-faint">Money out</span>
                <Amount value={monthOut} size="md" />
              </span>
            </span>
          </Card>
        </Reveal>

        <Reveal>
          <SegmentedControl
            label="Filter activity"
            options={FILTERS}
            value={filter}
            onChange={setFilter}
          />
        </Reveal>

        {groups.length === 0 ? (
          <Card className="px-4 py-2">
            <EmptyState
              icon={ReceiptText}
              title={
                filter === "pending" ? "Nothing pending" : "Nothing here yet"
              }
              body={
                filter === "pending"
                  ? "Every transaction is settled. Nice."
                  : "Transactions matching this filter will show up here."
              }
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((group) => (
              <section key={group.key} aria-label={group.label}>
                <p className="mb-2 text-xs font-semibold tracking-[0.08em] text-faint uppercase">
                  {group.label}
                </p>
                <Card className="px-3 py-1.5">
                  {group.items.map((tx, index) => (
                    <Fragment key={tx.id}>
                      {index > 0 && <Divider className="mx-2" />}
                      <TransactionRow
                        transaction={tx}
                        onSelect={(t) => setSelected(t)}
                      />
                    </Fragment>
                  ))}
                </Card>
              </section>
            ))}
          </div>
        )}
      </div>

      <Sheet
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected?.title ?? ""}
        description={selected ? formatDayLabel(selected.occurredAt) : undefined}
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <Surface className="flex items-center justify-between !rounded-2xl p-4">
              <Amount
                value={selected.amountPaise}
                direction={selected.direction}
                signed
                size="lg"
              />
              <Badge tone={selected.status === "pending" ? "warning" : "success"} dot>
                {selected.status === "pending" ? "Pending" : "Settled"}
              </Badge>
            </Surface>
            <dl className="flex flex-col gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-faint">With</dt>
                <dd className="text-right font-medium text-ink">
                  {selected.counterparty.name}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-faint">Time</dt>
                <dd className="text-right font-medium text-ink">
                  {formatTime(selected.occurredAt)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-faint">Category</dt>
                <dd className="text-right font-medium text-ink capitalize">
                  {selected.category}
                </dd>
              </div>
              {selected.note && (
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-faint">Note</dt>
                  <dd className="text-right font-medium text-ink">{selected.note}</dd>
                </div>
              )}
              <div className="flex items-center justify-between gap-4">
                <dt className="text-faint">Amount</dt>
                <dd className="tnum text-right font-medium text-ink">
                  {formatINR(selected.amountPaise, { exact: true })}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Sheet>
    </Container>
  );
}
