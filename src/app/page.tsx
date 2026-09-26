import type { Metadata } from "next";
import { Container } from "@/components/shell";
import { Reveal } from "@/components/ui";
import {
  ActivityPreview,
  BalanceCard,
  GoalPreview,
  QuickActions,
  SpacesPreview,
} from "@/components/home";

export const metadata: Metadata = { title: "Home" };

/** Home — balance, shortcuts, spaces, goal and recent activity. */
export default function HomePage() {
  return (
    <Container>
      <div className="flex flex-col gap-7 pt-5 sm:pt-8">
        <Reveal>
          <BalanceCard />
        </Reveal>
        <Reveal delay={0.05}>
          <QuickActions />
        </Reveal>
        <Reveal>
          <SpacesPreview />
        </Reveal>
        <Reveal>
          <GoalPreview />
        </Reveal>
        <Reveal>
          <ActivityPreview />
        </Reveal>
        <p className="pb-2 text-center text-xs text-faint">
          TeenPay Preview · Figures shown are sample data — no real money moves.
        </p>
      </div>
    </Container>
  );
}
