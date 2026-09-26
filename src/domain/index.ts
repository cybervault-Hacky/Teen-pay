/**
 * Domain barrel — every product concept lives in exactly one module.
 * Import from `@/domain` (or the specific module) — never redefine
 * these types in components.
 */

export * from "./user";
export * from "./wallet";
export * from "./ledger";
export * from "./transactions";
export * from "./payments";
export * from "./requests";
export * from "./goals";
export * from "./safety";
export * from "./notifications";
