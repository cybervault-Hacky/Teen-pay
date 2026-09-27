"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { AuthContextValue } from "@/auth/provider";
import { useOptionalSandbox } from "@/sandbox/store";
import { AuthStatusScreen } from "./auth-status-screen";

/**
 * Protects signed-in screens. Without an active session it shows a
 * neutral status and sends the person to sign in, remembering where
 * they were going. Protected content never renders without a
 * session, and missing session data never breaks the page.
 */
export function AuthGate({
  auth,
  children,
}: {
  auth: AuthContextValue;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sandbox = useOptionalSandbox();
  const needsSignIn = auth.status === "signed_out" || auth.status === "expired";

  // A deliberate sign-out or reset *on this screen* goes to a plain
  // sign-in screen; otherwise (expiry, or opening a protected page
  // while signed out) remember where the person was headed.
  const sawSession = useRef(auth.status === "authenticated");
  if (auth.status === "authenticated") sawSession.current = true;
  const deliberate =
    sawSession.current && (auth.endReason === "user" || auth.endReason === "reset");
  useEffect(() => {
    if (!needsSignIn) return;
    router.replace(
      deliberate ? "/sign-in" : `/sign-in?next=${encodeURIComponent(pathname || "/")}`,
    );
  }, [needsSignIn, deliberate, pathname, router]);

  if (needsSignIn) return <AuthStatusScreen message="Taking you to sign in…" />;
  if (auth.status !== "authenticated" || !sandbox) {
    return <AuthStatusScreen message="Opening your sandbox session…" />;
  }
  return <>{children}</>;
}
