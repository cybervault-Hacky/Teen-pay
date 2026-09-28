import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ROLE_PERMISSIONS, TEEN_SELF_PERMISSIONS } from "@/domain";
import { isProtectedRoute } from "@/lib/navigation";
import { updateShieldSettingsTransition } from "@/sandbox/shield";
import { SEED_TEEN_ID, buildSeedDatabase } from "@/sandbox/seed";

/**
 * Teen Safety Shield security audit (Phase 14), as tests: the shield
 * never writes money, never scores, never labels, never notifies,
 * never tracks, never bypasses authorization — and its one write path
 * stores nothing but the teen's own optional reminders.
 */

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Source without comments, so the audit checks code, not prose. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const UI_FILES = readdirSync(join(root, "components/safety-shield")).map(
  (f) => `components/safety-shield/${f}`,
);
const PAGE_FILES = ["app/safety/page.tsx"];
const ENGINE_FILES = ["domain/shield.ts", "sandbox/shield.ts"];
const SHIELD_FILES = [...ENGINE_FILES, ...PAGE_FILES, ...UI_FILES];

/** Words that would turn context into a verdict. */
const SCORE_WORDS = /\b(score|risk|fraud|scam|suspicious|blacklist|danger(ous)?|unsafe|trust(worthy)?)\b/i;

describe("Shield security audit — file inventory", () => {
  it("covers every Safety Shield file", () => {
    expect(UI_FILES.sort()).toEqual(["components/safety-shield/shield-card.tsx", "components/safety-shield/shield-page.tsx"]);
    expect(PAGE_FILES).toEqual(["app/safety/page.tsx"]);
  });
});

describe("Shield security audit — no money writes, ever", () => {
  it("imports no payment, ledger, operation or transition machinery", () => {
    for (const file of SHIELD_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/from "(\.|\.\.)\/?(operations|peer-transitions|transitions|space-transitions|family-transitions)"/);
      expect(src, file).not.toMatch(/postOperation|writeLedger|appendLedger|transferDraft|paymentDraft/);
    }
  });

  it("the engine's only db mutation is db.shieldSettings", () => {
    const src = code("sandbox/shield.ts");
    for (const key of ["ledger", "accounts", "wallets", "operations", "peerRequests", "friendships", "contacts", "missionProgress", "securityEvents"]) {
      expect(src, key).not.toMatch(new RegExp(`\\.${key}\\s*[:=]`));
      expect(src, key).not.toMatch(new RegExp(`${key}:\\s*[^,}\\n].*db\\.${key}`));
    }
    // The single write path, and it writes exactly one key.
    const writes = src.match(/\{ \.\.\.db, [a-zA-Z]+:/g) ?? [];
    expect(writes).toEqual(["{ ...db, shieldSettings:"]);
  });

  it("even a settings update leaves every money structure byte-identical", () => {
    const db = buildSeedDatabase();
    const out = updateShieldSettingsTransition(db, {
      actorId: SEED_TEEN_ID,
      at: "2026-09-26T09:00:00Z",
      patch: { largePayments: false, firstTimeRecipient: false, repeatedPayments: false },
    });
    if (!out.result.ok) throw new Error("setup failed");
    for (const key of ["ledger", "accounts", "wallets", "operations", "peerRequests", "friendships", "contacts", "missionProgress", "securityEvents"] as const) {
      expect(JSON.stringify(out.db[key]), key).toBe(JSON.stringify(db[key]));
    }
    expect(out.db).not.toBe(db);
  });
});

describe("Shield security audit — no scores, labels, notifications or tracking", () => {
  it("no score, ranking or label vocabulary anywhere in shield code", () => {
    for (const file of SHIELD_FILES) {
      expect(code(file), file).not.toMatch(SCORE_WORDS);
    }
  });

  it("emits no notifications and records no events", () => {
    for (const file of SHIELD_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/from ".*notifications|notify|pushNotification/);
      expect(src, file).not.toMatch(/recordSecurityEvent|SecurityEvent|securityEvents/);
      expect(src, file).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon|analytics/);
    }
  });

  it("stores no history of checks — the engine never appends to stored data", () => {
    const src = code("sandbox/shield.ts");
    // Local reason lists may grow; stored arrays never do.
    expect(src).not.toMatch(/db\.\w+\.push\(/);
    expect(src).not.toMatch(/\.set\(|\.add\(/);
  });
});

describe("Shield security audit — authorization intact", () => {
  it("every entry point goes through the shield scope (authorize + shield.use)", () => {
    const src = code("sandbox/shield.ts");
    expect(src).toMatch(/authorize\(scope\.state, actorId, "shield\.use"\)/);
    // One gate per public entry point: 3 assessments + 1 settings write.
    expect(src.match(/shieldScope\(db,/g)).toHaveLength(4);
  });

  it("shield.use is a teen permission only", () => {
    expect(ROLE_PERMISSIONS.teen).toContain("shield.use");
    expect(TEEN_SELF_PERMISSIONS).toContain("shield.use");
    expect(ROLE_PERMISSIONS.parent).not.toContain("shield.use");
  });

  it("the shield can only downgrade its own optional confirms — levels have no 'block'", () => {
    const src = code("domain/shield.ts");
    expect(src).toMatch(/export type ShieldLevel = "notice" \| "confirm"/);
    expect(src).not.toMatch(/"block"/);
    expect(src).not.toMatch(/level:\s*"(?!notice|confirm)/);
  });

  it("applyShieldSettings never strengthens an assessment", () => {
    const src = code("domain/shield.ts");
    expect(src).toMatch(/level !== "confirm"\) return reason/);
    expect(src).not.toMatch(/level:\s*"confirm" as ShieldLevel/);
  });
});

describe("Shield security audit — routes and UI", () => {
  it("/safety is a protected route", () => {
    expect(isProtectedRoute("/safety")).toBe(true);
  });

  it("the page is teen-only behind the role gate", () => {
    const src = read("app/safety/page.tsx");
    expect(src).toMatch(/<RoleGate role="teen">/);
  });

  it("the shield card informs only — no actions, no links, no dialogs", () => {
    const src = code("components/safety-shield/shield-card.tsx");
    expect(src).not.toMatch(/<Button|<Link|href=|onClick=|<Modal/);
  });

  it("QR scanning keeps its verify-first guidance", () => {
    const src = read("components/qr/scan-client.tsx");
    expect(src).toContain("Verify the TeenPay ID before continuing");
  });

  it("the safety page lists required protections as facts and toggles as optional", () => {
    const src = read("components/safety-shield/shield-page.tsx");
    expect(src).toContain("Always on");
    expect(src).toMatch(/can't be switched off/);
    expect(src).toMatch(/Optional reminders/);
    expect(src).toMatch(/no scoring, no background watching/);
  });
});

describe("Shield security audit — persistence validation", () => {
  it("the schema validator knows the shieldSettings shape", () => {
    const src = code("sandbox/persistence.ts");
    expect(src).toMatch(/isShieldSettingsRecord/);
    expect(src).toMatch(/shieldSettingsIntegrity/);
    expect(src).toMatch(/role !== "teen"/);
  });
});
