import { describe, expect, it } from "vitest";
import {
  RESERVED_TEENPAY_IDS,
  TEENPAY_ID_MAX,
  TEENPAY_ID_MIN,
  availabilityFromCheck,
  checkTeenPayId,
  formatTeenPayId,
  isReservedTeenPayId,
  isValidTeenPayIdFormat,
  looksLikeInternalId,
  normalizeTeenPayId,
} from "@/domain";

/**
 * TeenPay ID domain (Phase 13): normalization, the conservative
 * alphabet, reserved ids, internal-id refusal and the structured
 * availability vocabulary. Pure and deterministic.
 */

describe("TeenPay ID normalization", () => {
  it("folds case, whitespace and leading @ into one form", () => {
    expect(normalizeTeenPayId("aarav")).toBe("aarav");
    expect(normalizeTeenPayId("@aarav")).toBe("aarav");
    expect(normalizeTeenPayId("@Aarav")).toBe("aarav");
    expect(normalizeTeenPayId("AARAV")).toBe("aarav");
    expect(normalizeTeenPayId("  @AaRaV  ")).toBe("aarav");
    expect(normalizeTeenPayId("@@meera")).toBe("meera");
  });

  it("never forks identities by case", () => {
    expect(normalizeTeenPayId("@AARAV")).toBe(normalizeTeenPayId("aarav"));
    expect(checkTeenPayId("@AARAV").username).toBe(checkTeenPayId("aarav").username);
  });

  it("formats the display form", () => {
    expect(formatTeenPayId("aarav")).toBe("@aarav");
  });
});

describe("valid TeenPay IDs", () => {
  const valid = ["aarav", "meera", "abc", "rohan_01", "ro.han", "a23", "a".repeat(TEENPAY_ID_MAX)];
  it.each(valid)("accepts %s", (id) => {
    const check = checkTeenPayId(id);
    expect(check.problem).toBeNull();
    expect(check.message).toBeNull();
    expect(check.username).toBe(id);
    expect(isValidTeenPayIdFormat(id)).toBe(true);
  });
});

describe("invalid TeenPay IDs", () => {
  const invalid: Array<[string, string]> = [
    ["", "empty"],
    ["@", "empty"],
    ["   ", "empty"],
    ["ab", "too_short"],
    ["a".repeat(TEENPAY_ID_MAX + 1), "too_long"],
    ["1aarav", "invalid_start"],
    ["_aarav", "invalid_start"],
    [".aarav", "invalid_start"],
    ["aarav sharma", "invalid_characters"],
    ["aa/rav", "invalid_characters"],
    ["aa\\rav", "invalid_characters"],
    ["aa:rav", "invalid_characters"],
    ["aa?to=1&rav", "invalid_characters"],
    ["aa<rav>", "invalid_characters"],
    ["https://evil", "invalid_characters"],
    ["aar🎈v", "invalid_characters"],
    ["аarav", "invalid_start"], // Cyrillic lookalike 'а'
    ["aa\u0001rav", "invalid_characters"], // control character
    ["aa..rav", "invalid_punctuation"],
    ["aa__rav", "invalid_punctuation"],
    ["aa_.rav", "invalid_punctuation"],
    ["aarav_", "invalid_punctuation"],
    ["aarav.", "invalid_punctuation"],
  ];
  it.each(invalid)("rejects %j as %s", (id, problem) => {
    expect(checkTeenPayId(id).problem).toBe(problem);
    expect(isValidTeenPayIdFormat(normalizeTeenPayId(id))).toBe(false);
  });

  it("rejects emoji-only and uppercase-only inputs as invalid", () => {
    expect(checkTeenPayId("🎈🎈🎈").problem).not.toBeNull();
    expect(checkTeenPayId("@").problem).toBe("empty");
  });
});

describe("reserved TeenPay IDs", () => {
  const required = [
    "admin",
    "support",
    "help",
    "security",
    "teenpay",
    "official",
    "system",
    "payments",
    "wallet",
    "family",
    "parent",
    "guardian",
    "api",
    "root",
  ];

  it("centralizes the list", () => {
    expect(RESERVED_TEENPAY_IDS.length).toBeGreaterThanOrEqual(required.length);
    expect(new Set(RESERVED_TEENPAY_IDS).size).toBe(RESERVED_TEENPAY_IDS.length);
  });

  it.each(required)("reserves %s", (id) => {
    expect(isReservedTeenPayId(id)).toBe(true);
    expect(checkTeenPayId(id).problem).toBe("reserved");
    expect(checkTeenPayId(`@${id.toUpperCase()}`).problem).toBe("reserved");
  });

  it("treats internal-id shapes as reserved", () => {
    for (const id of ["usr_meera", "wal_x", "fam_y", "frd_zzzzzz", "ntf_1"]) {
      expect(checkTeenPayId(id).problem).toBe("reserved");
      expect(looksLikeInternalId(id)).toBe(true);
      expect(looksLikeInternalId(`@${id}`)).toBe(true);
    }
    expect(looksLikeInternalId("aarav")).toBe(false);
  });
});

describe("availability", () => {
  it("reports taken from the uniqueness provider", () => {
    expect(checkTeenPayId("meera", () => true).problem).toBe("taken");
  });

  it("maps checks onto the structured vocabulary", () => {
    expect(availabilityFromCheck(checkTeenPayId("rohan"))).toEqual({
      status: "available",
      normalized: "rohan",
      message: null,
    });
    expect(availabilityFromCheck(checkTeenPayId("meera", () => true))).toMatchObject({
      status: "taken",
      normalized: "meera",
    });
    expect(availabilityFromCheck(checkTeenPayId("admin"))).toMatchObject({ status: "reserved" });
    expect(availabilityFromCheck(checkTeenPayId("ab"))).toMatchObject({ status: "invalid" });
    expect(availabilityFromCheck(checkTeenPayId("usr_x"))).toMatchObject({ status: "reserved" });
  });

  it("every non-available state carries a human message", () => {
    for (const raw of ["meera:)", "admin", "ab", "1x", "a_"]) {
      const availability = availabilityFromCheck(checkTeenPayId(raw, () => raw === "meera:)"));
      if (availability.status !== "available") {
        expect(availability.message).toBeTruthy();
      }
    }
  });

  it("bounds are sane", () => {
    expect(TEENPAY_ID_MIN).toBeGreaterThanOrEqual(3);
    expect(TEENPAY_ID_MAX).toBeLessThanOrEqual(30);
  });
});
