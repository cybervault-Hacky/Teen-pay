"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createSandboxAuthService } from "./sandbox-service";
import {
  ACCOUNT_UNAVAILABLE_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  type AuthEvent,
  type AuthProviderInfo,
  type AuthService,
  type AuthSession,
  type AuthStatus,
  type SandboxSignInRequest,
  type SignInRequest,
  type SignOutReason,
} from "./types";

/**
 * React boundary for authentication. Components use `useAuth()`;
 * they never see the service, storage or anything token-like.
 */

export type AuthActionResult =
  | { ok: true; session: AuthSession }
  | { ok: false; message: string };

export interface AuthContextValue {
  status: AuthStatus;
  /** Present only while authenticated. */
  session: AuthSession | null;
  provider: AuthProviderInfo;
  /** A friendly, safe message to show on the sign-in screen. */
  notice: string | null;
  /** Why the last session ended in this tab (null if it hasn't). */
  endReason: SignOutReason | "expired" | null;
  signIn: (request: SignInRequest) => Promise<AuthActionResult>;
  /** Sandbox "Switch role": immediate, no navigation. */
  switchAccount: (request: SandboxSignInRequest) => AuthActionResult;
  /** Ends the session only. Account and sandbox data are kept. */
  signOut: (reason?: SignOutReason) => void;
  /** Simulates the session running out (sandbox testing aid). */
  expireSession: () => void;
  clearNotice: () => void;
  /** For the data layer to record security events. */
  subscribe: (listener: (event: AuthEvent) => void) => () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const MAX_TIMEOUT_MS = 2_147_483_647;

export function AuthProvider({
  children,
  service: providedService,
  now: providedNow,
}: {
  children: React.ReactNode;
  service?: AuthService;
  now?: () => number;
}) {
  const [service] = useState<AuthService>(() => providedService ?? createSandboxAuthService());
  const nowRef = useRef(providedNow ?? (() => Date.now()));
  nowRef.current = providedNow ?? (() => Date.now());

  // SSR and first client render: "restoring" (nothing is shown as
  // signed in or out until storage has been read).
  const [status, setStatus] = useState<AuthStatus>("restoring");
  const [session, setSession] = useState<AuthSession | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [endReason, setEndReason] = useState<AuthContextValue["endReason"]>(null);
  const sessionRef = useRef<AuthSession | null>(null);
  sessionRef.current = session;
  const listeners = useRef(new Set<(event: AuthEvent) => void>());

  const emit = useCallback((event: AuthEvent) => {
    for (const listener of listeners.current) listener(event);
  }, []);

  const expire = useCallback(() => {
    const current = sessionRef.current;
    service.markExpired();
    sessionRef.current = null;
    setSession(null);
    setStatus("expired");
    setNotice(SESSION_EXPIRED_MESSAGE);
    setEndReason("expired");
    if (current) {
      emit({
        type: "session_expired",
        accountId: current.accountId,
        sessionId: current.sessionId,
        at: new Date(nowRef.current()).toISOString(),
      });
    }
  }, [emit, service]);

  // Restore once on mount.
  useEffect(() => {
    const result = service.restore(nowRef.current());
    if (result.kind === "authenticated") {
      sessionRef.current = result.session;
      setSession(result.session);
      setStatus("authenticated");
      return;
    }
    if (result.kind === "expired") {
      setStatus("expired");
      setNotice(SESSION_EXPIRED_MESSAGE);
      if (!result.alreadyNoted && result.accountId && result.sessionId) {
        emit({
          type: "session_expired",
          accountId: result.accountId,
          sessionId: result.sessionId,
          at: new Date(nowRef.current()).toISOString(),
        });
      }
      return;
    }
    setStatus("signed_out");
    setNotice(result.notice);
  }, [emit, service]);

  // Expire on time, and re-check whenever the tab comes back.
  useEffect(() => {
    if (status !== "authenticated" || !session) return;
    const check = () => {
      if (Date.parse(session.expiresAt) <= nowRef.current()) expire();
    };
    const remaining = Date.parse(session.expiresAt) - nowRef.current();
    if (remaining <= 0) {
      expire();
      return;
    }
    const timer = window.setTimeout(check, Math.min(remaining, MAX_TIMEOUT_MS));
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [status, session, expire]);

  const adopt = useCallback(
    (next: AuthSession) => {
      const previous = sessionRef.current;
      if (previous && previous.sessionId !== next.sessionId) {
        emit({
          type: "sign_out",
          accountId: previous.accountId,
          sessionId: previous.sessionId,
          at: next.createdAt,
        });
      }
      sessionRef.current = next;
      setSession(next);
      setStatus("authenticated");
      setNotice(null);
      setEndReason(null);
      emit({
        type: "sign_in",
        accountId: next.accountId,
        sessionId: next.sessionId,
        at: next.createdAt,
      });
    },
    [emit],
  );

  const signIn = useCallback(
    async (request: SignInRequest): Promise<AuthActionResult> => {
      setStatus((s) => (s === "authenticated" ? s : "authenticating"));
      let result: AuthSession | { message: string };
      try {
        result = await service.signIn(request, nowRef.current());
      } catch {
        result = { message: "Couldn't start a session. Please try again." };
      }
      if ("sessionId" in result) {
        adopt(result);
        return { ok: true, session: result };
      }
      setStatus(sessionRef.current ? "authenticated" : "signed_out");
      return { ok: false, message: result.message };
    },
    [adopt, service],
  );

  const switchAccount = useCallback(
    (request: SandboxSignInRequest): AuthActionResult => {
      if (!service.switchAccount) {
        return { ok: false, message: "Switching accounts isn't available here." };
      }
      const result = service.switchAccount(request, nowRef.current());
      if ("sessionId" in result) {
        adopt(result);
        return { ok: true, session: result };
      }
      return { ok: false, message: result.message };
    },
    [adopt, service],
  );

  const signOut = useCallback(
    (reason: SignOutReason = "user") => {
      const current = sessionRef.current;
      service.signOut(reason);
      sessionRef.current = null;
      setSession(null);
      setStatus("signed_out");
      setEndReason(reason);
      setNotice(reason === "account_unavailable" ? ACCOUNT_UNAVAILABLE_MESSAGE : null);
      if (current) {
        emit({
          type: "sign_out",
          accountId: current.accountId,
          sessionId: current.sessionId,
          at: new Date(nowRef.current()).toISOString(),
        });
      }
    },
    [emit, service],
  );

  const clearNotice = useCallback(() => {
    service.clearNotice();
    setNotice(null);
    setStatus((s) => (s === "expired" ? "signed_out" : s));
  }, [service]);

  const subscribe = useCallback((listener: (event: AuthEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      session,
      provider: service.provider,
      notice,
      endReason,
      signIn,
      switchAccount,
      signOut,
      expireSession: expire,
      clearNotice,
      subscribe,
    }),
    [status, session, service, notice, endReason, signIn, switchAccount, signOut, expire, clearNotice, subscribe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within an AuthProvider");
  return context;
}

/** Null outside an AuthProvider (isolated component tests). */
export function useOptionalAuth(): AuthContextValue | null {
  return useContext(AuthContext);
}
