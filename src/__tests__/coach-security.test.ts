import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Money Coach security audit (Phase 10), as tests: the Coach code
 * can't write, can't reach the network, doesn't read the raw ledger
 * from the UI, isn't random and carries no secrets or debug output.
 */

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Source without comments, so the audit checks code, not prose. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const UI_FILES = readdirSync(join(root, "components/coach")).map((f) => `components/coach/${f}`);
const COACH_FILES = ["domain/coach.ts", "sandbox/coach.ts", "app/coach/page.tsx", ...UI_FILES];

describe("Coach security audit", () => {
  it("covers every Coach file", () => {
    expect(UI_FILES.sort()).toEqual([
      "components/coach/coach-content.tsx",
      "components/coach/coach-goals.tsx",
      "components/coach/coach-home-card.tsx",
      "components/coach/insight-card.tsx",
      "components/coach/period-selector.tsx",
      "components/coach/spending-compare.tsx",
      "components/coach/use-coach.ts",
    ]);
  });

  it("has no write path: no postOperation, transitions, dispatch, merges or storage", () => {
    for (const file of COACH_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(
        /postOperation|\bpost\(|Transition\b|Transition\(|dispatch|mergeScope|commit\(|localStorage|sessionStorage|indexedDB|repository|\.push\(\s*\{\s*id:\s*`ntf/,
      );
    }
    // The store exposes the Coach through the read-only gate only.
    const store = read("sandbox/store.tsx");
    expect(store).toMatch(/coachReport: \(period\) =>\s*readDb\(\(db, actorId\) => coachReportFor\(db, actorId, period, new Date\(\)\.toISOString\(\)\)\)/);
  });

  it("makes no network, analytics or AI calls", () => {
    for (const file of COACH_FILES) {
      expect(code(file), file).not.toMatch(
        /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.|import\(|https?:\/\/|gtag|analytics|segment|mixpanel|openai|anthropic|gemini|\bllm\b/i,
      );
    }
  });

  it("the UI never reads the raw ledger or selectors directly", () => {
    for (const file of UI_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/@\/sandbox\/(selectors|engine|scope|coach)|listWalletEntries|\.ledger\b|state\.(ledger|wallets|operations|notifications)/);
    }
    expect(code("components/coach/use-coach.ts")).toMatch(/actions\.coachReport\(period\)/);
  });

  it("is deterministic: no randomness; the clock is explicit below the store", () => {
    for (const file of COACH_FILES) {
      expect(code(file), file).not.toMatch(/Math\.random|crypto\.|makeId|uuid/);
    }
    for (const file of ["domain/coach.ts", "sandbox/coach.ts"]) {
      expect(code(file), file).not.toMatch(/Date\.now\(|new Date\(\)/);
    }
  });

  it("has no secrets, debug output or emoji; no score", () => {
    for (const file of COACH_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/console\.|debugger|process\.env|NEXT_PUBLIC|secret|api[_-]?key|password|token/i);
      expect(read(file), file).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(src, file).not.toMatch(/financial health|health score|credit score/i);
    }
  });

  it("/coach is a protected, teen-only route", () => {
    expect(read("lib/navigation.ts")).toMatch(/PROTECTED_ROUTES = \[[\s\S]*"\/coach",[\s\S]*\] as const;/);
    expect(read("app/coach/page.tsx")).toMatch(/<RoleGate role="teen">/);
  });
});
