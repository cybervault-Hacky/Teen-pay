import Link from "next/link";
import { CalendarClock, Coins, PiggyBank, Target, type LucideIcon } from "lucide-react";
import { mockWallet } from "@/data/mock";
import type { SpaceType } from "@/domain";
import { spaceShare } from "@/domain";
import { Amount, SectionHeader } from "@/components/ui";

const spaceIcons: Record<SpaceType, LucideIcon> = {
  spend: Coins,
  save: PiggyBank,
  goals: Target,
  upcoming: CalendarClock,
};

/** Compact Money Spaces strip — scrolls on mobile, grids on desktop. */
export function SpacesPreview() {
  const spaces = [
    { ...mockWallet.spaces.spend, upcoming: false },
    { ...mockWallet.spaces.save, upcoming: false },
    { ...mockWallet.spaces.goals, upcoming: false },
    {
      type: "upcoming" as const,
      label: "Upcoming",
      description: "On its way to you.",
      balancePaise: mockWallet.upcomingPaise,
      currency: mockWallet.currency,
      upcoming: true,
    },
  ];

  return (
    <section aria-labelledby="spaces-heading">
      <SectionHeader
        title="Money Spaces"
        caption="Every rupee has a job"
        action={{ label: "View all", href: "/money" }}
      />
      <div
        className="no-scrollbar -mx-4 mt-3 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0"
        id="spaces-heading"
      >
        {spaces.map((space) => {
          const Icon = spaceIcons[space.type];
          const share = spaceShare(space.balancePaise, mockWallet.availablePaise);
          return (
            <Link
              key={space.type}
              href="/money"
              className="w-[148px] shrink-0 snap-start rounded-2xl border border-line bg-surface p-4 shadow-card transition-colors duration-150 hover:border-line-strong hover:bg-surface-2 sm:w-auto"
            >
              <span
                className="flex size-9 items-center justify-center rounded-xl bg-surface-3 text-accent"
                aria-hidden="true"
              >
                <Icon className="size-[18px]" />
              </span>
              <span className="mt-3 block text-xs font-semibold tracking-[0.08em] text-faint uppercase">
                {space.label}
              </span>
              <span className="mt-1 block">
                <Amount value={space.balancePaise} size="md" />
              </span>
              {!space.upcoming && (
                <span
                  className="mt-2.5 block h-1 overflow-hidden rounded-full bg-surface-3"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-accent/70"
                    style={{ width: `${Math.round(share * 100)}%` }}
                  />
                </span>
              )}
              {space.upcoming && (
                <span className="mt-2.5 block text-[11px] text-faint">Expected</span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
