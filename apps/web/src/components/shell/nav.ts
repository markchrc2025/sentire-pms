export interface NavItem {
  key: string;
  label: string;
  path: string;
  phase: string;
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
      { key: "dashboard", label: "Dashboard", path: "", phase: "Phase 4" },
      { key: "calendar", label: "Calendar", path: "calendar", phase: "Phase 4" },
      { key: "reservations", label: "Reservations", path: "reservations", phase: "Phase 4" },
      { key: "new-reservation", label: "New reservation", path: "reservations/new", phase: "Phase 4" },
    ],
  },
  {
    title: "Operations",
    items: [
      { key: "guests", label: "Guests", path: "guests", phase: "Phase 4" },
      { key: "housekeeping", label: "Housekeeping", path: "housekeeping", phase: "Phase 5" },
    ],
  },
  {
    title: "Revenue",
    items: [
      { key: "rates", label: "Rates and availability", path: "rates", phase: "Phase 3" },
      { key: "payments", label: "Payments", path: "payments", phase: "Phase 6" },
      { key: "reports", label: "Reports", path: "reports", phase: "Phase 8" },
    ],
  },
  {
    title: "Admin",
    items: [
      { key: "settings", label: "Settings", path: "settings", phase: "Phase 1" },
      { key: "sync", label: "Sync and devices", path: "sync", phase: "Phase 2" },
    ],
  },
];

export function findNav(section: string): NavItem | undefined {
  for (const g of NAV) for (const i of g.items) if (i.path === section) return i;
  return undefined;
}
