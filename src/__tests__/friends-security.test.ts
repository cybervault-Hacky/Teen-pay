import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GUARDIAN_PERMISSIONS, ROLE_PERMISSIONS, TEEN_SELF_PERMISSIONS } from "@/domain";
import { isProtectedRoute } from "@/lib/navigation";

/**
 * Friend Circles security audit (Phase 12), as tests: friendships can
 * never touch money, reach the network, randomise, track, leak ids,
 * build a directory or bypass auth — and the QR payload stays
 * identity-only.
 */

const root = join(__dirname, "..");
const read = (path: string) => readFileSync(join(root, path), "utf8");
/** Source without comments, so the audit checks code, not prose. */
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const UI_FILES = readdirSync(join(root, "components/friends")).map((f) => `components/friends/${f}`);
const PAGE_FILES = ["app/friends/page.tsx", "app/friends/[teenPayId]/page.tsx"];
const ENGINE_FILES = ["domain/friend.ts", "sandbox/friends.ts"];
const FRIEND_FILES = [...ENGINE_FILES, ...PAGE_FILES, ...UI_FILES];

describe("Friend Circles security audit", () => {
  it("covers every Friend Circle file", () => {
    expect(UI_FILES.sort()).toEqual([
      "components/friends/friend-detail.tsx",
      "components/friends/friends-client.tsx",
      "components/friends/friends-home-card.tsx",
      "components/friends/use-friends.ts",
    ]);
  });

  it("never writes money: no ledger, operations, wallets, Spaces, requests or schedules from friend code", () => {
    for (const file of FRIEND_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(
        /postOperation|mergeScope|localStorage|sessionStorage|indexedDB|@\/sandbox\/(operations|engine|transitions|space-transitions|allowance-transitions|peer-transitions(?!")|family-transitions)/,
      );
    }
    // The engine replaces exactly one collection per write.
    const engine = code("sandbox/friends.ts");
    expect(engine).not.toMatch(/\b(ledger|operations|wallets|spaces|peerRequests|teenRecords|contacts|accounts|families|pocketMoneySchedules)\s*:/);
    expect(engine.match(/\{ \.\.\.db, friendships/g)).toHaveLength(1);
    expect(engine).toMatch(/import type \{ PeerOutput \} from "\.\/peer-transitions";/); // a type, not the money transitions
  });

  it("notifications are only projected from events — never written by hand", () => {
    const engine = code("sandbox/friends.ts");
    expect(engine).toMatch(/notificationsForEvent/);
    expect(engine).not.toMatch(/kind:\s*"(money|goal|family|approval|safety|system)"/);
    expect(engine).not.toMatch(/ntf_/); // notification ids come from the projector
    const projector = code("sandbox/events.ts");
    expect(projector).toMatch(/case "friend_request_received":/);
    expect(projector).toMatch(/case "friend_request_accepted":/);
  });

  it("friend events stay out of the family log and financial Activity", () => {
    const src = read("domain/events.ts");
    const start = src.indexOf("FAMILY_EVENT_TYPES");
    const block = src.slice(start, src.indexOf("]", start));
    expect(block).not.toMatch(/friend/);
  });

  it("the store exposes reads through readDb and writes through dispatchDb (the signed-in gate)", () => {
    const store = read("sandbox/store.tsx");
    expect(store).toMatch(/friendCircle: \(\) => readDb\(\(db, actorId\) => friendCircleFor\(db, actorId\)\)/);
    expect(store).toMatch(/friendLookup: \(teenPayId\) => readDb\(\(db, actorId\) => friendLookup\(db, actorId, teenPayId\)\)/);
    expect(store).toMatch(/sendFriendRequest: \(teenPayId, requestId\) =>/);
    expect(store).toMatch(/dispatchDb\(\(db, actorId, at\) =>\s*sendFriendRequestTransition\(db, \{ actorId, at, teenPayId, requestId: key \}\)/);
    expect(store).toMatch(/acceptFriendRequest: \(friendshipId\) =>\s*dispatchDb\(\(db, actorId, at\) => acceptFriendRequestTransition\(db, \{ actorId, at, friendshipId \}\)\)/);
    expect(store).toMatch(/declineFriendRequest: \(friendshipId\) =>\s*dispatchDb\(\(db, actorId, at\) => declineFriendRequestTransition\(db, \{ actorId, at, friendshipId \}\)\)/);
    expect(store).toMatch(/cancelFriendRequest: \(friendshipId\) =>\s*dispatchDb\(\(db, actorId, at\) => cancelFriendRequestTransition\(db, \{ actorId, at, friendshipId \}\)\)/);
    expect(store).toMatch(/removeFriend: \(teenPayId\) =>\s*dispatchDb\(\(db, actorId, at\) => removeFriendTransition\(db, \{ actorId, at, teenPayId \}\)\)/);
  });

  it("makes no network, analytics or AI calls", () => {
    for (const file of FRIEND_FILES) {
      expect(code(file), file).not.toMatch(
        /\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|navigator\.|import\(|https?:\/\/|gtag|analytics|segment|mixpanel|openai|anthropic|gemini|\bllm\b/i,
      );
    }
  });

  it("is deterministic: no randomness, no clock reads below the store", () => {
    for (const file of FRIEND_FILES) {
      expect(code(file), file).not.toMatch(/Math\.random|crypto\.random|Date\.now\(\)|new Date\(/);
    }
  });

  it("has no secrets, debug output or emoji", () => {
    for (const file of FRIEND_FILES) {
      const src = code(file);
      expect(src, file).not.toMatch(/console\.|debugger|process\.env|NEXT_PUBLIC|secret|api[_-]?key|password|token/i);
      expect(read(file), file).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("is teen-only: the permission, routes and pages", () => {
    expect(ROLE_PERMISSIONS.teen).toContain("friends.use");
    expect(ROLE_PERMISSIONS.parent).not.toContain("friends.use");
    expect(GUARDIAN_PERMISSIONS).not.toContain("friends.use");
    expect(TEEN_SELF_PERMISSIONS).toContain("friends.use");
    for (const route of ["/friends", "/friends/meera"]) {
      expect(isProtectedRoute(route)).toBe(true);
    }
    for (const page of PAGE_FILES) {
      expect(read(page)).toMatch(/<RoleGate role="teen">/);
    }
  });

  it("is a private layer: no directory, no public profiles, no harvesting", () => {
    const engine = code("sandbox/friends.ts");
    // Discovery is one exact TeenPay ID at a time — no broad listing.
    expect(engine).not.toMatch(/\.accounts\.filter\(/);
    for (const file of FRIEND_FILES) {
      expect(code(file), file).not.toMatch(/people you may know|invite your|suggested|discover|trending|leaderboard|streak/i);
    }
    // The friends list never renders a search-all control.
    expect(code("components/friends/friends-client.tsx")).not.toMatch(/searchPeers/);
  });

  it("the UI goes through store actions and context — never raw data", () => {
    for (const file of [...UI_FILES, ...PAGE_FILES]) {
      expect(code(file), file).not.toMatch(
        /@\/sandbox\/(selectors|engine|scope|friends|persistence|peer)|\.ledger\b|state\.(ledger|wallets|operations|notifications|spaces)/,
      );
    }
    expect(code("components/friends/use-friends.ts")).toMatch(/useSandbox\(\)/);
  });

  it("keeps the QR payload identity-only — no friendship data in QR code paths", () => {
    for (const file of ["domain/qr.ts", "sandbox/qr.ts", "lib/qr-matrix.ts"]) {
      expect(code(file), file).not.toMatch(/friend|frd_/i);
    }
  });

  it("never exposes the other account's ids: views carry profile data only", () => {
    const domain = code("domain/friend.ts");
    expect(domain).toMatch(/interface FriendView extends PeerProfile/);
    expect(domain).toMatch(/interface FriendRequestView extends PeerProfile/);
    expect(domain).not.toMatch(/otherAccountId|counterpartyId/);
    const engine = code("sandbox/friends.ts");
    expect(engine).not.toMatch(/otherAccountId|counterpartyId/);
  });
});
