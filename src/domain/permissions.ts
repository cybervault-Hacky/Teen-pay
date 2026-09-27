import type { UserRole } from "./user";

/**
 * Domain: permissions — a small, typed vocabulary of what each
 * role may do. Roles grant permissions; family membership decides
 * *whose* data a permission applies to. Both are checked in the
 * data layer (`sandbox/authorization.ts`), never only in the UI.
 */
export type Permission =
  // Teen — their own money
  | "money.view_own"
  | "payments.initiate"
  | "requests.create"
  | "savings.move"
  /** Create, edit and archive one's own Money Spaces. */
  | "spaces.manage"
  | "approvals.cancel_own"
  | "family.view_rules"
  | "family.invite_guardian"
  | "wallet.freeze_own"
  | "payments.simulate_refund"
  /** Phase 9: keep one's own favourites (convenience only — never authority). */
  | "contacts.manage"
  /** Phase 11: work through one's own Money Missions (learning progress only — never money). */
  | "missions.use"
  // Guardian — a connected teen's money
  | "family.join"
  | "teen.view_overview"
  | "rules.manage"
  | "allowance.send"
  | "allowance.schedule"
  | "approvals.decide"
  | "wallet.manage_teen"
  // Either side of a link
  | "family.disconnect";

export const ROLE_PERMISSIONS: Record<UserRole, readonly Permission[]> = {
  teen: [
    "money.view_own",
    "payments.initiate",
    "requests.create",
    "savings.move",
    "spaces.manage",
    "approvals.cancel_own",
    "family.view_rules",
    "family.invite_guardian",
    "wallet.freeze_own",
    "payments.simulate_refund",
    "contacts.manage",
    "missions.use",
    "family.disconnect",
  ],
  parent: [
    "family.join",
    "teen.view_overview",
    "rules.manage",
    "allowance.send",
    "allowance.schedule",
    "approvals.decide",
    "wallet.manage_teen",
    "family.disconnect",
  ],
};

/** Does the role grant this permission at all? (Scope is separate.) */
export function roleAllows(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

/** Permissions that act on a teen's own wallet (actor must be that teen). */
export const TEEN_SELF_PERMISSIONS: readonly Permission[] = [
  "money.view_own",
  "payments.initiate",
  "requests.create",
  "savings.move",
  "spaces.manage",
  "approvals.cancel_own",
  "family.view_rules",
  "family.invite_guardian",
  "wallet.freeze_own",
  "payments.simulate_refund",
  "contacts.manage",
  "missions.use",
];

/** Permissions that need an active, linked guardian of the teen. */
export const GUARDIAN_PERMISSIONS: readonly Permission[] = [
  "teen.view_overview",
  "rules.manage",
  "allowance.send",
  "allowance.schedule",
  "approvals.decide",
  "wallet.manage_teen",
];
