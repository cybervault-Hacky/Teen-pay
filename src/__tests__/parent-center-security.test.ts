import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isProtectedRoute } from "@/lib/navigation";
import { selectParentCenter, selectTeenCenter } from "@/sandbox/parent-center";
import { SEED_PARENT_ID, SEED_TEEN_ID } from "@/sandbox/seed";
import { linkedState } from "./helpers/fixtures";

/**
 * Parent Control Center security audit (Phase 15), as tests: the
 * center is a management surface over the existing engines. It never
 * writes money itself, never bypasses authorization, never reaches
 * outside the family link, and its projection carries nothing
 * teen-private. Static checks run on comment-stripped source.
 */

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Source without comments, so the audit checks code, not prose. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const UI_FILES = readdirSync(join(root, "components/parent")).map(
  (f) => `components/parent/${f}`,
);
const PROJECTION = "sandbox/parent-center.ts";
const PAGE = "app/parent/page.tsx";
const CENTER_FILES = [...UI_FILES, PROJECTION, PAGE];

describe("parent center security audit — file inventory", () => {
  it("covers every control-center file", () => {
    expect(UI_FILES.sort()).toEqual([
      "components/parent/parent-content.tsx",
      "components/parent/parent-controls.tsx",
      "components/parent/parent-family-card.tsx",
      "components/parent/rule-field.tsx",
      "components/parent/send-pocket-money.tsx",
      "components/parent/spending-rules-form.tsx",
    ]);
    expect(read(PROJECTION)).toContain("selectTeenCenter");
    expect(read(PAGE)).toContain("RoleGate");
  });
});

describe("parent center security audit — no money writes from the center", () => {
  it("imports no transition machinery in the UI layer", () => {
    for (const file of UI_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(
        /from "@\/sandbox\/(peer-transitions|transitions|allowance-transitions|family-transitions|operations)"/,
      );
      expect(src, file).not.toMatch(/postOperation|writeLedger|appendLedger/);
    }
  });

  it("the projection is read-only: no imports of engines, no mutations", () => {
    const src = code(PROJECTION);
    expect(src).not.toMatch(/from "\.\/(peer-transitions|transitions|allowance-transitions|family-transitions|operations|engine|accounts|store)"/);
    expect(src).not.toMatch(/\.push\(/);
    expect(src).not.toMatch(/\bstate\.[a-zA-Z]+\s*=/);
    expect(src).not.toMatch(/localStorage|sessionStorage/);
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
  });

  it("no file in the center writes storage or the network directly", () => {
    for (const file of CENTER_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/localStorage\.setItem|sessionStorage\.setItem/);
      expect(src, file).not.toMatch(/fetch\(|XMLHttpRequest|navigator\.sendBeacon/);
    }
  });

  it("approval decisions are never fabricated in the UI", () => {
    for (const file of CENTER_FILES) {
      const src = code(file);
      // A decision's status is produced by the engine, never assembled here.
      expect(src, file).not.toMatch(/status:\s*"(approved|declined)"/);
    }
  });
});

describe("parent center security audit — authorization is never bypassed", () => {
  it("no role-string gate stands in for the engine", () => {
    for (const file of CENTER_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/role\s*===?\s*["']parent["']/);
    }
  });

  it("the route stays protected", () => {
    expect(isProtectedRoute("/parent")).toBe(true);
  });

  it("the projection re-checks the family link on every call", () => {
    const state = linkedState();
    // Linked guardian: allowed.
    expect(selectTeenCenter(state, SEED_PARENT_ID, SEED_TEEN_ID)).not.toBeNull();
    // Anyone else, any other teen id: nothing — not even a shape.
    expect(selectTeenCenter(state, SEED_TEEN_ID, SEED_TEEN_ID)).toBeNull();
    expect(selectTeenCenter(state, "usr_someone_else", SEED_TEEN_ID)).toBeNull();
    expect(selectParentCenter(state, SEED_TEEN_ID)).toBeNull();
    expect(selectParentCenter(state, "usr_someone_else")).toBeNull();
  });
});

describe("parent center security audit — nothing teen-private in the vocabulary", () => {
  it("the projection never reads private stores", () => {
    const src = code(PROJECTION);
    for (const forbidden of [
      "coach",
      "mission",
      "friend",
      "shield",
      "qr",
      "search",
      "notifications",
      "contacts",
      "securityEvents",
    ]) {
      expect(src, forbidden).not.toContain(forbidden);
    }
  });

  it("raw account objects are never spread into the view", () => {
    const src = code(PROJECTION);
    expect(src).not.toMatch(/\{\s*\.\.\.(user|teen|account|wallet|entry)\b/);
  });
});
