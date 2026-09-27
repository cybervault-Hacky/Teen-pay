/**
 * Domain layer — public boundary.
 *
 * Everything about the product's financial world is defined here:
 * users, families, wallets, Money Spaces (Save, goals, custom),
 * transactions,
 * recipients, payments, requests, the ledger, guardian controls,
 * approvals, domain events, and notifications. UI code imports from `@/domain`, never from
 * deeper places, so a future backend can be added without
 * touching the screens.
 */
export * from "./user";
export * from "./family";
export * from "./wallet";
export * from "./space";
export * from "./transaction";
export * from "./recipient";
export * from "./request";
export * from "./ledger";
export * from "./safety";
export * from "./allowance";
export * from "./approval";
export * from "./events";
export * from "./notification";
export * from "./account";
export * from "./permissions";
export * from "./security";
export * from "./money";
