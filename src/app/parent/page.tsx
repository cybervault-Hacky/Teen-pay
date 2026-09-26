"use client";

import Link from "next/link";
import { ChevronLeft, HandCoins } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { Container } from "@/components/shell";
import {
  Amount,
  Avatar,
  Button,
  Card,
  Divider,
  EmptyState,
  Notice,
  Reveal,
  SandboxBadge,
  SectionHeader,
  TransactionRow,
} from "@/components/ui";
import { AllowanceSheet } from "@/components/parent";
import { useSandbox } from "@/sandbox";
import { sumByDirection } from "@/domain";
import { formatINR } from "@/lib/format";

/** Parent view — sandbox preview of the family side. */
export default function ParentPage() {
  const { teen, parent, wallet, transactions, pendingRequests, fulfillRequest } = useSandbox();
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);

  const monthIn = sumByDirection(transactions, "in");
  const monthOut = sumByDirection(transactions, "out");
  const recent = transactions.slice(0, 5);

  const topCategories = useMemo(() => {
    const byCategory = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.direction !== "out" || tx.status === "failed") continue;
      byCategory.set(tx.category, (byCategory.get(tx.category) ?? 0) + tx.amountPaise);
    }
    return [...byCategory.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
  }, [transactions]);
  const topTotal = topCategories.reduce((sum, [, paise]) => sum + paise, 0);

  const handleFulfill = (requestId: string) => {
    setFulfillingId(requestId);
    fulfillRequest(requestId);
    setFulfillingId(null);
  };

  return (
    <Container width="narrow">
      <div className="flex flex-col gap-7 pt-5 sm:pt-8">
        <Reveal>
          <Link
            href="/profile"
            className="inline-flex items-center gap-1 rounded-lg text-sm font-medium text-muted transition-colors hover:text-ink"
          >
            <ChevronLeft className="size-4" aria-hidden="true" />
            Back to teen view
          </Link>
          <div className="mt-3 flex items-start justify-between gap-3">
            <div>
              <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
                For parents
              </h1>
              <p className="mt-1 text-[15px] text-muted">
                {parent.displayName} · watching over {teen.displayName.split(" ")[0]}
              </p>
            </div>
            <SandboxBadge />
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="p-5">
            <div className="flex items-center gap-4">
              <Avatar name={teen.displayName} size="lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold text-ink">
                  {teen.displayName}
                </p>
                <p className="mt-0.5 text-[13px] text-faint">Sandbox balance</p>
              </div>
              <Amount value={wallet.availablePaise} size="lg" />
            </div>
            <Button fullWidth onClick={() => setAllowanceOpen(true)} className="mt-4">
              Send pocket money
            </Button>
          </Card>
        </Reveal>

        {pendingRequests.length > 0 && (
          <Reveal>
            <section aria-labelledby="parent-requests">
              <SectionHeader
                title="Requests"
                caption={`${pendingRequests.length} waiting for you`}
              />
              <h2 id="parent-requests" className="sr-only">
                Pending requests
              </h2>
              <Card className="mt-3 px-4 py-1.5">
                {pendingRequests.map((request, index) => (
                  <Fragment key={request.id}>
                    {index > 0 && <Divider />}
                    <div className="flex items-center gap-3.5 py-3.5">
                      <span
                        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warning-soft text-warning"
                        aria-hidden="true"
                      >
                        <HandCoins className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-ink">
                          {request.targetName === parent.displayName
                            ? "Asked you directly"
                            : `Asked ${request.targetName}`}
                        </span>
                        <span className="mt-0.5 block truncate text-[13px] text-faint">
                          {request.note ?? "No note"}
                        </span>
                      </span>
                      <Amount value={request.amountPaise} size="md" />
                      <Button
                        size="sm"
                        loading={fulfillingId === request.id}
                        onClick={() => handleFulfill(request.id)}
                        aria-label={`Send ${formatINR(request.amountPaise)} for this request`}
                      >
                        Send
                      </Button>
                    </div>
                  </Fragment>
                ))}
              </Card>
            </section>
          </Reveal>
        )}

        <Reveal>
          <section aria-labelledby="parent-overview">
            <SectionHeader title="Spending overview" caption="From the sandbox ledger" />
            <h2 id="parent-overview" className="sr-only">
              Spending overview
            </h2>
            <Card className="mt-3 p-5">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs text-faint">Money in</p>
                  <Amount value={monthIn} size="md" tone="positive" />
                </div>
                <div className="text-right">
                  <p className="text-xs text-faint">Money out</p>
                  <Amount value={monthOut} size="md" />
                </div>
              </div>
              {topCategories.length > 0 && (
                <div className="mt-4 border-t border-line pt-4">
                  <p className="text-xs font-semibold tracking-[0.08em] text-faint uppercase">
                    Top spending
                  </p>
                  <ul className="mt-3 flex flex-col gap-3">
                    {topCategories.map(([category, paise]) => (
                      <li key={category}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="font-medium text-ink capitalize">{category}</span>
                          <Amount value={paise} size="sm" tone="muted" />
                        </div>
                        <span
                          className="mt-1.5 block h-1 overflow-hidden rounded-full bg-surface-3"
                          aria-hidden="true"
                        >
                          <span
                            className="block h-full rounded-full bg-accent/70"
                            style={{
                              width: `${topTotal > 0 ? Math.round((paise / topTotal) * 100) : 0}%`,
                            }}
                          />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </Card>
          </section>
        </Reveal>

        <Reveal>
          <section aria-labelledby="parent-recent">
            <SectionHeader title="Recent activity" action={{ label: "See all", href: "/activity" }} />
            <h2 id="parent-recent" className="sr-only">
              Recent activity
            </h2>
            <Card className="mt-3 px-3 py-1.5">
              {recent.length === 0 ? (
                <EmptyState
                  icon={HandCoins}
                  title="No activity yet"
                  body="Allowance and payments will show up here."
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
        </Reveal>

        <Reveal>
          <Notice tone="info" title="Sandbox preview">
            Allowance and requests simulate the family loop against the local
            ledger. Full approvals and spending plans arrive in later phases —
            no real money is involved.
          </Notice>
        </Reveal>
      </div>

      <AllowanceSheet open={allowanceOpen} onClose={() => setAllowanceOpen(false)} />
    </Container>
  );
}
