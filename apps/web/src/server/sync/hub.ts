import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { newId } from "@sentire-pms/core";
import { SYNC_BATCH_SIZE, type EnrollRequest, type EnrollResponse, type PullResponse, type PushRequest, type PushResponse, type SnapshotResponse, type WireEvent } from "@sentire-pms/sync";
import type { Db } from "@sentire-pms/db";
import { auditLog, inboxEvents, outboxEvents, properties, syncIssues, syncState, users } from "@sentire-pms/db/schema";
import { applyOnce, upsertRow } from "./apply";
import { SYNCED, syncedEntity } from "./registry";
import { toWire } from "./cloud";
import { hashPassword, passwordProblem } from "../iam/password";
import { ValidationError } from "../iam/errors";
import { APP_VERSION } from "@/lib/version";

/** How the hub talks to the cloud. The HTTP transport is the real one; tests pass a fake. */
export interface Transport {
  enroll(req: EnrollRequest): Promise<EnrollResponse>;
  push(token: string, req: PushRequest): Promise<PushResponse>;
  pull(token: string, after: string): Promise<PullResponse>;
  snapshot(token: string): Promise<SnapshotResponse>;
}

export function httpTransport(cloudUrl: string, fetchImpl: typeof fetch = fetch): Transport {
  const base = cloudUrl.replace(/\/$/, "");
  const call = async <T>(path: string, init: RequestInit & { token?: string }): Promise<T> => {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (init.token) headers.authorization = `Bearer ${init.token}`;
    const r = await fetchImpl(`${base}${path}`, { ...init, headers, signal: AbortSignal.timeout(30_000) });
    const body = (await r.json().catch(() => ({}))) as T & { error?: string };
    if (!r.ok) throw new SyncHttpError(r.status, body.error ?? `Cloud answered ${r.status}`);
    return body;
  };
  return {
    enroll: (req) => call("/api/sync/enroll", { method: "POST", body: JSON.stringify(req) }),
    push: (token, req) => call("/api/sync/push", { method: "POST", token, body: JSON.stringify(req) }),
    pull: (token, after) => call(`/api/sync/pull?after=${encodeURIComponent(after)}`, { method: "GET", token }),
    snapshot: (token) => call("/api/sync/snapshot", { method: "GET", token }),
  };
}

export class SyncHttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

export async function getSyncState(db: Db) {
  const [s] = await db.select().from(syncState).limit(1);
  return s ?? null;
}

/**
 * Enroll this hub with Sentire Cloud, then queue a full snapshot of the property so the cloud
 * mirror starts complete. Run by an Admin from the sync screen (or on boot for staging).
 */
export async function enrollThisHub(db: Db, t: Transport, input: { cloudUrl: string; enrollKey: string; hubName: string; propertyId?: string; replace?: boolean }) {
  const [prop] = input.propertyId
    ? await db.select().from(properties).where(eq(properties.id, input.propertyId)).limit(1)
    : await db.select().from(properties).limit(1);
  if (!prop) throw new ValidationError("Set up the property first.");
  const res = await t.enroll({ enrollKey: input.enrollKey, hubName: input.hubName, organizationId: prop.organizationId, propertyId: prop.id, propertySlug: prop.slug, appVersion: APP_VERSION, replace: input.replace });
  await db.transaction(async (tx) => {
    await tx.delete(syncState);
    await tx.insert(syncState).values({ id: newId(), hubId: res.hubId, hubToken: res.hubToken, cloudUrl: input.cloudUrl, organizationId: prop.organizationId, propertyId: prop.id, enrolledAt: new Date() });
    // Earlier events are covered by the snapshot below, which carries every row as it is now.
    await tx.update(outboxEvents).set({ ackedAt: new Date() }).where(isNull(outboxEvents.ackedAt));
    await enqueueSnapshot(tx, prop.organizationId, prop.id);
    await tx.insert(auditLog).values({ organizationId: prop.organizationId, propertyId: prop.id, action: "hub.enrolled", entity: "hub", entityId: res.hubId, after: { cloudUrl: input.cloudUrl, replace: Boolean(input.replace) } });
  });
  return res.hubId;
}

