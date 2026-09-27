"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { useOptionalAuth } from "@/auth/provider";
import { AuthFrame } from "@/components/auth/auth-frame";
import { AuthGate } from "@/components/auth/auth-gate";
import { isAuthRoute, isProtectedRoute } from "@/lib/navigation";
import { useOptionalSandbox } from "@/sandbox/store";
import { SideNav } from "./side-nav";
import { TabBar } from "./tab-bar";

interface AppShellProps {
  children: React.ReactNode;
}

/**
 * The application frame. Signed-in screens get the desktop rail,
 * mobile tab bar and transitioned content column; auth screens (and
 * a 404 seen while signed out) get a minimal centred frame. Protected
 * routes sit behind the auth gate. Pages only ever provide their own
 * content — chrome lives here and only here.
 */
export function AppShell({ children }: AppShellProps) {
  const pathname = usePathname();
  const auth = useOptionalAuth();
  const sandbox = useOptionalSandbox();

  // Every route starts at the top.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);

  // No auth layer (isolated component tests): plain chrome.
  if (!auth) return <Chrome pathname={pathname}>{children}</Chrome>;

  if (isAuthRoute(pathname)) return <AuthFrame>{children}</AuthFrame>;

  if (isProtectedRoute(pathname)) {
    return (
      <AuthGate auth={auth}>
        <Chrome pathname={pathname}>{children}</Chrome>
      </AuthGate>
    );
  }

  // Anything else (the 404): full chrome when signed in, else minimal.
  return auth.status === "authenticated" && sandbox ? (
    <Chrome pathname={pathname}>{children}</Chrome>
  ) : (
    <AuthFrame>{children}</AuthFrame>
  );
}

function Chrome({ pathname, children }: { pathname: string; children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[1080px]">
      <SideNav />
      <div className="min-w-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.main
            id="main"
            key={pathname}
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -4 }}
            transition={{
              duration: reduce ? 0 : 0.2,
              ease: [0.25, 0.46, 0.45, 0.94],
            }}
            className="mx-auto w-full max-w-[620px] px-4 pb-28 pt-6 sm:px-6 md:pb-16 md:pt-10 lg:max-w-[700px] lg:px-10 lg:pt-12"
          >
            {children}
          </motion.main>
        </AnimatePresence>
      </div>
      <TabBar />
    </div>
  );
}
