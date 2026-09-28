import { describe, expect, it } from "vitest";
import {
  DEFAULT_SHIELD_SETTINGS,
  SHIELD_LARGE_SHARE,
  SHIELD_REPEAT_THRESHOLD,
  SHIELD_REPEAT_WINDOW_MS,
  applyShieldSettings,
  firstPaymentReason,
  largeAmountReason,
  notInCircleReason,
  rapidRepeatReason,
  requesterIdentityUpdatedReason,
  unknownRequesterReason,
  type ShieldLevel,
  type ShieldReason,
  type ShieldSettings,
} from "@/domain";

/**
 * Shield domain (Phase 14): the typed vocabulary of the Teen Safety
 * Shield — reason codes, levels, settings and the only function that
 * can change a level. Deterministic, calm, and score-free by
 * construction.
 */

const ALL_ON: ShieldSettings = { ...DEFAULT_SHIELD_SETTINGS };
const ALL_OFF: ShieldSettings = {
  firstTimeRecipient: false,
  largePayments: false,
  repeatedPayments: false,
};

const builders: { name: string; build: () => ShieldReason }[] = [
  { name: "firstPaymentReason", build: () => firstPaymentReason("@meera") },
  { name: "notInCircleReason", build: () => notInCircleReason("@meera") },
  { name: "largeAmountReason", build: () => largeAmountReason("@meera") },
  { name: "rapidRepeatReason", build: () => rapidRepeatReason("@meera", 2) },
  { name: "unknownRequesterReason", build: () => unknownRequesterReason("@meera") },
  {
    name: "requesterIdentityUpdatedReason",
    build: () => requesterIdentityUpdatedReason("@meera", "@meera_k"),
  },
];

describe("Shield domain — vocabulary and determinism", () => {
  it("uses the smallest justified level set: notice and confirm only — no block", () => {
    const levels = new Set<ShieldLevel>();
    for (const { build } of builders) levels.add(build().level);
    expect([...levels].sort()).toEqual(["confirm", "notice"]);
  });

  it("every reason has a stable code, a user-safe title and an explanation", () => {
    const expected = [
      ["firstPaymentReason", "first_payment", "confirm"],
      ["notInCircleReason", "not_in_circle", "notice"],
      ["largeAmountReason", "large_amount", "confirm"],
      ["rapidRepeatReason", "rapid_repeat", "confirm"],
      ["unknownRequesterReason", "unknown_requester", "notice"],
      ["requesterIdentityUpdatedReason", "requester_identity_updated", "notice"],
    ] as const;
    builders.forEach(({ name, build }, index) => {
      const reason = build();
      const [n, code, level] = expected[index]!;
      expect(name).toBe(n);
      expect(reason.code).toBe(code);
      expect(reason.level).toBe(level);
      expect(reason.title.trim().length).toBeGreaterThan(0);
      expect(reason.explanation.trim().length).toBeGreaterThan(0);
    });
  });

  it("builders are pure and deterministic — same input, same reason, every time", () => {
    for (const { build } of builders) {
      expect(build()).toEqual(build());
    }
  });

  it("copy stays calm: no fear words, no scores, no labels, no shouting", () => {
    const forbidden =
      /(scam|fraud|risk|score|suspicious|danger|unsafe|blacklist|blocked|block|warning|alert|never send|freeze)/i;
    for (const { build } of builders) {
      const reason = build();
      expect(reason.title).not.toMatch(forbidden);
      expect(reason.explanation).not.toMatch(forbidden);
      expect(reason.title).not.toContain("!");
      expect(reason.explanation).not.toContain("!");
    }
  });

  it("reasons keep the teen in control — never tell them they can't act", () => {
    for (const { build } of builders) {
      const text = `${build().title} ${build().explanation}`.toLowerCase();
      expect(text).not.toMatch(/you (cannot|can't|must not)/);
    }
  });

  it("explanations carry the relationship context, not a verdict", () => {
    expect(unknownRequesterReason("@kian").explanation).toContain(
      "You don't need to accept requests from people you don't know",
    );
    expect(notInCircleReason("@kian").explanation).toContain("You can still send");
    expect(requesterIdentityUpdatedReason("@meera", "@meera_k").title).toBe(
      "@meera_k used to be @meera",
    );
    expect(requesterIdentityUpdatedReason("@meera", "@meera_k").explanation).toContain(
      "same account",
    );
  });

  it("constants are the documented deterministic window, threshold and share", () => {
    expect(SHIELD_REPEAT_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
    expect(SHIELD_REPEAT_THRESHOLD).toBe(2); // third payment in the window triggers
    expect(SHIELD_LARGE_SHARE).toBe(2); // amount × 2 ≥ available
  });
});

describe("Shield domain — defaults and settings", () => {
  it("all optional reminders default to on", () => {
    expect(DEFAULT_SHIELD_SETTINGS).toEqual({
      firstTimeRecipient: true,
      largePayments: true,
      repeatedPayments: true,
    });
  });
});

describe("Shield domain — applyShieldSettings", () => {
  const first = firstPaymentReason("@meera");
  const large = largeAmountReason("@meera");
  const repeat = rapidRepeatReason("@meera", 2);
  const circle = notInCircleReason("@meera");

  it("no reasons → allow", () => {
    expect(applyShieldSettings([], ALL_ON)).toEqual({ outcome: "allow", reasons: [] });
    expect(applyShieldSettings([], ALL_OFF)).toEqual({ outcome: "allow", reasons: [] });
  });

  it("all reminders on → confirmations stay confirmations", () => {
    expect(applyShieldSettings([first], ALL_ON).outcome).toBe("confirm");
    expect(applyShieldSettings([circle], ALL_ON).outcome).toBe("notice");
    expect(applyShieldSettings([circle, first], ALL_ON).outcome).toBe("confirm");
  });

  it("switching a reminder off downgrades its confirm to an inline notice — never hides it", () => {
    const off = applyShieldSettings([first], { ...ALL_ON, firstTimeRecipient: false });
    expect(off.outcome).toBe("notice");
    expect(off.reasons).toHaveLength(1);
    expect(off.reasons[0]!.level).toBe("notice");
    expect(off.reasons[0]!.code).toBe("first_payment");
  });

  it("each toggle only affects its own code", () => {
    const all = [first, large, repeat, circle];
    const onlyLargeOff = applyShieldSettings(all, { ...ALL_ON, largePayments: false });
    expect(onlyLargeOff.reasons.map((r) => `${r.code}:${r.level}`)).toEqual([
      "first_payment:confirm",
      "large_amount:notice",
      "rapid_repeat:confirm",
      "not_in_circle:notice",
    ]);
    expect(onlyLargeOff.outcome).toBe("confirm");

    const allOff = applyShieldSettings(all, ALL_OFF);
    expect(allOff.reasons.every((r) => r.level === "notice")).toBe(true);
    expect(allOff.outcome).toBe("notice");
    expect(allOff.reasons).toHaveLength(4); // nothing removed — downgraded only
  });

  it("notices are unaffected by any toggle", () => {
    expect(applyShieldSettings([circle], ALL_OFF)).toEqual(
      applyShieldSettings([circle], ALL_ON),
    );
  });

  it("never produces an outcome stronger than the reasons justify", () => {
    expect(applyShieldSettings([circle, circle], ALL_ON).outcome).toBe("notice");
    expect(applyShieldSettings([repeat], ALL_OFF).outcome).toBe("notice");
  });
});
