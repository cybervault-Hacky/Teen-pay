/**
 * Environment conventions.
 *
 * - Never read `process.env` directly in components — go through this module.
 * - Only `NEXT_PUBLIC_*` values are visible in the browser; never put
 *   secrets behind that prefix (see `.env.example`).
 * - Phase 2 runs a local sandbox ledger; no backend flags exist yet.
 */

export type AppEnv = "development" | "preview" | "production";

function readPublic(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const env = {
  /** Deployment environment label (never a secret). */
  appEnv: (readPublic("NEXT_PUBLIC_APP_ENV", "development") || "development") as AppEnv,
} as const;
