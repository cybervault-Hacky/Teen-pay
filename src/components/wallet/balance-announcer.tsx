"use client";

import { useEffect, useRef, useState } from "react";
import { formatINR } from "@/lib/currency";

/**
 * Announces balance changes to screen readers (polite, visually
 * hidden). Silent on first render, so opening a screen doesn't read
 * the balance twice — it speaks only when money actually moves.
 */
export function BalanceAnnouncer({ amount, label = "Available balance" }: { amount: number; label?: string }) {
  const previous = useRef(amount);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (previous.current === amount) return;
    const delta = amount - previous.current;
    previous.current = amount;
    setMessage(
      `${label} is now ${formatINR(amount)}, ${delta > 0 ? "up" : "down"} ${formatINR(Math.abs(delta))}.`,
    );
  }, [amount, label]);

  return (
    <span role="status" aria-live="polite" className="sr-only">
      {message}
    </span>
  );
}
