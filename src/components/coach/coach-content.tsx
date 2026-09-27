"use client";

import Link from "next/link";
import { useState } from "react";
import { ChevronRight, Compass, Info, ShieldCheck } from "lucide-react";
import {
  COACH_PERIOD_LABEL,
  formatDayRange,
  inPeriodText,
  lessonAnchor,
  previousPeriodText,
  type CoachPeriod,
  type CoachReport,
  type CoachSummary,
} from "@/domain";
import { formatINR } from "@/lib/currency";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { CoachGoals } from "./coach-goals";
import { InsightCard } from "./insight-card";
import { PeriodSelector } from "./period-selector";
import { SpendingCompare } from "./spending-compare";
import { useCoachReport } from "./use-coach";

const linkClass =
  "inline-flex items-center gap-1 text-sm font-medium text-accent transition-colors duration-150 hover:text-accent-strong motion-reduce:transition-none";

/**
 * Money Coach — a read-only, teen-only look at your own money.
 *
 * Everything here is derived (see `sandbox/coach.ts`); the screen has
 * no buttons that move money or change settings. Its only side effects
 * are navigation and the local period choice, which isn't saved.
 */
export interface CoachContentProps {
  /** Optional content shown under the header (e.g. a learning note). */
  notice?: React.ReactNode;
  /** Optional signal that the teen opened a Learn lesson. Changes nothing here. */
  onLessonOpened?: () => void;
}

export function CoachContent({ notice, onLessonOpened }: CoachContentProps = {}) {
  const [period, setPeriod] = useState<CoachPeriod>("month");
  const result = useCoachReport(period);

  return (
    <div>
      <PageHeader
        title="Money Coach"
        description="A read-only look at your own money. It never moves money or changes anything."
        actions={<Badge tone="warning">Sandbox</Badge>}
      />
      {notice}

      {!result.ok ? (
        <Card>
          <EmptyState
            icon={ShieldCheck}
            title="Money Coach isn't available right now"
            description={
              result.error.code === "not_permitted"
                ? "Money Coach is available on teen accounts, for your own money."
                : "Nothing was changed. Try again in a moment."
            }
            className="py-10"
          />
        </Card>
      ) : result.value.empty ? (
        <CoachEmpty report={result.value} onLessonOpened={onLessonOpened} />
      ) : (
        <CoachReportView
          report={result.value}
          period={period}
          onPeriodChange={setPeriod}
          onLessonOpened={onLessonOpened}
        />
      )}
    </div>
  );
}

function CoachEmpty({ report, onLessonOpened }: { report: CoachReport; onLessonOpened?: () => void }) {
  return (
    <div className="space-y-6">
      <Card>
        <EmptyState
          icon={Compass}
          title="Your Money Coach is getting to know your money."
          description="Make a few transactions to see insights here."
          action={
            <Link href="/money" className={linkClass}>
              Open Money Spaces
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          }
          className="py-10"
        />
      </Card>
      <Learn report={report} onLessonOpened={onLessonOpened} />
    </div>
  );
}

function CoachReportView({
  report,
  period,
  onPeriodChange,
  onLessonOpened,
}: {
  report: CoachReport;
  period: CoachPeriod;
  onLessonOpened?: () => void;
  onPeriodChange: (period: CoachPeriod) => void;
}) {
  const { summary } = report;
  const range = formatDayRange(summary.range);
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <PeriodSelector value={period} onChange={onPeriodChange} />
        <p className="text-xs text-ink-muted" role="status" aria-live="polite">
          Showing {COACH_PERIOD_LABEL[period].toLowerCase()}: {range}.
          {report.lowData && ` Not enough history yet to compare with ${previousPeriodText(period)}.`}
        </p>
      </div>

      <AtAGlance summary={summary} />

      <section aria-label="Insights">
        <SectionHeader title="Insights" />
        {report.insights.length > 0 ? (
          <Card>
            <ul className="divide-y divide-line">
              {report.insights.map((insight, i) => (
                <li key={insight.id}>
                  <InsightCard insight={insight} headingId={`coach-insight-${i}`} />
                </li>
              ))}
            </ul>
          </Card>
        ) : (
          <Card>
            <EmptyState
              icon={Compass}
              title="No insights for this period yet"
              description="Try another period, or check back after money moves."
              className="py-10"
            />
          </Card>
        )}
      </section>

      <section aria-label="Saving goals">
        <SectionHeader title="Saving goals" href="/money" linkLabel="Money Spaces" />
        <CoachGoals goals={report.goals} />
      </section>

      <HowItWorks />

      <Learn report={report} onLessonOpened={onLessonOpened} />
    </div>
  );
}

function receivedParts(summary: CoachSummary): string {
  const parts: string[] = [];
  if (summary.received.pocketMoney > 0) parts.push(`Pocket money ${formatINR(summary.received.pocketMoney)}`);
  if (summary.received.fromPeople > 0) parts.push(`From people ${formatINR(summary.received.fromPeople)}`);
  if (summary.received.sandbox > 0) parts.push(`Sandbox top-ups ${formatINR(summary.received.sandbox)}`);
  return parts.length > 0 ? parts.join(" · ") : "Nothing received";
}

