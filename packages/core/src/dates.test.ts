import { describe, expect, it } from "vitest";
import { addDays, dayOfWeek, diffDays, formatDate, isIsoDate, nightsBetween, todayIn } from "./dates";

describe("dates", () => {
  it("adds days across months and leap years", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });
  it("counts nights", () => {
    expect(nightsBetween("2026-11-24", "2026-11-27")).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
    expect(nightsBetween("2026-11-24", "2026-11-24")).toEqual([]);
    expect(diffDays("2026-11-24", "2026-12-01")).toBe(7);
  });
  it("validates and formats", () => {
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("2026-11-24")).toBe(true);
    expect(formatDate("2026-11-24")).toBe("24 Nov 2026");
    expect(dayOfWeek("2026-11-24")).toBe(2);
    expect(todayIn("Asia/Manila", new Date("2026-11-27T17:00:00Z"))).toBe("2026-11-28");
  });
});