/** Outbox events for every synced row of the property, parents first. The cloud upserts them. */
export async function enqueueSnapshot(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], organizationId: string, propertyId: string) {
  for (const e of SYNCED) {
    const where =
      e.scope === "organization-row" ? sql`id = ${organizationId}` :
      e.scope === "property-row" ? sql`id = ${propertyId}` :
      e.scope === "organization" ? sql`organization_id = ${organizationId}` :
      sql`property_id = ${propertyId}`;
    const r = await tx.execute(sql`select to_jsonb(t) as row from ${sql.identifier(e.table)} t where ${where} order by id`);
    for (const x of r.rows as { row: Record<string, unknown> }[]) {
      const row = camelize(x.row);
      await tx.insert(outboxEvents).values({ eventId: newId(), organizationId, propertyId, entity: e.entity, entityId: String(row.id), op: "insert", payload: { action: "snapshot", after: stripSecrets(row) } });
    }
  }
}

const camel = (k: string) => k.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());
function camelize(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [camel(k), v]));
}
function stripSecrets(row: Record<string, unknown>) {
  const { passwordHash: _a, pinHash: _b, offlineCredentialHash: _c, failedSignIns: _d, lockedUntil: _e, ...rest } = row;
  return rest;
}

export interface SyncRound {
  pushed: number;
  rejected: number;
  pulled: number;
  ok: boolean;
  error?: string;
}

/**
 * One sync round: push unacknowledged outbox events in order, then pull cloud events and apply
 * each once. Safe to interrupt at any point: unacked events are resent and the cloud ignores
 * duplicates; pulled events are applied with the inbox check and the cursor moves after.
 */
export async function syncOnce(db: Db, t: Transport, now = () => new Date()): Promise<SyncRound> {
  const st = await getSyncState(db);
  if (!st?.hubToken) return { pushed: 0, rejected: 0, pulled: 0, ok: false, error: "Not enrolled with Sentire Cloud." };
  const round: SyncRound = { pushed: 0, rejected: 0, pulled: 0, ok: true };
  await db.update(syncState).set({ lastAttemptAt: now() }).where(eq(syncState.id, st.id));
  try {
    // Push
    for (;;) {
      const batch = await db.select().from(outboxEvents).where(isNull(outboxEvents.ackedAt)).orderBy(asc(outboxEvents.seq)).limit(SYNC_BATCH_SIZE);
      if (!batch.length) break;
      const res = await t.push(st.hubToken, { events: batch.map(toWire), appVersion: APP_VERSION });
      const done = new Set([...res.acked, ...res.rejected.map((r) => r.eventId)]);
      if (!done.size) throw new Error("Cloud acknowledged nothing.");
      await db.transaction(async (tx) => {
        await tx.update(outboxEvents).set({ ackedAt: now() }).where(and(inArray(outboxEvents.eventId, [...done]), isNull(outboxEvents.ackedAt)));
        for (const r of res.rejected) {
          const ev = batch.find((b) => b.eventId === r.eventId);
          await tx.insert(syncIssues).values({ eventId: r.eventId, direction: "out", entity: ev?.entity ?? "?", entityId: ev?.entityId, reason: r.reason.slice(0, 500) }).onConflictDoNothing();
        }
        const maxSeq = batch.filter((b) => done.has(b.eventId)).reduce((m, b) => (b.seq > m ? b.seq : m), st.lastPushedSeq);
        await tx.update(syncState).set({ lastPushedSeq: maxSeq }).where(eq(syncState.id, st.id));
      });
      round.pushed += res.acked.length;
      round.rejected += res.rejected.length;
      if (batch.length < SYNC_BATCH_SIZE) break;
    }
    // Pull
    let cursor = st.lastPulledCursor ?? "0";
    for (;;) {
      const page = await t.pull(st.hubToken, cursor);
      for (const ev of page.events) round.pulled += (await applyCloudEvent(db, st.propertyId!, ev)) ? 1 : 0;
      cursor = page.cursor;
      await db.update(syncState).set({ lastPulledCursor: cursor }).where(eq(syncState.id, st.id));
      if (!page.more) break;
    }
    await db.update(syncState).set({ lastSuccessAt: now(), lastError: null, consecutiveFailures: 0, nextAttemptAt: null }).where(eq(syncState.id, st.id));
  } catch (e) {
    const failures = st.consecutiveFailures + 1;
    const delayMs = Math.min(5 * 60_000, 5_000 * 2 ** Math.min(failures, 6));
    await db.update(syncState).set({ lastError: (e as Error).message.slice(0, 500), consecutiveFailures: failures, nextAttemptAt: new Date(now().getTime() + delayMs) }).where(eq(syncState.id, st.id));
    round.ok = false;
    round.error = (e as Error).message;
  }
  return round;
}

