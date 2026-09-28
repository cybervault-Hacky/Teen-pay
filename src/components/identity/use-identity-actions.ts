"use client";

import { useCallback, useEffect, useState } from "react";

export type ShareSupport = "unknown" | "available" | "unavailable";

/**
 * Copy / Share for a TeenPay ID — the one place these actions live.
 *
 * Copy writes only the handle to the Clipboard API (never an internal
 * id). Share uses the Web Share API only where the browser really
 * offers it (detected after mount) and shares only the identity text —
 * no account, wallet, balance or family detail; otherwise it says so
 * and points to Copy. Every outcome is announced through the returned
 * `status` string for a `role="status"` live region.
 */
export function useIdentityActions(handle: string) {
  const [status, setStatus] = useState("");
  const [shareSupport, setShareSupport] = useState<ShareSupport>("unknown");

  useEffect(() => {
    setShareSupport(
      typeof navigator !== "undefined" && typeof navigator.share === "function"
        ? "available"
        : "unavailable",
    );
  }, []);

  const copy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("unavailable");
      await navigator.clipboard.writeText(handle);
      setStatus(`Copied ${handle}.`);
    } catch {
      setStatus(`Copying isn't available here. Your TeenPay ID is ${handle}.`);
    }
  }, [handle]);

  const share = useCallback(async () => {
    try {
      await navigator.share({
        title: "My TeenPay ID",
        text: `Pay or request from me on TeenPay (sandbox): ${handle}`,
      });
      setStatus("Shared.");
    } catch (error) {
      // Dismissing the share sheet isn't an error worth announcing.
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus(`Sharing didn't work. Your TeenPay ID is ${handle} — copy it instead.`);
    }
  }, [handle]);

  return { status, setStatus, shareSupport, copy, share };
}
