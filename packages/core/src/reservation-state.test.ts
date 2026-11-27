import { describe, expect, it } from "vitest";
import { canTransition, holdsInventory, TRANSITIONS, type ResStatus } from "./reservation-state";

const ALL = Object.keys(TRANSITIONS) as ResStatus[];

describe("reservation state machine (FR-12)", () => {
  it("allows exactly the diagram's transitions", () => {
    const allowed = ALL.flatMap((f) => ALL.filter((t) => canTransition(f, t)).map((t) => `${f}>${t}`));
    expect(allowed.sort()).toEqual(
      ["INQUIRY>NOT_CONFIRMED", "INQUIRY>CONFIRMED", "INQUIRY>CANCELLED", "NOT_CONFIRMED>CONFIRMED", "NOT_CONFIRMED>CANCELLED", "CONFIRMED>CHECKED_IN", "CONFIRMED>CANCELLED", "CONFIRMED>NO_SHOW", "CHECKED_IN>CHECKED_OUT", "CHECKED_OUT>CHECKED_IN"].sort(),
    );
  });
  it("terminal states go nowhere and nothing skips check-in", () => {
    for (const t of ALL) {
      expect(canTransition("CANCELLED", t)).toBe(false);
      expect(canTransition("NO_SHOW", t)).toBe(false);
    }
    expect(canTransition("NOT_CONFIRMED", "CHECKED_IN")).toBe(false);
    expect(canTransition("CONFIRMED", "CHECKED_OUT")).toBe(false);
    expect(canTransition("CHECKED_IN", "CANCELLED")).toBe(false);
  });
  it("holds inventory only while the booking is live", () => {
    expect(ALL.filter(holdsInventory).sort()).toEqual(["CHECKED_IN", "CONFIRMED", "NOT_CONFIRMED"]);
  });
});
