"use client";

import Link from "next/link";
import { ChevronRight, CornerUpLeft, Plus } from "lucide-react";
import { SPACE_TYPE_LABELS } from "@/domain";
import { formatINR } from "@/lib/currency";
import type { SpaceView } from "@/sandbox/selectors";
import { AmountDisplay } from "@/components/ui/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeadlineLine, SpaceIconTile, SpaceProgressBlock } from "./space-parts";

interface SpaceCardProps {
  space: SpaceView;
  /** Money can't move (frozen/closed wallet): actions are disabled. */
  locked: boolean;
  onAdd: () => void;
  onWithdraw: () => void;
}

/**
 * One Money Space in the Money list. The name is the link to the
 * Space's page (the whole card is clickable through it); Add and
 * Move back sit above that link so they stay separate targets.
 */
export function SpaceCard({ space, locked, onAdd, onWithdraw }: SpaceCardProps) {
  const archived = space.status === "archived";
  const goalFull = space.type === "goal" && space.progress.reached;
  return (
    <Card className="relative p-4 transition-colors duration-150 hover:border-line-strong sm:p-5">
      <div className="flex items-start gap-3">
        <SpaceIconTile icon={space.icon} muted={archived} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-ink">
            <Link
              href={`/money/${space.id}`}
              className="rounded-sm outline-none after:absolute after:inset-0 after:rounded-2xl focus-visible:ring-2 focus-visible:ring-accent"
            >
              {space.name}
            </Link>
          </h3>
          <p className="mt-0.5 text-xs text-ink-muted">
            {SPACE_TYPE_LABELS[space.type]}
            {space.isDefault ? " · Default" : ""}
          </p>
        </div>
        {archived ? (
          <Badge tone="neutral">Archived</Badge>
        ) : (
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        )}
      </div>

      <div className="mt-4 flex items-baseline justify-between gap-3">
        <AmountDisplay value={space.balance} size="md" />
        {space.progress.target !== undefined && (
          <span className="text-xs text-ink-faint">of {formatINR(space.progress.target)}</span>
        )}
      </div>
      <SpaceProgressBlock space={space} />
      {space.deadlineInfo && !archived && <DeadlineLine space={space} className="mt-2.5" />}

      {!archived && (
        <div className="relative z-10 mt-4 flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="flex-1"
            onClick={onAdd}
            disabled={locked || goalFull}
            aria-label={`Add to ${space.name}`}
          >
            <Plus className="h-4 w-4" aria-hidden />
            Add
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="flex-1"
            onClick={onWithdraw}
            disabled={locked || space.balance === 0}
            aria-label={`Move back from ${space.name}`}
          >
            <CornerUpLeft className="h-4 w-4" aria-hidden />
            Move back
          </Button>
        </div>
      )}
    </Card>
  );
}
