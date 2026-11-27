import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { newId } from "@sentire-pms/core";
import { expectDbError, freshTestDb, TEST_DATABASE_URL } from "./test/db";
import { auditLog, organizations, outboxEvents, properties, propertyRoles, users } from "./schema";

describe.skipIf(!TEST_DATABASE_URL)("base tables (integration, Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof freshTestDb>>;
  beforeAll(async () => {
    ctx = await freshTestDb();
  });
  afterAll(async () => {
    await ctx?.pool.end();
  });

  it("creates an organization, property, user and role with ULID keys", async () => {
    const { db } = ctx;
    const [org] = await db.insert(organizations).values({ name: "Demo Hospitality Group" }).returning();
    expect(org!.id).toHaveLength(26);
    const [prop] = await db
      .insert(properties)
      .values({ organizationId: org!.id, slug: "bahay-kubo-marikina", name: "Bahay Kubo Suites", businessDate: "2026-11-24" })
      .returning();
    expect(prop!.timezone).toBe("Asia/Manila");
    expect(prop!.currency).toBe("PHP");
    const [user] = await db.insert(users).values({ organizationId: org!.id, email: "owner@demo.example", name: "Owner" }).returning();
    await db.insert(propertyRoles).values({ organizationId: org!.id, propertyId: prop!.id, userId: user!.id, role: "OWNER" });
    await expectDbError(
      db.insert(propertyRoles).values({ organizationId: org!.id, propertyId: prop!.id, userId: user!.id, role: "ADMIN" }),
      /property_roles_user_property_uq/,
    );
  });

  it("keeps the audit log append-only", async () => {
    const { db } = ctx;
    const [row] = await db.insert(auditLog).values({ organizationId: newId(), action: "create", entity: "property" }).returning();
    await expectDbError(db.update(auditLog).set({ action: "edit" }).where(eq(auditLog.id, row!.id)), /append-only/);
    await expectDbError(db.delete(auditLog).where(eq(auditLog.id, row!.id)), /append-only/);
  });

  it("orders outbox events and only lets acked_at be set once", async () => {
    const { db } = ctx;
    const org = newId();
    const [a] = await db
      .insert(outboxEvents)
      .values({ eventId: newId(), organizationId: org, entity: "room", entityId: "r1", op: "insert", payload: { n: 1 } })
      .returning();
    const [b] = await db
      .insert(outboxEvents)
      .values({ eventId: newId(), organizationId: org, entity: "room", entityId: "r1", op: "update", payload: { n: 2 } })
      .returning();
    expect(b!.seq > a!.seq).toBe(true);
    await db.update(outboxEvents).set({ ackedAt: new Date() }).where(eq(outboxEvents.eventId, a!.eventId));
    await expectDbError(
      db.update(outboxEvents).set({ ackedAt: new Date(0) }).where(eq(outboxEvents.eventId, a!.eventId)),
      /only be set once/,
    );
    await expectDbError(db.update(outboxEvents).set({ payload: { n: 9 } }).where(eq(outboxEvents.eventId, b!.eventId)), /immutable/);
    await expectDbError(db.delete(outboxEvents).where(eq(outboxEvents.eventId, b!.eventId)), /cannot be deleted/);
  });
});
