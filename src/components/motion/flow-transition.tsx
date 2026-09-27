"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

interface FlowTransitionProps {
  /** Remount the content whenever this key changes. */
  step: string;
  children: React.ReactNode;
}

/**
 * The shared step transition for flows (Pay, Review, Success):
 * a quick, quiet fade-and-rise. Skipped under reduced motion.
 */
export function FlowTransition({ step, children }: FlowTransitionProps) {
  const reduce = useReducedMotion();
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={step}
        initial={reduce ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={reduce ? undefined : { opacity: 0, y: -4 }}
        transition={{ duration: 0.18, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
