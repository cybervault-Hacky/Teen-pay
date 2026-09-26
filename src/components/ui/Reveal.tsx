"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { fadeUp } from "@/design/motion";

export interface RevealProps {
  children: ReactNode;
  /** Stagger offset in seconds. */
  delay?: number;
  className?: string;
}

/**
 * Entrance wrapper for page sections. Fades up once when scrolled into
 * view; instantly visible when content is already on screen.
 */
export function Reveal({ children, delay = 0, className }: RevealProps) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-32px" }}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
