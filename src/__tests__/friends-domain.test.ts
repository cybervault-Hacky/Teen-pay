import { describe, expect, it } from "vitest";
import {
  FRIENDSHIP_KEYS,
  FRIENDSHIP_TRANSITIONS,
  FRIEND_LIMIT,
  friendPairKey,
  friendshipPairKey,
  isValidFriendshipTransition,
  isOpenFriendshipStatus,
  otherFriend,
  ROLE_PERMISSIONS,
  roleAllows,
  TEEN_SELF_PERMISSIONS,
  type Friendship,
} from "@/domain";

/**
 * Friend Circles domain rules (Phase 12): the pair key that makes
 * A→B and B→A one pair, the lifecycle transition table, and the
 * teen-only permission.
 */

const record = (over: Partial<Friendship> = {}): Friendship => ({
  friendshipId: "frd_test_one",
  requesterAccountId: "usr_a",
  recipientAccountId: "usr_b",
  status: "pending",
  createdAt: "2026-09-26T06:00:00Z",
  updatedAt: "2026-09-26T06:00:00Z",
  ...over,
});

describe("Friend Circles domain", () => {
  it("normalizes pair ordering: A→B and B→A are the same pair", () => {
    expect(friendPairKey("usr_a", "usr_b")).toBe(friendPairKey("usr_b", "usr_a"));
    expect(friendshipPairKey(record())).toBe(friendshipPairKey(record({ requesterAccountId: "usr_b", recipientAccountId: "usr_a" })));
    expect(friendPairKey("usr_a", "usr_b")).not.toBe(friendPairKey("usr_a", "usr_c"));
  });

  it("finds the other friend of a pair, and nobody outside it", () => {
    expect(otherFriend(record(), "usr_a")).toBe("usr_b");
    expect(otherFriend(record(), "usr_b")).toBe("usr_a");
    expect(otherFriend(record(), "usr_c")).toBeNull();
  });

  it("open statuses occupy the pair's single slot", () => {
    expect(isOpenFriendshipStatus("pending")).toBe(true);
    expect(isOpenFriendshipStatus("accepted")).toBe(true);
    expect(isOpenFriendshipStatus("declined")).toBe(false);
    expect(isOpenFriendshipStatus("cancelled")).toBe(false);
    expect(isOpenFriendshipStatus("removed")).toBe(false);
  });

  it("allows exactly the documented lifecycle transitions", () => {
    // The valid moves.
    expect(isValidFriendshipTransition("pending", "accepted")).toBe(true);
    expect(isValidFriendshipTransition("pending", "declined")).toBe(true);
    expect(isValidFriendshipTransition("pending", "cancelled")).toBe(true);
    expect(isValidFriendshipTransition("accepted", "removed")).toBe(true);
    // Everything else needs a new request first (or never exists).
    expect(isValidFriendshipTransition("declined", "accepted")).toBe(false);
    expect(isValidFriendshipTransition("removed", "accepted")).toBe(false);
    expect(isValidFriendshipTransition("cancelled", "accepted")).toBe(false);
    expect(isValidFriendshipTransition("accepted", "declined")).toBe(false);
    expect(isValidFriendshipTransition("accepted", "cancelled")).toBe(false);
    expect(isValidFriendshipTransition("pending", "removed")).toBe(false);
    expect(isValidFriendshipTransition("declined", "pending")).toBe(false);
    expect(isValidFriendshipTransition("removed", "pending")).toBe(false);
  });

  it("terminal statuses have no onward moves", () => {
    expect(FRIENDSHIP_TRANSITIONS.declined).toEqual([]);
    expect(FRIENDSHIP_TRANSITIONS.cancelled).toEqual([]);
    expect(FRIENDSHIP_TRANSITIONS.removed).toEqual([]);
  });

  it("is a teen-only permission, granted to teens and their own scope only", () => {
    expect(roleAllows("teen", "friends.use")).toBe(true);
    expect(roleAllows("parent", "friends.use")).toBe(false);
    expect(TEEN_SELF_PERMISSIONS).toContain("friends.use");
    expect(ROLE_PERMISSIONS.parent).not.toContain("friends.use");
  });

  it("keeps the stored record minimal: no room for private data", () => {
    expect([...FRIENDSHIP_KEYS].sort()).toEqual([
      "acceptedAt",
      "createdAt",
      "endedAt",
      "friendshipId",
      "recipientAccountId",
      "requesterAccountId",
      "status",
      "updatedAt",
    ]);
    expect(FRIEND_LIMIT).toBe(50);
  });
});