/** Handlers for cloud events that need business logic on the hub (Phase 7 adds online bookings). */
export const CLOUD_EVENT_HANDLERS: Record<string, (tx: Parameters<Parameters<Db["transaction"]>[0]>[0], ev: WireEvent) => Promise<void>> = {};

async function applyCloudEvent(db: Db, propertyId: string, ev: WireEvent): Promise<boolean> {
  if (ev.propertyId !== propertyId) return false;
  try {
    const r = await db.transaction(async (tx) =>
      applyOnce(tx, ev, "cloud", async () => {
        const handler = CLOUD_EVENT_HANDLERS[ev.payload?.action ?? ""];
        if (handler) return handler(tx, ev);
        const e = syncedEntity(ev.entity);
        if (e && ev.payload?.after && ev.op !== "command") await upsertRow(tx, e, { ...ev.payload.after, id: ev.entityId });
      }),
    );
    return r === "applied";
  } catch (err) {
    const cause = (err as { cause?: { message?: string } }).cause?.message ?? (err as Error).message;
    await db.insert(syncIssues).values({ eventId: ev.eventId, direction: "pull", entity: ev.entity, entityId: ev.entityId, reason: `Could not apply: ${cause}`.slice(0, 500) }).onConflictDoNothing();
    // Record it in the inbox so it is not retried forever; an Admin resolves it from the sync screen.
    await db.insert(inboxEvents).values({ eventId: ev.eventId, source: "cloud-rejected", payload: ev.payload as object }).onConflictDoNothing();
    return false;
  }
}

/**
 * Restore a replaced hub from the cloud (P2.2, UC-13): enroll as the property's new hub, download
 * every mirrored row, and set a new password for the owner (passwords never leave a hub).
 */
export async function restoreFromCloud(db: Db, t: Transport, input: { cloudUrl: string; enrollKey: string; hubName: string; organizationId?: string; propertyId?: string; propertySlug?: string; ownerEmail: string; ownerPassword: string }) {
  const problem = passwordProblem(input.ownerPassword);
  if (problem) throw new ValidationError(problem);
  const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(properties);
  if (n > 0) throw new ValidationError("This hub already has a property. Restore only works on an empty hub.");
  const res = await t.enroll({ enrollKey: input.enrollKey, hubName: input.hubName, organizationId: input.organizationId ?? "", propertyId: input.propertyId ?? "", propertySlug: input.propertySlug ?? "", appVersion: APP_VERSION, replace: true });
  const snap = await t.snapshot(res.hubToken);
  const organizationId = snap.organizationId;
  const propertyId = snap.propertyId;
  const hash = await hashPassword(input.ownerPassword);
  await db.transaction(async (tx) => {
    for (const table of snap.tables) {
      const e = syncedEntity(table.entity);
      if (!e) continue;
      for (const row of table.rows) await upsertRow(tx, e, row);
    }
    const email = input.ownerEmail.trim().toLowerCase();
    const [owner] = await tx.update(users).set({ passwordHash: hash }).where(and(eq(users.email, email), eq(users.organizationId, organizationId))).returning();
    if (!owner) throw new ValidationError("That owner email is not in the restored data.");
    await tx.insert(syncState).values({ id: newId(), hubId: res.hubId, hubToken: res.hubToken, cloudUrl: input.cloudUrl, organizationId, propertyId, enrolledAt: new Date(), lastSuccessAt: new Date() });
    await tx.insert(auditLog).values({ organizationId, propertyId, action: "hub.restored", entity: "hub", entityId: res.hubId, after: { rows: snap.tables.reduce((a, x) => a + x.rows.length, 0) } });
  });
  return res.hubId;
}

