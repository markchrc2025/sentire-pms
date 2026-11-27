/**
 * Permission list and role matrix (System Design 2.1, FR-39). Server actions and route handlers
 * check one permission each with authorize(ctx, permission).
 */
export const PERMISSIONS = [
  "property.view",
  "property.manage",
  "users.manage",
  "rates.manage",
  "reservations.view",
  "reservations.manage",
  "guests.view",
  "guests.manage",
  "folio.view",
  "folio.post",
  "payments.record",
  "payments.refund",
  "invoices.issue",
  "housekeeping.view",
  "housekeeping.update",
  "reports.operational",
  "reports.financial",
  "night_audit.run",
  "audit.view",
  "settings.manage",
] as const;

export type Permission = (typeof PERMISSIONS)[number];
export type Role = "OWNER" | "ADMIN" | "FRONT_DESK" | "HOUSEKEEPING" | "ACCOUNTANT";

const all = new Set<Permission>(PERMISSIONS);

export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  OWNER: all,
  ADMIN: all,
  FRONT_DESK: new Set<Permission>([
    "property.view",
    "reservations.view",
    "reservations.manage",
    "guests.view",
    "guests.manage",
    "folio.view",
    "folio.post",
    "payments.record",
    "invoices.issue",
    "housekeeping.view",
    "housekeeping.update",
    "reports.operational",
  ]),
  HOUSEKEEPING: new Set<Permission>(["property.view", "housekeeping.view", "housekeeping.update"]),
  ACCOUNTANT: new Set<Permission>([
    "property.view",
    "reservations.view",
    "guests.view",
    "folio.view",
    "reports.operational",
    "reports.financial",
    "audit.view",
  ]),
};

export function roleAllows(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}
