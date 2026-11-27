import { monotonicFactory } from "ulid";

const next = monotonicFactory();

/** New ULID primary key. Created where the record is born (hub, device or cloud). */
export function newId(): string {
  return next();
}
