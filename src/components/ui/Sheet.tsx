"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { fade, sheetUp } from "@/design/motion";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * Modal sheet — bottom sheet on mobile, centered dialog on desktop.
 * Escape to close, scrim click to close, scroll-locked, labelled.
 */
export function Sheet({ open, onClose, title, description, children, footer }: SheetProps) {
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  const handleKey = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    document.addEventListener("keydown", handleKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = previous;
    };
  }, [open, handleKey]);

  // Portals need `document` — `open` can only become true client-side,
  // so this guard never hides content, it only protects server rendering.
  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-60 flex items-end justify-center sm:items-center sm:p-6">
          <motion.div
            variants={fade}
            initial="hidden"
            animate="show"
            exit="exit"
            aria-hidden="true"
            onClick={onClose}
            className="absolute inset-0 bg-scrim backdrop-blur-[2px]"
          />
          <motion.div
            variants={sheetUp}
            initial="hidden"
            animate="show"
            exit="exit"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className={cn(
              "relative flex max-h-[88dvh] w-full flex-col overflow-hidden",
              "rounded-t-3xl border border-line bg-surface shadow-pop",
              "sm:max-w-md sm:rounded-3xl",
            )}
          >
            <div
              className="mx-auto mt-3 h-1 w-10 shrink-0 rounded-full bg-line-strong sm:hidden"
              aria-hidden="true"
            />
            <div className="flex items-start justify-between gap-4 px-5 pt-4 sm:px-6 sm:pt-6">
              <div>
                <h2
                  id={titleId}
                  className="font-display text-lg font-semibold tracking-tight text-ink"
                >
                  {title}
                </h2>
                {description && (
                  <p className="mt-1 text-sm text-muted">{description}</p>
                )}
              </div>
              <IconButton
                ref={closeRef}
                label="Close"
                variant="ghost"
                size="sm"
                onClick={onClose}
                className="-mt-1 -mr-2 shrink-0"
              >
                <X aria-hidden="true" />
              </IconButton>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {children}
            </div>
            {footer && (
              <div className="shrink-0 border-t border-line px-5 py-4 sm:px-6">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
