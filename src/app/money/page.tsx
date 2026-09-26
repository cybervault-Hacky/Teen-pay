"use client";

import { ArrowLeftRight, Plus, Target } from "lucide-react";
import { useState } from "react";
import { Container } from "@/components/shell";
import {
  Amount,
  Badge,
  Button,
  Card,
  ComingSoonSheet,
  ProgressBar,
  Reveal,
  SectionHeader,
} from "@/components/ui";
import { SpaceCard } from "@/components/money";
import { isSampleData, mockGoals, mockWallet } from "@/data/mock";
import { goalProgress, type MoneySpace } from "@/domain";
import { formatPercent } from "@/lib/format";

/** Money — spaces, goals and the shape of the balance. */
export default function MoneyPage() {
  const [sheet, setSheet] = useState<{ feature: string; body: string } | null>(null);

  const upcomingSpace: MoneySpace = {
    type: "upcoming",
    label: "Upcoming",
    description: "Allowance and gifts on their way to you.",
    balancePaise: mockWallet.upcomingPaise,
    currency: mockWallet.currency,
  };

  return (
    <Container>
      <div className="flex flex-col gap-7 pt-5 sm:pt-8">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-[28px] font-bold tracking-tight text-ink">
                Money
              </h1>
              <p className="mt-1 text-[15px] text-muted">
                Every rupee has a job.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                icon={<ArrowLeftRight className="size-4" aria-hidden="true" />}
                onClick={() =>
                  setSheet({
                    feature: "Move money",
                    body: "Shift money between Spaces in seconds.",
                  })
                }
              >
                Move
              </Button>
              <Button
                size="sm"
                icon={<Plus className="size-4" aria-hidden="true" />}
                onClick={() =>
                  setSheet({
                    feature: "New goal",
                    body: "Name it, set a target, and start saving.",
                  })
                }
              >
                New goal
              </Button>
            </div>
          </div>
        </Reveal>

        <Reveal delay={0.05}>
          <Card className="flex items-center justify-between gap-4 p-5">
            <div>
              <p className="text-xs font-semibold tracking-[0.08em] text-faint uppercase">
                Available across Spaces
              </p>
              <Amount value={mockWallet.availablePaise} size="lg" className="mt-1.5 block" />
            </div>
            <div className="flex flex-col items-end gap-2">
              <Amount value={mockWallet.upcomingPaise} size="sm" tone="muted" />
              <span className="text-xs text-faint">expected soon</span>
              {isSampleData() && <Badge tone="neutral">Sample data</Badge>}
            </div>
          </Card>
        </Reveal>

        <Reveal>
          <section aria-labelledby="spaces-all">
            <SectionHeader title="Spaces" caption="Spend · Save · Goals · Upcoming" />
            <h2 id="spaces-all" className="sr-only">
              All Money Spaces
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <SpaceCard
                space={mockWallet.spaces.spend}
                availablePaise={mockWallet.availablePaise}
                onMove={(space) =>
                  setSheet({
                    feature: `Move from ${space.label}`,
                    body: "Shift money between Spaces in seconds.",
                  })
                }
              />
              <SpaceCard
                space={mockWallet.spaces.save}
                availablePaise={mockWallet.availablePaise}
                onMove={(space) =>
                  setSheet({
                    feature: `Move from ${space.label}`,
                    body: "Shift money between Spaces in seconds.",
                  })
                }
              />
              <SpaceCard
                space={mockWallet.spaces.goals}
                availablePaise={mockWallet.availablePaise}
                onMove={(space) =>
                  setSheet({
                    feature: `Move from ${space.label}`,
                    body: "Shift money between Spaces in seconds.",
                  })
                }
              />
              <SpaceCard
                space={upcomingSpace}
                availablePaise={mockWallet.availablePaise}
                upcoming
                onMove={() => undefined}
              />
            </div>
          </section>
        </Reveal>

        <Reveal>
          <section aria-labelledby="goals-all">
            <SectionHeader title="Goals" caption={`${mockGoals.length} active`} />
            <h2 id="goals-all" className="sr-only">
              Savings goals
            </h2>
            <div className="mt-3 flex flex-col gap-3">
              {mockGoals.map((goal) => {
                const progress = goalProgress(goal);
                return (
                  <Card key={goal.id} className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span
                          className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent"
                          aria-hidden="true"
                        >
                          <Target className="size-5" />
                        </span>
                        <div>
                          <p className="text-[15px] font-semibold text-ink">{goal.name}</p>
                          {goal.tag && (
                            <p className="mt-0.5 text-[13px] text-faint">{goal.tag}</p>
                          )}
                        </div>
                      </div>
                      <span className="tnum text-sm font-semibold text-accent">
                        {formatPercent(progress, 1)}
                      </span>
                    </div>
                    <ProgressBar value={progress} label={`${goal.name} progress`} className="mt-4" />
                    <div className="mt-3 flex items-center justify-between gap-3">
                      <p className="text-[13px] text-muted">
                        <Amount value={goal.savedPaise} size="sm" tone="muted" />
                        {" of "}
                        <Amount value={goal.targetPaise} size="sm" tone="muted" />
                      </p>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          setSheet({
                            feature: `Add to ${goal.name}`,
                            body: "Top up this goal from any Space.",
                          })
                        }
                      >
                        Add money
                      </Button>
                    </div>
                  </Card>
                );
              })}
            </div>
          </section>
        </Reveal>
      </div>

      <ComingSoonSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        feature={sheet?.feature ?? ""}
        body={sheet?.body}
      />
    </Container>
  );
}
