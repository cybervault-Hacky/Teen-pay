import type { ReactNode } from "react";
import { BottomNav } from "./BottomNav";
import { PageTransition } from "./PageTransition";
import { SideNav } from "./SideNav";
import { TopHeader } from "./TopHeader";

/**
 * Application shell — owns every persistent chrome element:
 * sidebar (desktop), header, bottom nav (mobile) and transitions.
 * Pages render inside <main> and stay focused on their own content.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-70 focus:rounded-lg focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
      >
        Skip to content
      </a>
      <div className="mx-auto flex min-h-dvh w-full max-w-[1280px]">
        <SideNav />
        <div className="flex min-w-0 flex-1 flex-col">
          <TopHeader />
          <main id="main-content" className="flex-1 pb-28 lg:pb-16">
            <PageTransition>{children}</PageTransition>
          </main>
        </div>
      </div>
      <BottomNav />
    </div>
  );
}
