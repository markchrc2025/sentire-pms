import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { SYNC_BATCH_SIZE, type EnrollRequest, type EnrollResponse, type PullResponse, type PushRequest, type PushResponse, type SnapshotResponse, type WireEvent } from "@sentire-pms/sync";
import type { Db } from "@sentire-pms/db";
import { hubs, outboxEvents, properties, syncIssues } from "@sentire-pms/db/schema";
import { applyOnce, upsertRow } from "./apply";
import { SYNCED, syncedEntity } from "./registry";

/** Cloud side of sync: enrollment, receiving hub batches, serving cloud events and snapshots. */

export class SyncAuthError extends Error {
  readonly status = 401;
}
export class SyncRequestError extends Error {
  readonly status = 400;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function keyMatches(given: string, expected: string | undefined): boolean {
  if (!expected) return false;
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function enrollHub(db: Db, reqIn: EnrollRequest, enrollKey = process.env.CLOUD_ENROLL_KEY): Promise<EnrollResponse> {
  let req = reqIn;
  if (!keyMatches(req.enrollKey ?? "", enrollKey)) throw new SyncAuthError("Enrollment key is not valid.");
  // Restoring a replaced hub by its web name: look the property up in the cloud mirror.
  if (req.replace && (!req.organizationId || !req.propertyId) && req.propertySlug) {
    const [p] = await db.select({ id: properties.id, org: properties.organizationId }).from(properties).where(eq(properties.slug, req.propertySlug)).limit(1);
    if (!p) throw new SyncRequestError("Sentire Cloud has no property with that web name.");
    req = { ...req, organizationId: p.org, propertyId: p.id };
  }
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(req.organizationId) || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(req.propertyId)) throw new SyncRequestError("Bad ids.");
  return db.transaction(async (tx) => {
    const active = await tx.select().from(hubs).where(and(eq(hubs.propertyId, req.propertyId), isNull(hubs.retiredAt))).for("update");
    if (active.some((h) => h.organizationId !== req.organizationId)) throw new SyncAuthError("This property belongs to another organization.");
    if (active.length && !req.replace) throw new SyncRequestError("This property already has a hub. Use replace to move it to this PC.");
    for (const h of active) await tx.update(hubs).set({ retiredAt: new Date() }).where(eq(hubs.id, h.id));
    const token = randomBytes(32).toString("base64url");
    const [hub] = await tx.insert(hubs).values({ organizationId: req.organizationId, propertyId: req.propertyId, name: String(req.hubName ?? "Hub").slice(0, 100), tokenHash: sha(token), appVersion: req.appVersion?.slice(0, 40) }).returning();
    return { hubId: hub!.id, hubToken: token };
  });
}

/** The hub behind a bearer token, or SyncAuthError. Retired hubs are refused. */
export async function authenticateHub(db: Db, authorization: string | null) {
  const token = authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
  if (!token) throw new SyncAuthError("Missing hub token.");
  const [hub] = await db.select().from(hubs).where(eq(hubs.tokenHash, sha(token))).limit(1);
  if (!hub || hub.retiredAt) throw new SyncAuthError("This hub is not enrolled or was replaced.");
  return hub;
}

type Hub = Awaited<ReturnType<typeof authenticateHub>>;

/** Does the row in this event belong to the hub's organization and property? */
function ownedByHub(hub: Hub, ev: WireEvent): string | null {
  if (ev.organizationId !== hub.organizationId) return "Event is for another organization.";
  const e = syncedEntity(ev.entity);
  if (!e) return null;
  const row = ev.payload?.after ?? {};
  switch (e.scope) {
    case "organization-row":
      return ev.entityId === hub.organizationId && (row.id === undefined || row.id === hub.organizationId) ? null : "Organization row of another tenant.";
    case "property-row":
      return ev.entityId === hub.propertyId && (row.organizationId === undefined || row.organizationId === hub.organizationId) ? null : "Property row of another property.";
    case "organization":
      return row.organizationId === undefined || row.organizationId === hub.organizationId ? null : "Row of another organization.";
    case "property":
      return (row.propertyId === undefined || row.propertyId === hub.propertyId) && (row.organizationId === undefined || row.organizationId === hub.organizationId) ? null : "Row of another property.";
  }
}

/**
 * Receive a batch from a hub: apply each event once to the cloud mirror. Events the cloud cannot
 * apply are recorded as sync issues and returned as rejected, so the hub stops resending them.
 */
export async function receivePush(db: Db, hub: Hub, req: PushRequest): Promise<PushResponse> {
  if (!Array.isArray(req.events) || req.events.length > SYNC_BATCH_SIZE) throw new SyncRequestError(`Send 1 to ${SYNC_BATCH_SIZE} events.`);
  const acked: string[] = [];
  const rejected: PushResponse["rejected"] = [];
  let maxSeq = hub.lastPushedSeq;
  for (const ev of req.events) {
    if (typeof ev?.eventId !== "string" || ev.eventId.length !== 26) throw new SyncRequestError("Bad event id.");
    const problem = ownedByHub(hub, ev);
    const reject = async (reason: string) => {
      await db.insert(syncIssues).values({ eventId: ev.eventId, direction: "in", entity: String(ev.entity).slice(0, 100), entityId: String(ev.entityId).slice(0, 100), reason }).onConflictDoNothing();
      rejected.push({ eventId: ev.eventId, reason });
    };
    if (problem) {
      await reject(problem);
      continue;
    }
    const e = syncedEntity(ev.entity);
    try {
      await db.transaction(async (tx) => {
        await applyOnce(tx, ev, `hub:${hub.id}`, async () => {
          // Commands and local-only entities are recorded in the inbox (for the audit trail) but change no mirror row.
          if (!e || ev.op === "command" || !ev.payload?.after) return;
          await upsertRow(tx, e, { ...ev.payload.after, id: ev.entityId });
        });
      });
      acked.push(ev.eventId);
    } catch (err) {
      const cause = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message;
      await reject(`Could not apply: ${cause}`.slice(0, 500));
    }
    const s = BigInt(ev.seq ?? "0");
    if (s > maxSeq) maxSeq = s;
  }
  await db.update(hubs).set({ lastSyncAt: new Date(), lastPushedSeq: maxSeq, appVersion: req.appVersion?.slice(0, 40) ?? hub.appVersion }).where(eq(hubs.id, hub.id));
  return { acked, rejected };
}

/** Cloud-made events for the hub's property (online bookings, payment confirmations), after a cursor. */
export async function eventsForHub(db: Db, hub: Hub, after: string): Promise<PullResponse> {
  const cursor = /^\d{1,19}$/.test(after) ? BigInt(after) : 0n;
  const rows = await db
    .select()
    .from(outboxEvents)
    .where(and(eq(outboxEvents.propertyId, hub.propertyId), gt(outboxEvents.seq, cursor)))
    .orderBy(asc(outboxEvents.seq))
    .limit(SYNC_BATCH_SIZE + 1);
  await db.update(hubs).set({ lastSyncAt: new Date() }).where(eq(hubs.id, hub.id));
  const page = rows.slice(0, SYNC_BATCH_SIZE);
  return {
    events: page.map(toWire),
    cursor: page.length ? page[page.length - 1]!.seq.toString() : cursor.toString(),
    more: rows.length > SYNC_BATCH_SIZE,
  };
}

export function toWire(r: typeof outboxEvents.$inferSelect): WireEvent {
  return { eventId: r.eventId, seq: r.seq.toString(), organizationId: r.organizationId, propertyId: r.propertyId, entity: r.entity, entityId: r.entityId, op: r.op, payload: r.payload as WireEvent["payload"], createdAt: r.createdAt.toISOString() };
}

/** Every mirrored row of the hub's property, for restoring a replaced hub (P2.2, UC-13). */
export async function snapshotForHub(db: Db, hub: Hub): Promise<SnapshotResponse> {
  const tables: SnapshotResponse["tables"] = [];
  for (const e of SYNCED) {
    const where =
      e.scope === "organization-row" ? sql`id = ${hub.organizationId}` :
      e.scope === "property-row" ? sql`id = ${hub.propertyId}` :
      e.scope === "organization" ? sql`organization_id = ${hub.organizationId}` :
      sql`property_id = ${hub.propertyId}`;
    const r = await db.execute(sql`select to_jsonb(t) as row from ${sql.identifier(e.table)} t where ${where}`);
    tables.push({ entity: e.entity, rows: r.rows.map((x) => (x as { row: Record<string, unknown> }).row) });
  }
  return { organizationId: hub.organizationId, propertyId: hub.propertyId, tables };
}

/** Sales guard input (FR-54): minutes since the property's hub last synced, or null if never. */
export async function minutesSinceHubSync(db: Db, propertyId: string, now = new Date()): Promise<number | null> {
  const [h] = await db.select().from(hubs).where(and(eq(hubs.propertyId, propertyId), isNull(hubs.retiredAt))).limit(1);
  if (!h?.lastSyncAt) return null;
  return (now.getTime() - h.lastSyncAt.getTime()) / 60_000;
}
