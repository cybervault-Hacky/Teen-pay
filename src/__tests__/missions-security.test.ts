import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUARDIAN_PERMISSIONS, MISSIONS, ROLE_PERMISSIONS, roleAllows, TEEN_SELF_PERMISSIONS } from "@/domain";
import { isProtectedRoute } from "@/lib/navigation";

/**
 * Money Missions security audit (Phase 11), as tests: missions can't
 * touch money, reach the network, pay rewards, nag, randomise, leak
 * ids or bypass auth — and the Coach, Activity and Money screens
 * don't depend on them.
 */

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Source without comments, so the audit checks code, not prose. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const UI_FILES = readdirSync(join(root, "components/missions")).map((f) => `components/missions/${f}`);
const PAGE_FILES = ["app/missions/page.tsx", "app/missions/[missionId]/page.tsx"];
const ENGINE_FILES = ["domain/mission.ts", "sandbox/missions.ts"];
const MISSION_FILES = [...ENGINE_FILES, ...PAGE_FILES, ...UI_FILES];

describe("Missions security audit", () => {
  it("covers every Missions file", () => {
    expect(UI_FILES.sort()).toEqual([
      "components/missions/mission-card.tsx",
      "components/missions/mission-detail.tsx",
      "components/missions/mission-notice.tsx",
      "components/missions/mission-parts.tsx",
      "components/missions/mission-screens.tsx",
      "components/missions/mission-step-panel.tsx",
      "components/missions/missions-content.tsx",
      "components/missions/missions-home-card.tsx",
      "components/missions/use-missions.ts",
    ]);
  });

  it("never writes money: no ledger, operations, wallets, Spaces or notifications from mission code", () => {
    for (const file of MISSION_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(
        /postOperation|\bpost\(|mergeScope|commit\(|localStorage|sessionStorage|indexedDB|repository|@\/sandbox\/(operations|engine|transitions|space-transitions|peer-transitions"|family-transitions|pocket-money)/,
      );
    }
    // The engine replaces one collection only.
    const engine = code("sandbox/missions.ts");
    expect(engine).not.toMatch(/\b(ledger|operations|wallets|spaces|notifications|peerRequests|teenRecords|contacts|accounts)\s*:/);
    expect(engine.match(/\.\.\.db,/g)).toHaveLength(1);
    expect(engine).toMatch(/return \{ \.\.\.db, missionProgress: \[\.\.\.others, record\] \};/);
    expect(engine).toMatch(/import type \{ PeerOutput \} from "\.\/peer-transitions";/); // a type, not the money transitions
  });

  it("the store exposes reads through readDb and writes through dispatchDb (the signed-in gate)", () => {
    const store = read("sandbox/store.tsx");
    expect(store).toMatch(/missionBoard: \(\) => readDb\(\(db, actorId\) => missionBoardFor\(db, actorId\)\)/);
    expect(store).toMatch(/missionDetail: \(missionId\) => readDb\(\(db, actorId\) => missionDetailFor\(db, actorId, missionId\)\)/);
    expect(store).toMatch(/startMission: \(missionId\) =>\s*dispatchDb\(\(db, actorId, at\) => startMissionTransition\(db, \{ actorId, at, missionId \}\)\)/);
    expect(store).toMatch(/advanceMission: \(missionId, stepId, answer\) =>\s*dispatchDb\(\(db, actorId, at\) =>\s*advanceMissionTransition\(/);
  });

  it("makes no network, analytics or AI calls", () => {
    for (const file of MISSION_FILES) {
      expect(code(file), file).not.toMatch(
        /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.|import\(|https?:\/\/|gtag|analytics|segment|mixpanel|openai|anthropic|gemini|\bllm\b/i,
      );
    }
  });

  it("the UI goes through store actions — never the raw ledger, selectors or scope", () => {
    for (const file of [...UI_FILES, ...PAGE_FILES]) {
      expect(code(file), file).not.toMatch(
        /@\/sandbox\/(selectors|engine|scope|missions|persistence)|listWalletEntries|\.ledger\b|state\.(ledger|wallets|operations|notifications|spaces)/,
      );
    }
    expect(code("components/missions/use-missions.ts")).toMatch(/actions\.missionBoard\(\)/);
    expect(code("components/missions/use-missions.ts")).toMatch(/actions\.missionDetail\(missionId\)/);
  });

  it("is deterministic: no randomness; the clock is explicit below the store", () => {
    for (const file of MISSION_FILES) {
      expect(code(file), file).not.toMatch(/Math\.random|crypto\.|makeId|uuid/);
    }
    for (const file of ENGINE_FILES) {
      expect(code(file), file).not.toMatch(/Date\.now\(|new Date\(\)/);
    }
  });

  it("no timers, countdowns, notifications, rewards, streaks or leaderboards", () => {
    for (const file of MISSION_FILES) {
      // The one allowed mention is the promise that there are none.
      const src = code(file).replace("They never move money, give rewards or change your limits", "");
      expect(src, file).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|Notification\b|serviceWorker|vibrate/);
      expect(src, file).not.toMatch(/streak|reward|leaderboard|confetti|countdown|points|\bxp\b|badge.?earned|loot|spin|jackpot/i);
    }
  });

  it("has no secrets, debug output, emoji or dangerous rendering", () => {
    for (const file of MISSION_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/console\.|debugger|process\.env|NEXT_PUBLIC|secret|api[_-]?key|password|token/i);
      expect(read(file), file).not.toMatch(/\p{Extended_Pictographic}/u);
      expect(src, file).not.toMatch(/dangerouslySetInnerHTML|innerHTML|eval\(|new Function|window\.location/);
    }
  });

  it("every mission link stays inside the app", () => {
    for (const m of MISSIONS) {
      for (const s of m.steps) {
        if ("href" in s) expect(s.href).toMatch(/^\/(activity|money|coach)\?mission=[a-z-]+$/);
      }
    }
  });

  it("shows no internal ids: the UI never renders account, wallet or record ids", () => {
    for (const file of UI_FILES) {
      expect(code(file), file).not.toMatch(/ownerAccountId|accountId|walletId|\.userId|usr_|wal_/);
    }
  });

  it("is teen-only: the permission, routes and pages", () => {
    expect(roleAllows("teen", "missions.use")).toBe(true);
    expect(roleAllows("parent", "missions.use")).toBe(false);
    expect(ROLE_PERMISSIONS.parent).not.toContain("missions.use");
    expect(TEEN_SELF_PERMISSIONS).toContain("missions.use");
    expect(GUARDIAN_PERMISSIONS).not.toContain("missions.use");
    expect(isProtectedRoute("/missions")).toBe(true);
    expect(isProtectedRoute("/missions/know-your-balance")).toBe(true);
    for (const page of PAGE_FILES) expect(read(page), page).toMatch(/<RoleGate role="teen">/);
    expect(code("sandbox/missions.ts")).toMatch(/authorize\(scope\.state, actorId, "missions\.use"\)/);
  });

  it("the Coach, Activity and Money screens don't depend on Missions", () => {
    const screens = [
      ...readdirSync(join(root, "components/coach")).map((f) => `components/coach/${f}`),
      "domain/coach.ts",
      "sandbox/coach.ts",
      "components/activity/activity-feed.tsx",
      "components/money/money-content.tsx",
    ];
    for (const file of screens) {
      expect(code(file), file).not.toMatch(/mission/i);
    }
  });

  it("persistence refuses unknown fields in stored progress", () => {
    const persistence = code("sandbox/persistence.ts");
    expect(persistence).toMatch(/function isMissionProgressRecord/);
    expect(persistence).toMatch(
      /return missionProgressIntegrity\(value\) && friendshipIntegrity\(value\) && shieldSettingsIntegrity\(value\);/,
    );
  });
});
