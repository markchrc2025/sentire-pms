/**
 * Sync protocol between a property hub and Sentire Cloud (Phase 2). Every write on the hub records
 * an outbox event in the same transaction; the other side applies each event at most once.
 * Sequence numbers travel as strings because JSON has no bigint.
 */
export type SyncOp = "insert" | "update" | "delete" | "command";

export interface WireEvent {
  /** ULID, unique across hub and cloud. */
  eventId: string;
  /** Sequence number on the side that made the event, as a decimal string. */
  seq: string;
  organizationId: string;
  propertyId: string | null;
  entity: string;
  entityId: string;
  op: SyncOp;
  payload: { action: string; after: Record<string, unknown> | null };
  createdAt: string;
}

export interface EnrollRequest {
  enrollKey: string;
  hubName: string;
  organizationId: string;
  propertyId: string;
  propertySlug: string;
  appVersion: string;
  /** Replace the property's current hub (new PC, reinstall). */
  replace?: boolean;
}

export interface EnrollResponse {
  hubId: string;
  hubToken: string;
}

export interface PushRequest {
  events: WireEvent[];
  appVersion?: string;
}

export interface PushResponse {
  /** Events the cloud now holds (applied now or before). */
  acked: string[];
  /** Events the cloud will never apply, with the reason. Also acknowledged. */
  rejected: { eventId: string; reason: string }[];
}

export interface PullResponse {
  events: WireEvent[];
  /** Pass back as `after` on the next pull. */
  cursor: string;
  more: boolean;
}

export interface SnapshotResponse {
  organizationId: string;
  propertyId: string;
  tables: { entity: string; rows: Record<string, unknown>[] }[];
}

export const SYNC_BATCH_SIZE = 200;
