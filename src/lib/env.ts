/**
 * Environment conventions.
 *
 * - Never read `process.env` directly in components — go through this module.
 * - Only `NEXT_PUBLIC_*` values are visible in the browser; never put
 *   secrets behind that prefix (see `.env.example`).
 * - Phase 1 runs entirely on mock data; these flags keep that explicit.
 */

export type AppEnv = "development" | "preview" | "production";

function readPublic(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

export const env = {
  /** Deployment environment label (never a secret). */
  appEnv: (readPublic("NEXT_PUBLIC_APP_ENV", "development") || "development") as AppEnv,
  /** Phase 1: the UI renders controlled mock data. Always true for now. */
  useMockData: readPublic("NEXT_PUBLIC_MOCK_DATA", "true") !== "false",
} as const;

export const isMockMode = (): boolean => env.useMockData;
