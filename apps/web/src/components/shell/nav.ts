import type { Permission } from "@/server/iam/permissions";

export interface NavItem {
  key: string;
  label: string;
  path: string;
  phase: string;
  /** Shown only to roles with this permission. */
  perm: Permission;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

/** Side menu, in the order of the mockup. `phase` says which build phase delivers the screen. */
export const NAV: NavGroup[] = [
  {
    title: "Front desk",
    items: [
      { key: "dashboard", label: "Dashboard", path: "", phase: "Phase 4", perm: "reservations.view" },
      { key: "calendar", label: "Calendar", path: "calendar", phase: "Phase 4", perm: "reservations.view" },
      { key: "reservations", label: "Reservations", path: "reservations", phase: "Phase 4", perm: "reservations.view" },
      { key: "new-reservation", label: "New reservation", path: "reservations/new", phase: "Phase 4", perm: "reservations.manage" },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "guests", label: "Guests", path: "guests", phase: "Phase 4", perm: "guests.view" },
      { key: "housekeeping", label: "Housekeeping", path: "housekeeping", phase: "Phase 5", perm: "housekeeping.view" },
    ],
  },
  {
    title: "Revenue",
    items: [
      { key: "rates", label: "Rates and availability", path: "rates", phase: "Phase 3", perm: "reservations.view" },
      { key: "payments", label: "Payments", path: "payments", phase: "Phase 6", perm: "folio.view" },
      { key: "reports", label: "Reports", path: "reports", phase: "Phase 8", perm: "reports.operational" },
    ],
  },
  {
    title: "Admin",
    items: [
      { key: "settings", label: "Settings", path: "settings", phase: "Phase 1", perm: "property.view" },
      { key: "sync", label: "Sync and devices", path: "sync", phase: "Phase 2", perm: "settings.manage" },
    ],
  },
];

export function findNav(section: string): NavItem | undefined {
  for (const g of NAV) for (const i of g.items) if (i.path === section) return i;
  return undefined;
}
