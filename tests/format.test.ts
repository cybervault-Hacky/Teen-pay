import { describe, expect, it } from "vitest";
import {
  formatCompactNumber,
  formatDayLabel,
  formatINR,
  formatPercent,
  formatSignedINR,
  formatTime,
  getInitials,
} from "@/lib/format";

describe("formatINR", () => {
  it("formats paise with Indian digit grouping", () => {
    expect(formatINR(245_000)).toBe("₹2,450");
    expect(formatINR(100_000)).toBe("₹1,000");
    expect(formatINR(12_50_00_000)).toBe("₹12,50,000");
  });

  it("formats zero and small values", () => {
    expect(formatINR(0)).toBe("₹0");
    expect(formatINR(50)).toBe("₹1"); // rounds to whole rupees
  });

  it("supports exact paise output", () => {
    expect(formatINR(34_900, { exact: true })).toBe("₹349.00");
  });
});

describe("formatSignedINR", () => {
  it("prefixes + for money in and − for money out", () => {
    expect(formatSignedINR(100_000, "in")).toBe("+₹1,000");
    expect(formatSignedINR(34_900, "out")).toBe("−₹349");
  });
});

describe("formatDayLabel", () => {
  it("labels today, yesterday and older dates", () => {
    const now = new Date("2026-09-26T12:00:00");
    expect(formatDayLabel("2026-09-26T09:00:00", now)).toBe("Today");
    expect(formatDayLabel("2026-09-25T23:00:00", now)).toBe("Yesterday");
    expect(formatDayLabel("2026-03-04T09:00:00", now)).toBe("4 Mar");
  });
});

describe("formatTime", () => {
  it("renders a short lowercase time", () => {
    expect(formatTime("2026-09-26T18:42:00")).toBe("6:42 pm");
  });
});

describe("formatPercent", () => {
  it("rounds and clamps to 0–100%", () => {
    expect(formatPercent(40_000, 299_900)).toBe("13%");
    expect(formatPercent(5, 0)).toBe("0%");
    expect(formatPercent(200, 100)).toBe("100%");
  });
});

describe("formatCompactNumber", () => {
  it("compacts large numbers", () => {
    expect(formatCompactNumber(1_200)).toMatch(/1\.2\s?K/);
  });
});

describe("getInitials", () => {
  it("derives initials from names", () => {
    expect(getInitials("Aarav Sharma")).toBe("AS");
    expect(getInitials("Diya")).toBe("DI");
    expect(getInitials("  ")).toBe("?");
  });
});
