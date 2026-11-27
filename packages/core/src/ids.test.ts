import { describe, expect, it } from "vitest";
import { newId } from "./ids";

describe("newId", () => {
  it("creates sortable 26-character ULIDs", () => {
    const a = newId();
    const b = newId();
    expect(a).toHaveLength(26);
    expect(b > a).toBe(true);
  });
});