function comparisonLine(summary: CoachSummary): string {
  const c = summary.spendingComparison;
  const before = previousPeriodText(summary.period);
  if (c.kind === "not_enough_data") return "Not enough data yet to compare.";
  if (c.previous === 0) return `₹0 in ${before} (${formatDayRange(summary.previousRange)}).`;
  const how = c.change === "similar" ? "About the same as" : c.change === "up" ? "More than" : "Less than";
  return `${how} ${formatINR(c.previous)} in ${before} (${formatDayRange(summary.previousRange)}).`;
}

/**
 * The four numbers. Available and Set aside are balances right now;
 * Received and Spent cover the chosen period — each says which.
 */
function AtAGlance({ summary }: { summary: CoachSummary }) {
  const range = formatDayRange(summary.range);
  const inP = inPeriodText(summary.period);
  const count = summary.spendingTransactionCount;
  const metrics = [
    { label: "Available", when: "Now", amount: summary.availableBalance, note: "Ready to spend or send" },
    { label: "Set aside", when: "Now", amount: summary.setAside, note: "In your Money Spaces" },
    { label: "Received", when: range, amount: summary.totalReceived, note: receivedParts(summary) },
    {
      label: "Spent",
      when: range,
      amount: summary.totalSpent,
      note: `${count} ${count === 1 ? "payment or transfer" : "payments or transfers"}. ${comparisonLine(summary)}`,
    },
  ];
  return (
    <section aria-label="Your money at a glance">
      <SectionHeader title="Your money at a glance" href="/activity" linkLabel="Activity" />
      <Card className="p-4 sm:p-5">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
          {metrics.map((m) => (
            <div key={m.label} className="min-w-0">
              <dt className="text-xs text-ink-faint">
                <span className="font-medium text-ink-muted">{m.label}</span>
                <span className="sr-only">, </span>
                <span className="ml-1.5">{m.when}</span>
              </dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums tracking-tight text-ink">
                {formatINR(m.amount)}
              </dd>
              <dd className="mt-0.5 text-xs leading-relaxed text-ink-muted">{m.note}</dd>
            </div>
          ))}
        </dl>
        {summary.refunded > 0 && (
          <p className="mt-4 text-xs text-ink-muted">
            {formatINR(summary.refunded)} came back as refunds {inP}. Refunds aren&apos;t counted as money received.
          </p>
        )}
        <SpendingCompare summary={summary} />
      </Card>
    </section>
  );
}

const DEFINITIONS: { term: string; detail: string }[] = [
  {
    term: "Spent",
    detail:
      "Completed payments and transfers to people that left your available balance in the period. Pending, declined or failed payments aren't counted, and moving money into a Space isn't spending.",
  },
  {
    term: "Received",
    detail:
      "Pocket money, money from people (including paid requests) and sandbox top-ups in the period. Refunds aren't counted as money received.",
  },
  {
    term: "Available and Set aside",
    detail:
      "Your balances right now, from the Money screen. Set aside is what's in your Money Spaces — it's still your money.",
  },
  {
    term: "Savings rate",
    detail:
      "Money moved into Spaces during the period, minus anything moved back, divided by money received in the same period. If nothing was received, there isn't enough data for a rate.",
  },
  {
    term: "Periods",
    detail:
      "Week runs from Monday to today, Month from the 1st to today, and 30 days is the last 30 days including today. Comparisons use the same days of the previous week or month, or the 30 days before. Dates are in India time (IST).",
  },
];

function HowItWorks() {
  return (
    <section aria-label="How these numbers work">
      <SectionHeader title="How these numbers work" />
      <Card className="p-4 sm:p-5">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
            <Info className="h-4 w-4 text-ink-faint" aria-hidden />
            Definitions
            <ChevronRight
              className="ml-auto h-4 w-4 text-ink-faint transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <dl className="mt-3 space-y-3">
            {DEFINITIONS.map((d) => (
              <div key={d.term}>
                <dt className="text-sm font-medium text-ink">{d.term}</dt>
                <dd className="mt-0.5 text-sm leading-relaxed text-ink-muted">{d.detail}</dd>
              </div>
            ))}
          </dl>
        </details>
        <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-ink-muted">
          Money Coach is informational and read-only. It doesn&apos;t move money, approve payments, change
          limits or give investment advice. Everything is worked out on this device from your own sandbox
          activity.
        </p>
      </Card>
    </section>
  );
}

function Learn({ report, onLessonOpened }: { report: CoachReport; onLessonOpened?: () => void }) {
  return (
    <section aria-label="Learn">
      <SectionHeader title="Learn" />
      <Card>
        <ul className="divide-y divide-line">
          {report.lessons.map((lesson) => (
            <li key={lesson.id} id={lessonAnchor(lesson.id)} className="scroll-mt-24">
              <details
                className="group px-4 py-3.5 sm:px-5"
                onToggle={(e) => {
                  if (e.currentTarget.open) onLessonOpened?.();
                }}
              >
                <summary className="flex cursor-pointer list-none items-center gap-3 text-sm font-medium text-ink [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0 flex-1">{lesson.title}</span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-ink-faint transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
                    aria-hidden
                  />
                </summary>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{lesson.body}</p>
              </details>
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}
