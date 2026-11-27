import type { Db } from "@sentire-pms/db";
import { auditLog, outboxEvents } from "@sentire-pms/db/schema";
import { newId } from "@sentire-pms/core";
import type { TenantContext } from "../iam/tenant";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface Change {
  entity: string;
  entityId: string;
  op: "insert" | "update" | "delete" | "command";
  action: string;
  before?: unknown;
  after?: unknown;
}

/**
 * Record a change inside the caller's transaction: one audit_log row (rule 12) and one
 * outbox_events row for sync (rule 14). Every write in a service goes through this.
 */
export async function recordChange(tx: Tx, ctx: TenantContext, change: Change): Promise<void> {
  await tx.insert(auditLog).values({
    organizationId: ctx.organizationId,
    propertyId: ctx.propertyId,
    actorUserId: ctx.userId,
    action: change.action,
    entity: change.entity,
    entityId: change.entityId,
    before: change.before ?? null,
    after: change.after ?? null,
  });
  await tx.insert(outboxEvents).values({
    eventId: newId(),
    organizationId: ctx.organizationId,
    propertyId: ctx.propertyId,
    entity: change.entity,
    entityId: change.entityId,
    op: change.op,
    payload: { action: change.action, after: change.after ?? null },
  });
}
