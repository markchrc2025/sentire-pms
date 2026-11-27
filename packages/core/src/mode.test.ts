import { describe, expect, it } from "vitest";
import { isCloud, isHub, pmsMode } from "./mode";

describe("pmsMode", () => {
  it("defaults to hub", () => expect(pmsMode({})).toBe("hub"));
  it("reads cloud", () => {
    expect(isCloud({ PMS_MODE: "cloud" })).toBe(true);
    expect(isHub({ PMS_MODE: "cloud" })).toBe(false);
  });
  it("rejects anything else", () => expect(() => pmsMode({ PMS_MODE: "edge" })).toThrow());
});
