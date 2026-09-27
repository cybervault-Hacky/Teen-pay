"use client";

import Link from "next/link";
import { PiggyBank } from "lucide-react";
import { formatINR } from "@/lib/currency";
import type { SpaceView } from "@/sandbox/selectors";
import { AmountDisplay } from "@/components/ui/amount";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/section-header";
import { SpaceIconTile, SpaceProgressBlock } from "@/components/spaces/space-parts";

const HOME_LIMIT = 3;

/**
 * Home's compact view of Money Spaces: how much is set aside and the
 * first few spaces. Everything else lives on the Money screen.
 */
export function SpacesSummary({ spaces, allocated }: { spaces: SpaceView[]; allocated: number }) {
  const shown = spaces.slice(0, HOME_LIMIT);
  return (
    <section aria-label="Money Spaces">
      <SectionHeader title="Money Spaces" href="/money" linkLabel="View all" />
      <Card>
        {shown.length === 0 ? (
          <EmptyState
            icon={PiggyBank}
            title="Nothing set aside yet"
            description="Create a goal on the Money screen."
            className="py-10"
          />
        ) : (
          <>
            <p className="px-4 pt-4 text-sm text-ink-muted sm:px-5">
              {formatINR(allocated)} set aside in {spaces.length}{" "}
              {spaces.length === 1 ? "space" : "spaces"}
            </p>
            <ul className="divide-y divide-line">
              {shown.map((space) => (
                <li key={space.id}>
                  <Link
                    href={`/money/${space.id}`}
                    className="block px-4 py-3.5 transition-colors duration-150 hover:bg-surface-2/60 sm:px-5"
                  >
                    <div className="flex items-center gap-3">
                      <SpaceIconTile icon={space.icon} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">
                        {space.name}
                      </span>
                      <AmountDisplay value={space.balance} size="sm" />
                    </div>
                    <SpaceProgressBlock space={space} compact />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}
