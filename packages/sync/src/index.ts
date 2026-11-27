/**
 * Sync protocol types (Phase 2 builds the engine). Every write on the hub records an OutboxEvent
 * in the same transaction; events are applied at most once on the other side.
 */
export type SyncOp = "insert" | "update" | "delete" | "command";

export interface OutboxEvent {
  /** ULID, unique across hub and cloud. */
  eventId: string;
  /** Per-hub sequence number, strictly increasing. */
  seq: bigint;
  propertyId: string;
  entity: string;
  entityId: string;
  op: SyncOp;
  payload: unknown;
  createdAt: string;
}

export interface SyncBatch {
  hubId: string;
  events: OutboxEvent[];
}

export interface SyncAck {
  ackedThroughSeq: bigint;
  rejected: { eventId: string; reason: string }[];
}
