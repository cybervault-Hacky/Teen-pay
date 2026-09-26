/**
 * User & family domain.
 *
 * TeenPay is a *family* product: a teen is never modelled as a generic
 * adult banking user. Teens belong to a family with at least one
 * parent/guardian who can fund, guide and set guardrails.
 *
 * Phase 1: types only. No auth, KYC or guardian verification yet —
 * those arrive with the backend in later phases.
 */

export type UserId = string;
export type FamilyId = string;

export type UserKind = "teen" | "parent";

/** Verification state of a parent/guardian (future backend concern). */
export type GuardianVerification = "unverified" | "pending" | "verified";

interface BaseProfile {
  id: UserId;
  kind: UserKind;
  displayName: string;
  /** Avatar seed — initials are derived, no photos in Phase 1. */
  avatarSeed: string;
  familyId: FamilyId;
  createdAt: string;
}

/** A teenager on TeenPay. Cannot link a bank account directly. */
export interface TeenProfile extends BaseProfile {
  kind: "teen";
  /** Birth year only — never store full DOB client-side. */
  birthYear: number;
  /** Whether a verified guardian has approved the account. */
  guardianApproved: boolean;
}

/** A parent or legal guardian. Funds teens and sets guardrails. */
export interface ParentProfile extends BaseProfile {
  kind: "parent";
  relationship: "mother" | "father" | "guardian";
  guardianVerification: GuardianVerification;
}

export type User = TeenProfile | ParentProfile;

export function isTeen(user: User): user is TeenProfile {
  return user.kind === "teen";
}

export function isParent(user: User): user is ParentProfile {
  return user.kind === "parent";
}

/** A family links teens with their parents/guardians. */
export interface Family {
  id: FamilyId;
  name: string;
  teenIds: UserId[];
  parentIds: UserId[];
  createdAt: string;
}

/** Aggregated view the UI renders (replaces N+1 fetches later). */
export interface Household {
  family: Family;
  teens: TeenProfile[];
  parents: ParentProfile[];
}
