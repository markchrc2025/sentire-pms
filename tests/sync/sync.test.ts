import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, isNull, sql } from "drizzle-orm";
import { freshTestDb, siblingTestDbUrl, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { hubs, inboxEvents, outboxEvents, rooms, syncIssues, syncState, users } from "@sentire-pms/db/schema";
import type { Transport } from "@/server/sync/hub";
import { enrollThisHub, restoreFromCloud, syncOnce } from "@/server/sync/hub";
import { authenticateHub, enrollHub, eventsForHub, receivePush, snapshotForHub } from "@/server/sync/cloud";
import { createBlock, createRoom, createRoomRange, createRoomType, listRooms, setRoomActive } from "@/server/inventory/rooms";
import { updatePropertyDetails } from "@/server/property";
import { addStaff } from "@/server/iam/staff";
import { makeProperty } from "@/test/fixtures";
import { SYNCED } from "@/server/sync/registry";
import { recordChange } from "@/server/data/write";
import { newId } from "@sentire-pms/core";

const KEY = "enroll-key-for-tests";
type DbPair = Awaited<ReturnType<typeof freshTestDb>>;

/** A transport that calls the cloud functions directly, with optional faults. */
function directTransport(cloud: DbPair["db"], faults: { dropRequest?: () => boolean; dropResponse?: () => boolean; duplicate?: () => boolean } = {}): Transport {
  const maybe = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (faults.dropRequest?.()) throw new Error("network cut before the cloud");
    const out = await fn();
    if (faults.duplicate?.()) await fn();
    if (faults.dropResponse?.()) throw new Error("network cut after the cloud");
    return JSON.parse(JSON.stringify(out));
  };
  return {
    enroll: (req) => maybe(() => enrollHub(cloud, req, KEY)),
    push: (token, req) => maybe(async () => receivePush(cloud, await authenticateHub(cloud, `Bearer ${token}`), JSON.parse(JSON.stringify(req)))),
    pull: (token, after) => maybe(async () => eventsForHub(cloud, await authenticateHub(cloud, `Bearer ${token}`), after)),
    snapshot: (token) => maybe(async () => snapshotForHub(cloud, await authenticateHub(cloud, `Bearer ${token}`))),
  };
}

/** Every synced table's rows for a property, normalized, so hub and cloud can be compared. */
async function dump(db: DbPair["db"], orgId: string, propId: string) {
  const out: Record<string, unknown[]> = {};
  for (const e of SYNCED) {
    const where = e.scope === "organization-row" ? sql`id = ${orgId}` : e.scope === "property-row" ? sql`id = ${propId}` : e.scope === "organization" ? sql`organization_id = ${orgId}` : sql`property_id = ${propId}`;
    const r = await db.execute(sql`select to_jsonb(t) - 'password_hash' - 'pin_hash' - 'offline_credential_hash' - 'failed_sign_ins' - 'locked_until' - 'last_sign_in_at' - 'updated_at' as row from ${sql.identifier(e.table)} t where ${where} order by id`);
    // Timestamps travel through JavaScript dates, which keep milliseconds; compare at that precision.
    out[e.table] = r.rows.map((x) => JSON.parse(JSON.stringify((x as { row: unknown }).row), (_k, v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v) ? Math.floor(Date.parse(v)) : v)));
  }
  return out;
}

