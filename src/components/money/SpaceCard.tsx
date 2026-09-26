"use client";

import { ArrowLeftRight, CalendarClock, Coins, PiggyBank, Target, type LucideIcon } from "lucide-react";
import { spaceShare, type MoneySpace } from "@/domain";
import { formatPercent } from "@/lib/format";
import { Amount, Card, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/cn";

const spaceIcons: Record<MoneySpace["type"], LucideIcon> = {
  spend: Coins,
  save: PiggyBank,
  goals: Target,
  upcoming: CalendarClock,
};

export interface SpaceCardProps {
  space: MoneySpace;
  /** Total available balance — used for the share bar (ignored for Upcoming). */
  availablePaise: number;
  upcoming?: boolean;
  onMove: (space: MoneySpace) => void;
}

/** Full Money Space card for the Money tab. */
export function SpaceCard({ space, availablePaise, upcoming = false, onMove }: SpaceCardProps) {
  const Icon = spaceIcons[space.type];
  const share = spaceShare(space.balancePaise, availablePaise);

  return (
    <Card className="flex flex-col p-5">
      <div className="flex items-start justify-between gap-3">
        <span
          className={cn(
            "flex size-11 items-center justify-center rounded-xl",
            upcoming ? "bg-info-soft text-info" : "bg-accent-soft text-accent",
          )}
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        {!upcoming && (
          <button
            type="button"
            onClick={() => onMove(space)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] font-medium text-muted transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <ArrowLeftRight className="size-3.5" aria-hidden="true" />
            Move
          </button>
        )}
      </div>
      <p className="mt-4 text-xs font-semibold tracking-[0.08em] text-faint uppercase">
        {space.label}
      </p>
      <Amount value={space.balancePaise} size="lg" className="mt-1" />
      <p className="mt-1 text-[13px] text-muted">{space.description}</p>
      {!upcoming ? (
        <div className="mt-4">
          <ProgressBar value={share} label={`${space.label} share of balance`} />
          <p className="tnum mt-1.5 text-xs text-faint">
            {formatPercent(share, 1)} of balance
          </p>
        </div>
      ) : (
        <p className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-full bg-info-soft px-2.5 py-1 text-xs font-medium text-info-ink">
          Arriving soon
        </p>
      )}
    </Card>
  );
}
