/**
 * Reservation state machine (System Design 6.1, FR-12). The only allowed status changes; the
 * reservations service enforces them through reservations.transition().
 */
export type ResStatus = "INQUIRY" | "NOT_CONFIRMED" | "CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT" | "CANCELLED" | "NO_SHOW";

export const INITIAL_STATUSES: readonly ResStatus[] = ["INQUIRY", "NOT_CONFIRMED", "CONFIRMED"];

export const TRANSITIONS: Readonly<Record<ResStatus, readonly ResStatus[]>> = {
  INQUIRY: ["NOT_CONFIRMED", "CONFIRMED", "CANCELLED"],
  NOT_CONFIRMED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["CHECKED_IN", "CANCELLED", "NO_SHOW"],
  CHECKED_IN: ["CHECKED_OUT"],
  CHECKED_OUT: ["CHECKED_IN"],
  CANCELLED: [],
  NO_SHOW: [],
};

export function canTransition(from: ResStatus, to: ResStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Statuses that hold rooms in inventory. Inquiries are quotes; ended stays give rooms back. */
export function holdsInventory(s: ResStatus): boolean {
  return s === "NOT_CONFIRMED" || s === "CONFIRMED" || s === "CHECKED_IN";
}

export const STATUS_LABEL: Readonly<Record<ResStatus, string>> = {
  INQUIRY: "Inquiry",
  NOT_CONFIRMED: "Not confirmed",
  CONFIRMED: "Confirmed",
  CHECKED_IN: "Checked in",
  CHECKED_OUT: "Checked out",
  CANCELLED: "Cancelled",
  NO_SHOW: "No-show",
};
