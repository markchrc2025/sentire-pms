import { and, count, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@sentire-pms/db";
import { auditLog, outboxEvents, syncIssues } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "../iam/tenant";
import { NotFoundError, ValidationError } from "../iam/errors";
import { enrollThisHub, getSyncState, httpTransport, syncOnce, type Transport } from "./hub";

/** What the Sync and devices screen shows (FR-53). */
export async function syncOverview(db: Db, ctx: TenantContext) {
  authorize(ctx, "settings.manage");
  const st = await getSyncState(db);
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(outboxEvents).where(isNull(outboxEvents.ackedAt));
  const issues = await db.select().from(syncIssues).where(eq(syncIssues.status, "OPEN")).orderBy(desc(syncIssues.createdAt)).limit(100);
  return {
    enrolled: Boolean(st?.hubToken),
    cloudUrl: st?.cloudUrl ?? null,
    hubId: st?.hubId ?? null,
    enrolledAt: st?.enrolledAt ?? null,
    lastSuccessAt: st?.lastSuccessAt ?? null,
    lastAttemptAt: st?.lastAttemptAt ?? null,
    lastError: st?.lastError ?? null,
    nextAttemptAt: st?.nextAttemptAt ?? null,
    pending: n,
    issues,
  };
}

export const enrollInput = z.object({
  cloudUrl: z.string().trim().url("Enter the Sentire Cloud address, e.g. https://pms.apps.sentire.solutions").refine((u) => u.startsWith("https://") || u.startsWith("http://localhost"), "Use an https:// address."),
  enrollKey: z.string().trim().min(8, "Enter the enrollment key from Sentire."),
  hubName: z.string().trim().min(2).max(60).default("Hub"),
  replace: z.union([z.literal("on"), z.literal(""), z.boolean()]).optional().transform((v) => v === "on" || v === true),
});

export async function enrollFromScreen(db: Db, ctx: TenantContext, raw: unknown, transport?: Transport) {
  authorize(ctx, "settings.manage");
  const d = enrollInput.parse(raw);
  try {
    return await enrollThisHub(db, transport ?? httpTransport(d.cloudUrl), { ...d, propertyId: ctx.propertyId });
  } catch (e) {
    throw new ValidationError(`Sentire Cloud refused: ${(e as Error).message}`);
  }
}

export async function syncNow(db: Db, ctx: TenantContext, transport?: Transport) {
  authorize(ctx, "settings.manage");
  const st = await getSyncState(db);
  if (!st?.cloudUrl) throw new ValidationError("Connect this hub to Sentire Cloud first.");
  return syncOnce(db, transport ?? httpTransport(st.cloudUrl));
}

export async function setIssueStatus(db: Db, ctx: TenantContext, id: string, status: "RESOLVED" | "IGNORED") {
  authorize(ctx, "settings.manage");
  const [i] = await db.update(syncIssues).set({ status, resolvedAt: new Date() }).where(and(eq(syncIssues.id, id), eq(syncIssues.status, "OPEN"))).returning();
  if (!i) throw new NotFoundError("Issue not found.");
  await db.insert(auditLog).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, actorUserId: ctx.userId, action: `sync_issue.${status.toLowerCase()}`, entity: "sync_issue", entityId: id, after: { eventId: i.eventId } });
  return i;
}
