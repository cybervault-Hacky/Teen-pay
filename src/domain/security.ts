/**
 * Domain: security events — a lightweight, account-scoped record of
 * sign-ins and family access changes. Not an audit system: it keeps
 * a short, human-readable history for the account holder.
 */
export type SecurityEventType =
  | "account_created"
  | "sign_in"
  | "sign_out"
  | "session_expired"
  | "account_deletion_requested"
  | "account_deletion_cancelled"
  | "family_invite_created"
  | "family_member_linked"
  | "family_member_removed";

export interface SecurityEvent {
  id: string;
  type: SecurityEventType;
  /** The account this event belongs to. */
  accountId: string;
  /** ISO 8601 timestamp. */
  at: string;
  /** Sandbox session id, for sign-in/out/expiry. */
  sessionId?: string;
}

/** How many security events are kept per database. */
export const SECURITY_EVENT_LIMIT = 200;

export function describeSecurityEvent(type: SecurityEventType): string {
  switch (type) {
    case "account_created":
      return "Sandbox account created";
    case "sign_in":
      return "Signed in (sandbox session)";
    case "sign_out":
      return "Signed out";
    case "session_expired":
      return "Session expired";
    case "account_deletion_requested":
      return "Account deletion requested";
    case "account_deletion_cancelled":
      return "Deletion request withdrawn";
    case "family_invite_created":
      return "Family invite created";
    case "family_member_linked":
      return "Family member connected";
    case "family_member_removed":
      return "Family member disconnected";
  }
}
