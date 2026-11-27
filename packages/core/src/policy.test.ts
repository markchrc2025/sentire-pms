import { describe, expect, it } from "vitest";
import { chargeAmount, freeCancelUntil, guaranteeAmount, noShowPenaltyAmount, penaltyAt, zonedInstant, type PolicyTerms } from "./policy";

const rates = [320000n, 360000n, 360000n]; // ₱3,200 + ₱3,600 + ₱3,600 = ₱10,400
const flexible: PolicyTerms = { guarantee: "FIRST_NIGHT", guaranteeValue: 0n, freeCancelHours: 48, lateCancelPenalty: "FIRST_NIGHT", lateCancelValue: 0n, noShowPenalty: "FIRST_NIGHT", noShowValue: 0n };
const arrival = zonedInstant("2026-12-10", "14:00");

describe("policy maths (P3.5, FR-09)", () => {
  it("computes every charge kind", () => {
    expect(chargeAmount("NONE", 0n, rates)).toBe(0n);
    expect(chargeAmount("FIRST_NIGHT", 0n, rates)).toBe(320000n);
    expect(chargeAmount("FULL_STAY", 0n, rates)).toBe(1040000n);
    expect(chargeAmount("PERCENT", 2500n, rates)).toBe(260000n);
    // 33.33% of ₱10,400 = ₱3,466.32 (346,632 centavos exactly .32; 1,040,000 * 3333 / 10000 = 346,632)
    expect(chargeAmount("PERCENT", 3333n, rates)).toBe(346632n);
    // Half-up rounding: 15% of ₱333.33 = ₱49.9995 -> ₱50.00
    expect(chargeAmount("PERCENT", 1500n, [33333n])).toBe(5000n);
    expect(chargeAmount("FIRST_NIGHT", 0n, [])).toBe(0n);
  });

  it("guarantee amounts", () => {
    expect(guaranteeAmount(flexible, rates)).toBe(320000n);
    expect(guaranteeAmount({ ...flexible, guarantee: "NONE" }, rates)).toBe(0n);
    expect(guaranteeAmount({ ...flexible, guarantee: "PERCENT", guaranteeValue: 5000n }, rates)).toBe(520000n);
    expect(guaranteeAmount({ ...flexible, guarantee: "FULL_STAY" }, rates)).toBe(1040000n);
  });

  it("free until the window closes, then the late penalty", () => {
    expect(arrival.toISOString()).toBe("2026-12-10T06:00:00.000Z");
    expect(freeCancelUntil(flexible, arrival)!.toISOString()).toBe("2026-12-08T06:00:00.000Z");
    const at = (iso: string) => penaltyAt(flexible, { arrivalAt: arrival, cancelAt: new Date(iso), nightlyRates: rates });
    expect(at("2026-12-01T00:00:00Z")).toBe(0n);
    expect(at("2026-12-08T06:00:00Z")).toBe(0n); // exactly 48 hours before: still free
    expect(at("2026-12-08T06:00:01Z")).toBe(320000n);
    expect(at("2026-12-10T10:00:00Z")).toBe(320000n);
  });

  it("a zero-hour window is free until the moment of arrival", () => {
    const z = { ...flexible, freeCancelHours: 0 };
    expect(penaltyAt(z, { arrivalAt: arrival, cancelAt: arrival, nightlyRates: rates })).toBe(0n);
  });

  it("each late penalty type, capped at the stay total", () => {
    const late = (kind: PolicyTerms["lateCancelPenalty"], value = 0n) => penaltyAt({ ...flexible, freeCancelHours: 0, lateCancelPenalty: kind, lateCancelValue: value }, { arrivalAt: arrival, cancelAt: new Date(arrival.getTime() + 1000), nightlyRates: rates });
    expect(late("NONE")).toBe(0n);
    expect(late("FIRST_NIGHT")).toBe(320000n);
    expect(late("PERCENT", 5000n)).toBe(520000n);
    expect(late("FULL_STAY")).toBe(1040000n);
    expect(late("PERCENT", 10000n)).toBe(1040000n);
  });

  it("non-refundable: no free window at any time", () => {
    const nr: PolicyTerms = { guarantee: "FULL_STAY", guaranteeValue: 0n, freeCancelHours: null, lateCancelPenalty: "FULL_STAY", lateCancelValue: 0n, noShowPenalty: "FULL_STAY", noShowValue: 0n };
    expect(freeCancelUntil(nr, arrival)).toBeNull();
    expect(penaltyAt(nr, { arrivalAt: arrival, cancelAt: new Date("2026-11-01T00:00:00Z"), nightlyRates: rates })).toBe(1040000n);
    expect(penaltyAt(nr, { arrivalAt: arrival, cancelAt: new Date(arrival.getTime() + 1), nightlyRates: rates })).toBe(1040000n);
  });

  it("no-show penalties", () => {
    expect(noShowPenaltyAmount(flexible, rates)).toBe(320000n);
    expect(noShowPenaltyAmount({ ...flexible, noShowPenalty: "PERCENT", noShowValue: 2000n }, rates)).toBe(208000n);
  });

  it("zoned instants", () => {
    expect(zonedInstant("2026-11-24", "12:00").toISOString()).toBe("2026-11-24T04:00:00.000Z");
    expect(zonedInstant("2026-07-01", "14:00", "America/New_York").toISOString()).toBe("2026-07-01T18:00:00.000Z");
    expect(zonedInstant("2026-01-15", "14:00", "America/New_York").toISOString()).toBe("2026-01-15T19:00:00.000Z");
  });
});
