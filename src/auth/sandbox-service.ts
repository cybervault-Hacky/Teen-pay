import {
  ACCOUNT_UNAVAILABLE_MESSAGE,
  type AuthProviderInfo,
  type AuthError,
  type AuthService,
  type AuthSession,
  type RestoreResult,
  type SignInRequest,
  type SignOutReason,
} from "./types";

/**
 * Sandbox auth service — a transparent demo session, not
 * authentication. It stores only a session summary (ids, role,
 * timestamps) in this browser under its own key: no password, no
 * token, no key, nothing that grants access anywhere else.
 */

export const SESSION_STORAGE_KEY = "teenpay-session-v1";
/** Sandbox sessions last 8 hours, then ask the person to sign in again. */
export const SANDBOX_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

export const SANDBOX_AUTH_PROVIDER: AuthProviderInfo = {
  id: "sandbox",
  label: "Sandbox session",
  isRealAuthentication: false,
  usesCredentials: false,
};

type Ended = "expired" | "account_unavailable";

interface StoredSession {
  version: 1;
  session: AuthSession | null;
  /** Why the last session ended, so the notice survives a reload. */
  ended?: Ended;
  /** Who it belonged to (for the expiry security event). */
  endedAccountId?: string;
  endedSessionId?: string;
}

function isSession(value: unknown): value is AuthSession {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.sessionId === "string" &&
    typeof s.accountId === "string" &&
    (s.role === "teen" || s.role === "parent") &&
    s.provider === "sandbox" &&
    typeof s.createdAt === "string" &&
    typeof s.expiresAt === "string" &&
    !Number.isNaN(Date.parse(s.expiresAt))
  );
}

function randomSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `ses_${crypto.randomUUID()}`;
  }
  return `ses_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function browserStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function createSandboxAuthService(
  options: {
    storage?: () => Storage | null;
    ttlMs?: number;
    newSessionId?: () => string;
  } = {},
): AuthService {
  const getStorage = options.storage ?? browserStorage;
  const ttl = options.ttlMs ?? SANDBOX_SESSION_TTL_MS;
  const newSessionId = options.newSessionId ?? randomSessionId;
  // Memory copy, so the service still works when storage is blocked.
  let memory: StoredSession = { version: 1, session: null };

  const read = (): StoredSession => {
    const storage = getStorage();
    if (!storage) return memory;
    try {
      const raw = storage.getItem(SESSION_STORAGE_KEY);
      if (!raw) return { version: 1, session: null };
      const parsed = JSON.parse(raw) as Partial<StoredSession>;
      if (parsed.version !== 1) return { version: 1, session: null };
      return {
        version: 1,
        session: isSession(parsed.session) ? parsed.session : null,
        ...(parsed.ended === "expired" || parsed.ended === "account_unavailable"
          ? { ended: parsed.ended }
          : {}),
        ...(typeof parsed.endedAccountId === "string"
          ? { endedAccountId: parsed.endedAccountId }
          : {}),
        ...(typeof parsed.endedSessionId === "string"
          ? { endedSessionId: parsed.endedSessionId }
          : {}),
      };
    } catch {
      // Malformed session data is treated as "signed out".
      return { version: 1, session: null };
    }
  };

  const write = (value: StoredSession) => {
    memory = value;
    const storage = getStorage();
    if (!storage) return;
    try {
      if (value.session === null && !value.ended) {
        storage.removeItem(SESSION_STORAGE_KEY);
      } else {
        storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(value));
      }
    } catch {
      // Memory copy still holds it for this tab.
    }
  };

  const open = (request: SignInRequest, now: number): AuthSession | AuthError => {
    if (request.method !== "sandbox") {
      return { code: "unsupported_method", message: "That sign-in method isn't available." };
    }
    if (!request.accountId) {
      return { code: "sign_in_failed", message: "Choose an account to continue." };
    }
    const session: AuthSession = {
      sessionId: newSessionId(),
      accountId: request.accountId,
      role: request.role,
      provider: "sandbox",
      assurance: "sandbox_unverified",
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl).toISOString(),
    };
    write({ version: 1, session });
    return session;
  };

  return {
    provider: SANDBOX_AUTH_PROVIDER,

    restore(now): RestoreResult {
      const stored = read();
      if (stored.session) {
        if (Date.parse(stored.session.expiresAt) <= now) {
          const { accountId, sessionId } = stored.session;
          write({ version: 1, session: null, ended: "expired", endedAccountId: accountId, endedSessionId: sessionId });
          return { kind: "expired", accountId, sessionId, alreadyNoted: false };
        }
        return { kind: "authenticated", session: stored.session };
      }
      if (stored.ended === "expired") {
        return {
          kind: "expired",
          accountId: stored.endedAccountId ?? null,
          sessionId: stored.endedSessionId ?? null,
          alreadyNoted: true,
        };
      }
      return {
        kind: "signed_out",
        notice: stored.ended === "account_unavailable" ? ACCOUNT_UNAVAILABLE_MESSAGE : null,
      };
    },

    async signIn(request: SignInRequest, now) {
      return open(request, now);
    },

    switchAccount(request, now) {
      return open(request, now);
    },

    signOut(reason: SignOutReason) {
      write(
        reason === "account_unavailable"
          ? { version: 1, session: null, ended: "account_unavailable" }
          : { version: 1, session: null },
      );
    },

    markExpired() {
      const stored = read();
      write({
        version: 1,
        session: null,
        ended: "expired",
        ...(stored.session
          ? { endedAccountId: stored.session.accountId, endedSessionId: stored.session.sessionId }
          : {}),
      });
    },

    clearNotice() {
      const stored = read();
      if (stored.ended) write({ version: 1, session: stored.session });
    },
  };
}