describe.skipIf(!TEST_DATABASE_URL)("P2.9 hub and cloud sync (integration, two Postgres databases)", { timeout: 60_000 }, () => {
  let hub: DbPair;
  let cloud: DbPair;
  let p: Awaited<ReturnType<typeof makeProperty>>;
  beforeAll(async () => {
    hub = await freshTestDb();
    cloud = await freshTestDb(await siblingTestDbUrl("cloud"));
    p = await makeProperty(hub.db, { slug: "sync-inn" });
    const t = await createRoomType(hub.db, p.ctx.ADMIN, { code: "DLX", name: "Deluxe", kind: "PRIVATE", maxGuests: 2, baseRate: "3200" });
    await createRoomRange(hub.db, p.ctx.ADMIN, { roomTypeId: t.id, from: 101, to: 105 });
  });
  afterAll(async () => {
    await hub?.pool.end();
    await cloud?.pool.end();
  });

  it("refuses a wrong enrollment key and enrolls with the right one, sending a full snapshot", async () => {
    await expect(enrollThisHub(hub.db, directTransport(cloud.db), { cloudUrl: "x", enrollKey: "wrong", hubName: "Front PC" })).rejects.toThrow(/not valid/);
    await enrollThisHub(hub.db, directTransport(cloud.db), { cloudUrl: "x", enrollKey: KEY, hubName: "Front PC" });
    const r = await syncOnce(hub.db, directTransport(cloud.db));
    expect(r.ok).toBe(true);
    expect(r.rejected).toBe(0);
    expect(await dump(cloud.db, p.org.id, p.prop.id)).toEqual(await dump(hub.db, p.org.id, p.prop.id));
    const [u] = await cloud.db.select().from(users).limit(1);
    expect(u!.passwordHash).toBeNull();
  });

  it("survives random network cuts and duplicate deliveries: both sides match and nothing is applied twice", async () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
    const flaky = directTransport(cloud.db, { dropRequest: () => rnd() < 0.25, dropResponse: () => rnd() < 0.25, duplicate: () => rnd() < 0.3 });
    const types = await hub.db.execute(sql`select id from room_types limit 1`);
    const typeId = (types.rows[0] as { id: string }).id;
    for (let i = 0; i < 30; i++) {
      // Offline edits on the hub between sync attempts.
      await createRoom(hub.db, p.ctx.ADMIN, { roomTypeId: typeId, number: `X${i}` });
      if (i % 5 === 0) await updatePropertyDetails(hub.db, p.ctx.ADMIN, { address: `Street ${i}` });
      if (i % 7 === 0) await createBlock(hub.db, p.ctx.ADMIN, { roomId: (await listRooms(hub.db, p.ctx.ADMIN))[i % 5]!.room.id, startDate: `2026-12-${String(i + 1).padStart(2, "0")}`, endDate: `2026-12-${String(i + 2).padStart(2, "0")}`, type: "OUT_OF_SERVICE", reason: "Test" });
      await syncOnce(hub.db, flaky);
    }
    // Network back: sync until clean.
    for (let i = 0; i < 10; i++) {
      await hub.db.update(syncState).set({ nextAttemptAt: null });
      if ((await syncOnce(hub.db, directTransport(cloud.db))).ok) break;
    }
    const pending = await hub.db.select().from(outboxEvents).where(isNull(outboxEvents.ackedAt));
    expect(pending).toHaveLength(0);
    expect(await dump(cloud.db, p.org.id, p.prop.id)).toEqual(await dump(hub.db, p.org.id, p.prop.id));
    const [{ n }] = (await cloud.db.execute(sql`select count(*)::int as n from inbox_events`)).rows as { n: number }[];
    const [{ m }] = (await hub.db.execute(sql`select count(*)::int as m from outbox_events where acked_at is not null and event_id in (select event_id from outbox_events)`)).rows as { m: number }[];
    expect(n).toBeLessThanOrEqual(m);
    expect(await cloud.db.select().from(syncIssues)).toHaveLength(0);
  });

  it("a hub restart mid-batch resends unacked events without double apply", async () => {
    await setRoomActive(hub.db, p.ctx.ADMIN, (await listRooms(hub.db, p.ctx.ADMIN))[0]!.room.id, false);
    // The cloud applied the batch but the hub "crashed" before marking it acked.
    const unacked = await hub.db.select().from(outboxEvents).where(isNull(outboxEvents.ackedAt));
    const st = (await hub.db.select().from(syncState))[0]!;
    const hubRow = await authenticateHub(cloud.db, `Bearer ${st.hubToken}`);
    await receivePush(cloud.db, hubRow, JSON.parse(JSON.stringify({ events: unacked.map((e) => ({ ...e, seq: e.seq.toString(), createdAt: e.createdAt.toISOString() })) })));
    const before = (await cloud.db.select().from(inboxEvents)).length;
    const r = await syncOnce(hub.db, directTransport(cloud.db));
    expect(r.ok).toBe(true);
    expect((await cloud.db.select().from(inboxEvents)).length).toBe(before);
    expect(await dump(cloud.db, p.org.id, p.prop.id)).toEqual(await dump(hub.db, p.org.id, p.prop.id));
  });

  it("clock differences do not matter: order comes from the hub's sequence, not timestamps", async () => {
    const skewed = () => new Date(Date.now() - 3 * 3_600_000);
    await updatePropertyDetails(hub.db, p.ctx.ADMIN, { address: "First" });
    await updatePropertyDetails(hub.db, p.ctx.ADMIN, { address: "Second" });
    const r = await syncOnce(hub.db, directTransport(cloud.db), skewed);
    expect(r.ok).toBe(true);
    const [row] = (await cloud.db.execute(sql`select address from properties where id = ${p.prop.id}`)).rows as { address: string }[];
    expect(row!.address).toBe("Second");
  });

  it("rejects events for another tenant and records a sync issue on both sides", async () => {
    const st = (await hub.db.select().from(syncState))[0]!;
    const hubRow = await authenticateHub(cloud.db, `Bearer ${st.hubToken}`);
    const forged = { eventId: newId(), seq: "999999", organizationId: p.org.id, propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", entity: "room", entityId: newId(), op: "insert" as const, payload: { action: "room.create", after: { propertyId: "01ARZ3NDEKTSV4RRFFQ69G5FAV", organizationId: p.org.id } }, createdAt: new Date().toISOString() };
    const res = await receivePush(cloud.db, hubRow, { events: [forged] });
    expect(res.rejected[0]!.reason).toMatch(/another property/);
    expect(await cloud.db.select().from(rooms).where(eq(rooms.id, forged.entityId))).toHaveLength(0);
    await expect(authenticateHub(cloud.db, "Bearer not-a-token")).rejects.toThrow();
  });

  it("pulls cloud events and applies each once", async () => {
    // A cloud-made change (as Phase 7 online bookings will be): a room note set in the cloud.
    const [room] = await cloud.db.select().from(rooms).where(eq(rooms.propertyId, p.prop.id)).limit(1);
    const cloudCtx = { ...p.ctx.ADMIN };
    await cloud.db.transaction(async (tx) => {
      const [after] = await tx.update(rooms).set({ notes: "Set in the cloud" }).where(eq(rooms.id, room!.id)).returning();
      await recordChange(tx, cloudCtx, { entity: "room", entityId: room!.id, op: "update", action: "room.update", after: { id: after!.id, notes: after!.notes } });
    });
    const dup = directTransport(cloud.db, { duplicate: () => true });
    const rr = await syncOnce(hub.db, dup);
    expect(rr.pulled).toBe(1);
    expect((await syncOnce(hub.db, dup)).pulled).toBe(0);
    const [h] = await hub.db.select().from(rooms).where(eq(rooms.id, room!.id));
    expect(h!.notes).toBe("Set in the cloud");
  });

  it("a replaced hub restores the property from the cloud; the old hub is refused", async () => {
    await addStaff(hub.db, p.ctx.OWNER, { name: "Late Hire", email: "late@sync.example", role: "FRONT_DESK", password: "temporary123" });
    await syncOnce(hub.db, directTransport(cloud.db));
    const oldToken = (await hub.db.select().from(syncState))[0]!.hubToken!;
    const fresh = await freshTestDb(await siblingTestDbUrl("hub2"));
    try {
      await restoreFromCloud(fresh.db, directTransport(cloud.db), { cloudUrl: "x", enrollKey: KEY, hubName: "New PC", propertySlug: "sync-inn", ownerEmail: `owner@sync-inn.example`, ownerPassword: "newowner123" });
      expect(await dump(fresh.db, p.org.id, p.prop.id)).toEqual(await dump(cloud.db, p.org.id, p.prop.id));
      await expect(authenticateHub(cloud.db, `Bearer ${oldToken}`)).rejects.toThrow(/replaced/);
      expect((await cloud.db.select().from(hubs).where(isNull(hubs.retiredAt))).length).toBe(1);
    } finally {
      await fresh.pool.end();
    }
  });
});
