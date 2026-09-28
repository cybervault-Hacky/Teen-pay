import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * TeenPay ID static security audit (Phase 13). Reads the identity
 * source files and pins the invariants code review alone can't hold:
 * the engine writes only the account alias, projections never spread
 * accounts, the UI goes through store actions, clipboard/share carry
 * only the handle, URLs never carry internal ids, and the permission
 * is teen-only.
 */

const ROOT = join(__dirname, "..");

const IDENTITY_FILES = [
  "domain/identity.ts",
  "sandbox/teenpay-id.ts",
  "components/identity/use-identity-actions.ts",
  "components/identity/identity-card.tsx",
  "components/identity/change-id-modal.tsx",
  "components/identity/identity-client.tsx",
  "components/identity/identity-detail.tsx",
  "app/id/page.tsx",
  "app/id/[teenPayId]/page.tsx",
] as const;

const read = (file: string) => readFileSync(join(ROOT, file), "utf8");

/** Source without comments/strings would over-match URLs and copy; audit raw source. */
const code = read;

describe("TeenPay ID security audit", () => {
  it("the engine writes only the account alias — one replace, nothing else", () => {
    const engine = code("sandbox/teenpay-id.ts");
    expect(engine).toMatch(/\{\s*\.\.\.db,\s*accounts: db\.accounts\.map\(/);
    expect(engine.match(/\.\.\.db,\s*accounts:/g)).toHaveLength(1);
    for (const forbidden of [
      /\bledger\s*:/,
      /\bwallets\s*:/,
      /\boperations\s*:/,
      /\bspaces\s*:/,
      /\bpeerRequests\s*:/,
      /\bcontacts\s*:/,
      /\bfriendships\s*:/,
      /\bnotifications\s*:/,
      /\bmissionProgress\s*:/,
      /\bpocketMoneySchedules\s*:/,
    ]) {
      expect(engine, `engine writes ${forbidden}`).not.toMatch(forbidden);
    }
    expect(engine).not.toMatch(/postOperation\(|depositDraft\(|appendSecurityEvents\(|from "\.\/operations"/);
  });

  it("projections are built field-by-field — accounts are never spread into views", () => {
    const engine = code("sandbox/teenpay-id.ts");
    // IdentityProfile values come from peerProfileOf / relationOf / isFavourite.
    expect(engine).toMatch(/peerProfileOf\(account\)/);
    expect(engine).toMatch(/relationOf\(db, viewerId, account\.id\)/);
    expect(engine).toMatch(/isFavourite\(db, viewerId, username\)/);
    // No account record is spread into a returned projection value.
    expect(engine).not.toMatch(/value:\s*\{[\s\S]{0,240}\.\.\.account/);
    // Type-only import of the public profile shape.
    expect(engine).toMatch(/type IdentityProfile/);
  });

  it("lookup refuses internal-id input before any resolution", () => {
    const engine = code("sandbox/teenpay-id.ts");
    expect(engine).toMatch(/parseTeenPayId\(raw\)/);
    const peer = code("sandbox/peer.ts");
    expect(peer).toMatch(/looksLikeInternalId\(candidate\)/);
  });

  it("identity files contain no network, storage, analytics, AI or randomness", () => {
    for (const file of IDENTITY_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/\bfetch\(|XMLHttpRequest|axios|WebSocket|localStorage|sessionStorage/);
      expect(src, file).not.toMatch(/analytics|posthog|mixpanel|amplitude|telemetry/i);
      expect(src, file).not.toMatch(/Math\.random|crypto\.randomUUID|uuid\(\)/);
      expect(src, file).not.toMatch(/\bopenai|langchain|gpt|llm\b/i);
      expect(src, file).not.toMatch(/console\.(log|warn|error|info|debug)/);
    }
  });

  it("has no secrets, debug output or emoji", () => {
    for (const file of IDENTITY_FILES) {
      const src = read(file);
      expect(src, file).not.toMatch(/api[_-]?key|secret|token|password/i);
      expect(src, file).not.toMatch(/sk-[A-Za-z0-9]{8,}/);
      expect(src, file).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("the UI goes through store actions and domain types — never raw data", () => {
    const uiFiles = IDENTITY_FILES.filter((f) => f.startsWith("components/identity"));
    for (const file of uiFiles) {
      const src = code(file);
      expect(src, file).not.toMatch(
        /@\/sandbox\/(selectors|engine|scope|persistence|peer|friends|contacts|teenpay-id|operations)/,
      );
      expect(src, file).not.toMatch(/\.accounts\b|\.ledger\b|\.wallets\b|\.peerRequests\b|\.contacts\b/);
    }
  });

  it("clipboard and share carry only the handle", () => {
    const hook = code("components/identity/use-identity-actions.ts");
    expect(hook).toMatch(/navigator\.clipboard\.writeText\(handle\)/);
    expect(hook).not.toMatch(/writeText\((?!handle)/);
    expect(hook).toMatch(/text: `Pay or request from me on TeenPay \(sandbox\): \$\{handle\}`/);
    expect(hook).not.toMatch(/usr_|wal_|\.id\b/);
    // No other identity component touches clipboard or share directly.
    for (const file of ["identity-card.tsx", "change-id-modal.tsx", "identity-client.tsx", "identity-detail.tsx"]) {
      const src = code(`components/identity/${file}`);
      expect(src, file).not.toMatch(/navigator\.clipboard|navigator\.share/);
    }
  });

  it("URLs carry TeenPay IDs only — validated, never internal ids", () => {
    const detail = code("components/identity/identity-detail.tsx");
    expect(detail).toMatch(/isValidTeenPayIdFormat\(teenPayId\)/);
    expect(detail).toMatch(/looksLikeInternalId\(teenPayId\)/);
    // Every dynamic link uses the public handle from the projection.
    for (const href of detail.match(/href=\{`[^`]+`\}/g) ?? []) {
      expect(href).not.toMatch(/usr_|wal_|accountId|\.id\}/);
    }
    const page = code("app/id/[teenPayId]/page.tsx");
    expect(page).toMatch(/decodeURIComponent\(teenPayId\)/);
    expect(page).toMatch(/RoleGate role="teen"/);
    expect(code("app/id/page.tsx")).toMatch(/RoleGate role="teen"/);
    expect(read("lib/navigation.ts")).toMatch(/"\/id"/);
  });

  it("the store wires identity through the single read/dispatch paths", () => {
    const store = code("sandbox/store.tsx");
    expect(store).toMatch(/checkTeenPayId: \(teenPayId\) =>\s*readDb\(\(db, actorId\) => checkTeenPayIdAvailability\(db, actorId, teenPayId\)\)/);
    expect(store).toMatch(/identitySearch: \(teenPayId\) => readDb\(\(db, actorId\) => identityProfileFor\(db, actorId, teenPayId\)\)/);
    expect(store).toMatch(/changeTeenPayId: \(teenPayId\) =>\s*dispatchDb\(\(db, actorId, at\) => changeTeenPayIdTransition\(db, \{ actorId, at, teenPayId \}\)\)/);
  });

  it("identity.use is a teen-only permission", () => {
    const permissions = code("domain/permissions.ts");
    expect(permissions).toMatch(/"identity\.use"/);
    const teenBlock = permissions.slice(permissions.indexOf("teen: ["), permissions.indexOf("parent: ["));
    expect(teenBlock).toMatch(/"identity\.use"/);
    const parentStart = permissions.indexOf("parent: [");
    const parentBlock = permissions.slice(parentStart, permissions.indexOf("};", parentStart));
    expect(parentBlock).not.toMatch(/"identity\.use"/);
    const authorization = code("sandbox/authorization.ts");
    expect(authorization).toMatch(/TEEN_SELF_PERMISSIONS/);
    expect(code("domain/permissions.ts")).toMatch(/TEEN_SELF_PERMISSIONS[\s\S]*"identity\.use"/);
  });

  it("persisted usernames are validated as untrusted input", () => {
    const persistence = code("sandbox/persistence.ts");
    expect(persistence).toMatch(/isValidTeenPayIdFormat/);
  });

  it("reserved IDs stay centralized in one list", () => {
    const identity = code("domain/identity.ts");
    expect(identity).toMatch(/export const RESERVED_TEENPAY_IDS/);
    // No second scattered reserved list anywhere.
    expect(code("domain/account.ts")).not.toMatch(/RESERVED_USERNAMES/);
    expect(code("sandbox/accounts.ts")).not.toMatch(/RESERVED_USERNAMES/);
  });
});
