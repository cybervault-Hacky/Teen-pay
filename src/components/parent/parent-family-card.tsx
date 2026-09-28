"use client";

import { Check, Clock } from "lucide-react";
import type { ParentCenterView, TeenCenterView } from "@/sandbox/parent-center";
import { Avatar } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/**
 * Family status inside the Parent Control Center: who's connected,
 * and anything still waiting on a decision (a claimed invite to
 * review). All management stays on the existing /family screen —
 * this card only surfaces state.
 */
export function ParentFamilyCard({
  center,
  selectedTeenId,
}: {
  center: ParentCenterView;
  selectedTeenId: string;
}) {
  return (
    <Card>
      <ul className="divide-y divide-line">
        <li className="flex items-center gap-3.5 px-4 py-3.5">
          <Avatar
            name={center.parent.displayName}
            initials={center.parent.initials}
            size="md"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {center.parent.displayName} <span className="text-ink-muted">(you)</span>
            </p>
            <p className="mt-0.5 truncate text-xs text-ink-muted">
              Parent / Guardian · {center.parent.handle}
            </p>
          </div>
        </li>
        {center.teens.map((teen) => (
          <FamilyTeenRow
            key={teen.teen.accountId}
            teen={teen}
            selected={teen.teen.accountId === selectedTeenId}
          />
        ))}
      </ul>
      {center.invitePendingReview && (
        <p className="flex items-start gap-2 border-t border-line px-4 py-3.5 text-xs text-ink-muted">
          <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            {center.invitePendingReview.teenName} asked to connect — review the request
            in Family.
          </span>
        </p>
      )}
      <div className="border-t border-line px-4 py-3">
        <Button variant="ghost" size="sm" href="/family">
          Manage family
        </Button>
      </div>
    </Card>
  );
}

function FamilyTeenRow({ teen, selected }: { teen: TeenCenterView; selected: boolean }) {
  return (
    <li className="flex flex-wrap items-center gap-3.5 px-4 py-3.5">
      <Avatar
        name={teen.teen.displayName}
        initials={teen.teen.initials}
        size="md"
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {teen.teen.displayName}
          {selected && <span className="text-ink-muted"> · managing</span>}
        </p>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          Teen · {teen.teen.handle}
        </p>
      </div>
      <Badge tone={teen.family.membership === "active" ? "success" : "neutral"}>
        {teen.family.membership === "active" ? (
          <Check className="h-3 w-3" aria-hidden />
        ) : (
          <Clock className="h-3 w-3" aria-hidden />
        )}
        {teen.family.membership === "active" ? "Connected" : "Pending"}
      </Badge>
    </li>
  );
}
