import type { UserRole } from "@/domain";

/**
 * Auth abstraction.
 *
 *   UI ──▶ useAuth() (AuthProvider) ──▶ AuthService ──▶ provider implementation
 *
 * Components only see `AuthStatus`, an `AuthSession` summary and a
 * few actions. They never see tokens, credentials or provider
 * internals. Today the only implementation is the sandbox service,
 * which is explicitly NOT real authentication: no passwords, no
 * verification, no tokens — just a labelled "Sandbox session" on this
 * device. A real provider would implement the same `AuthService`.
 */

export type AuthProviderId = "sandbox";

export interface AuthProviderInfo {
  id: AuthProviderId;
  /** What the UI calls it, e.g. "Sandbox session". */
  label: string;
  /** False for the sandbox. The UI must never imply otherwise. */
  isRealAuthentication: boolean;
  /** The sandbox has no credentials of any kind. */
  usesCredentials: boolean;
}

/**
 * How strongly the session's identity was established. The sandbox
 * establishes nothing: anyone on this device can pick an account.
 */
export type SessionAssurance = "sandbox_unverified";

export interface AuthSession {
  sessionId: string;
  accountId: string;
  /**
   * The role the session was opened for. Informational only —
   * permissions are always decided from the account record and
   * family memberships in the data, never from this field.
   */
  role: UserRole;
  provider: AuthProviderId;
  assurance: SessionAssurance;
  /** ISO 8601 timestamps. */
  createdAt: string;
  expiresAt: string;
}

/**
 *   restoring ─▶ signed_out ─▶ authenticating ─▶ authenticated ─▶ expired ─▶ (sign in again)
 *                    ▲                                 │
 *                    └──────────── sign out ───────────┘
 */
export type AuthStatus =
  | "restoring"
  | "signed_out"
  | "authenticating"
  | "authenticated"
  | "expired";

export type SignOutReason = "user" | "account_unavailable" | "reset";

export interface SandboxSignInRequest {
  method: "sandbox";
  accountId: string;
  role: UserRole;
}

export type SignInRequest = SandboxSignInRequest;

export interface AuthError {
  code: "sign_in_failed" | "unsupported_method";
  /** Safe to show verbatim. */
  message: string;
}

export type RestoreResult =
  | { kind: "authenticated"; session: AuthSession }
  | { kind: "expired"; accountId: string | null; sessionId: string | null; alreadyNoted: boolean }
  | { kind: "signed_out"; notice: string | null };

export interface AuthService {
  readonly provider: AuthProviderInfo;
  /** Reads any stored session and checks it against `now`. */
  restore(now: number): RestoreResult;
  signIn(request: SignInRequest, now: number): Promise<AuthSession | AuthError>;
  /**
   * Sandbox only: move this device's session to another sandbox
   * account immediately (the "Switch role" demo control). Real
   * providers leave this undefined.
   */
  switchAccount?(request: SandboxSignInRequest, now: number): AuthSession | AuthError;
  /** Clears the session (only the session — never account data). */
  signOut(reason: SignOutReason): void;
  /** Marks the current session expired (used by timers and "simulate"). */
  markExpired(): void;
  /** Forgets any "your session expired" / sign-out notice. */
  clearNotice(): void;
}

/** Things the auth layer tells the data layer about (for security events). */
export interface AuthEvent {
  type: "sign_in" | "sign_out" | "session_expired";
  accountId: string;
  sessionId: string;
  at: string;
}

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Please sign in again.";
export const ACCOUNT_UNAVAILABLE_MESSAGE =
  "That account isn't available on this device any more. Choose another account.";
