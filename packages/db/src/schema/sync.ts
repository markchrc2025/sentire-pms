import { sql } from "drizzle-orm";
import { bigint, char, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { id, ulidRef } from "./_helpers";

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
  cloudUrl: text("cloud_url"),
  /** Hub token issued by the cloud at enrollment. Kept only in the hub database (encrypted data folder). */
  hubToken: text("hub_token"),
  organizationId: ulidRef("organization_id"),
  propertyId: ulidRef("property_id"),
  enrolledAt: timestamp("enrolled_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
});

export const issueStatus = pgEnum("issue_status", ["OPEN", "RESOLVED", "IGNORED"]);

/** Events the other side rejected, or that could not be applied here (FR-52). */
export const syncIssues = pgTable(
  "sync_issues",
  {
    id: id(),
    eventId: char("event_id", { length: 26 }).notNull(),
    direction: varchar("direction", { length: 8 }).notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    reason: text("reason").notNull(),
    status: issueStatus("status").notNull().default("OPEN"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sync_issues_event_dir_uq").on(t.eventId, t.direction)],
);

/** Cloud side: one row per hub that has enrolled. The token is stored as a SHA-256 hash. */
export const hubs = pgTable(
  "hubs",
  {
    id: id(),
    organizationId: ulidRef("organization_id").notNull(),
    propertyId: ulidRef("property_id").notNull(),
    name: text("name").notNull(),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    appVersion: text("app_version"),
    enrolledAt: timestamp("enrolled_at", { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastPushedSeq: bigint("last_pushed_seq", { mode: "bigint" }).notNull().default(sql`0`),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("hubs_token_uq").on(t.tokenHash), index("hubs_property_idx").on(t.propertyId)],
);

export const deviceKind = pgEnum("device_kind", ["WINDOWS_DESKTOP", "ANDROID_TABLET", "IPAD", "MAC_DESKTOP", "BROWSER"]);

/** Hub side: devices paired to this hub over the local network (FR-50). */
export const devices = pgTable(
  "devices",
  {
    id: id(),
    organizationId: ulidRef("organization_id").notNull(),
    propertyId: ulidRef("property_id").notNull(),
    name: text("name").notNull(),
    kind: deviceKind("kind").notNull().default("BROWSER"),
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    pairedByUserId: ulidRef("paired_by_user_id"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("devices_token_uq").on(t.tokenHash)],
);

/** One-time pairing codes (6 digits, 10 minutes, single use, stored hashed). */
export const pairingCodes = pgTable("pairing_codes", {
  id: id(),
  organizationId: ulidRef("organization_id").notNull(),
  propertyId: ulidRef("property_id").notNull(),
  codeHash: varchar("code_hash", { length: 64 }).notNull(),
  createdByUserId: ulidRef("created_by_user_id").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
