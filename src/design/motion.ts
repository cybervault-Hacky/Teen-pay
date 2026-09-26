/**
 * Centralized motion system.
 *
 * Every animation in the app should derive from these durations, easings
 * and variants so movement feels like one product. Motion is fast, subtle
 * and purposeful — never decorative.
 *
 * Reduced-motion users are respected globally via `MotionConfig`
 * (`reducedMotion="user"`) in `providers.tsx`.
 */

import type { Transition, Variants } from "framer-motion";

/** Cubic-bezier easings. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_STANDARD: [number, number, number, number] = [0.32, 0.72, 0, 1];

/** Duration scale (seconds). */
export const DURATION = {
  instant: 0.12,
  fast: 0.18,
  base: 0.28,
  slow: 0.4,
} as const;

export const transitionBase: Transition = {
  duration: DURATION.base,
  ease: EASE_STANDARD,
};

export const transitionFast: Transition = {
  duration: DURATION.fast,
  ease: EASE_OUT,
};

/** Fade + rise for page sections and cards. */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: transitionBase,
  },
  exit: { opacity: 0, y: -8, transition: transitionFast },
};

/** Simple fade for overlays and swaps. */
export const fade: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: transitionFast },
  exit: { opacity: 0, transition: transitionFast },
};

/** Stagger container — children should use `fadeUp` or `staggerItem`. */
export const staggerContainer: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.04 } },
};

export const staggerItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: transitionBase },
};

/** Bottom sheet entrance (mobile) / dialog scale (desktop handled by CSS). */
export const sheetUp: Variants = {
  hidden: { opacity: 0, y: 32, scale: 0.98 },
  show: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: DURATION.slow, ease: EASE_OUT },
  },
  exit: { opacity: 0, y: 16, scale: 0.98, transition: transitionFast },
};

/** Gentle press feedback for tactile controls. */
export const pressable = {
  whileTap: { scale: 0.97 },
} as const;

/** Active nav indicator glide. */
export const navIndicatorTransition: Transition = {
  type: "spring",
  stiffness: 500,
  damping: 38,
};
