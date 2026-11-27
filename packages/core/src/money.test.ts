import { describe, expect, it } from "vitest";
import { divRoundHalfUp, formatPeso, netFromInclusive, parsePeso, percentOf, vatFromInclusive } from "./money";

describe("money", () => {
  it("rounds half up, symmetric for negatives", () => {
    expect(divRoundHalfUp(5n, 2n)).toBe(3n);
    expect(divRoundHalfUp(4n, 3n)).toBe(1n);
    expect(divRoundHalfUp(-5n, 2n)).toBe(-3n);
  });

  it("computes VAT from a VAT-inclusive amount (12/112)", () => {
    // P7,200.00 inclusive -> VAT P771.43, net P6,428.57
    expect(vatFromInclusive(720000n)).toBe(77143n);
    expect(netFromInclusive(720000n)).toBe(642857n);
    expect(netFromInclusive(720000n) + vatFromInclusive(720000n)).toBe(720000n);
  });

  it("applies the 20% senior citizen / PWD discount to the centavo", () => {
    expect(percentOf(642857n, 20n)).toBe(128571n);
  });

  it("parses and formats peso amounts", () => {
    expect(parsePeso("1,234.5")).toBe(123450n);
    expect(parsePeso("₱0.05")).toBe(5n);
    expect(() => parsePeso("1.234")).toThrow();
    expect(formatPeso(123450n)).toBe("₱1,234.50");
    expect(formatPeso(-5n)).toBe("-₱0.05");
    expect(formatPeso(100000000n, { sign: false })).toBe("1,000,000.00");
  });
});
