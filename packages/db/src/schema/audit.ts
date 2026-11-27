import { index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { id, ulidRef } from "./_helpers";

/** Append-only. A database trigger rejects UPDATE and DELETE (see migration 0001). */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    organizationId: ulidRef("organization_id").notNull(),
    propertyId: ulidRef("property_id"),
    actorUserId: ulidRef("actor_user_id"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    before: jsonb("before"),
    after: jsonb("after"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_log_entity_idx").on(t.entity, t.entityId), index("audit_log_property_at_idx").on(t.propertyId, t.at)],
);
