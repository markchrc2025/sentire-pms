import { sql } from "drizzle-orm";
import { bigint, char, index, jsonb, pgEnum, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { ulidRef } from "./_helpers";

export const syncOp = pgEnum("sync_op", ["insert", "update", "delete", "command"]);

/**
 * Every write on the hub records an outbox event in the same transaction (CLAUDE.md rule 14).
 * seq is a per-database ordering number for sync, not a primary key.
 */
export const outboxEvents = pgTable(
  "outbox_events",
  {
    eventId: char("event_id", { length: 26 }).primaryKey(),
    seq: bigint("seq", { mode: "bigint" }).notNull().generatedAlwaysAsIdentity(),
    organizationId: ulidRef("organization_id").notNull(),
    propertyId: ulidRef("property_id"),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    op: syncOp("op").notNull(),
    payload: jsonb("payload").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    ackedAt: timestamp("acked_at", { withTimezone: true }),
  },
  (t) => [index("outbox_unacked_idx").on(t.seq).where(sql`acked_at is null`)],
);

/** Events received from the other side, recorded so each is applied at most once (rule 15). */
export const inboxEvents = pgTable("inbox_events", {
  eventId: char("event_id", { length: 26 }).primaryKey(),
  source: text("source").notNull(),
  payload: jsonb("payload").notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per hub: where sync stands. Updated by the hub worker after each round with the cloud. */
export const syncState = pgTable("sync_state", {
  id: char("id", { length: 26 }).primaryKey(),
  hubId: text("hub_id").notNull(),
  lastPushedSeq: bigint("last_pushed_seq", { mode: "bigint" }).notNull().default(sql`0`),
  lastPulledCursor: text("last_pulled_cursor"),
  lastSuccessAt: timestamp("last_success_at", { withTimezone: true }),
  lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
  lastError: text("last_error"),
});
