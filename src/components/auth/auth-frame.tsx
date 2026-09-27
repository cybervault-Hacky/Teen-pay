"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AppLogo } from "@/components/layout/app-logo";

/**
 * Frame for signed-out screens: no app navigation, content centred
 * on desktop, full-width on phones.
 */
export function AuthFrame({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  return (
    <div className="flex min-h-dvh flex-col items-center px-4 pb-12 pt-8 sm:px-6 sm:pt-14">
      <AppLogo />
      <motion.main
        id="main"
        initial={reduce ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: reduce ? 0 : 0.2, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="mt-8 w-full max-w-[440px] sm:mt-12"
      >
        {children}
      </motion.main>
    </div>
  );
}
