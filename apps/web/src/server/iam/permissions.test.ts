import { describe, expect, it } from "vitest";
import { PERMISSIONS, roleAllows } from "./permissions";

describe("role matrix", () => {
  it("gives Owner and Admin every permission", () => {
    for (const p of PERMISSIONS) {
      expect(roleAllows("OWNER", p)).toBe(true);
      expect(roleAllows("ADMIN", p)).toBe(true);
    }
  });
  it("limits Housekeeping to room status", () => {
    expect(roleAllows("HOUSEKEEPING", "housekeeping.update")).toBe(true);
    expect(roleAllows("HOUSEKEEPING", "reservations.view")).toBe(false);
    expect(roleAllows("HOUSEKEEPING", "folio.view")).toBe(false);
  });
  it("keeps Front Desk out of rates, refunds, settings and night audit", () => {
    for (const p of ["rates.manage", "payments.refund", "settings.manage", "night_audit.run", "users.manage"] as const) {
      expect(roleAllows("FRONT_DESK", p)).toBe(false);
    }
    expect(roleAllows("FRONT_DESK", "payments.record")).toBe(true);
  });
  it("makes Accountant read-only", () => {
    for (const p of ["folio.post", "payments.record", "reservations.manage", "invoices.issue"] as const) {
      expect(roleAllows("ACCOUNTANT", p)).toBe(false);
    }
    expect(roleAllows("ACCOUNTANT", "reports.financial")).toBe(true);
  });
});
