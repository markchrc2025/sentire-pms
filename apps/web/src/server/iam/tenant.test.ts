import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { auditLog, organizations, outboxEvents, properties, propertyRoles, users } from "@sentire-pms/db/schema";
import { authorize, resolveTenant } from "./tenant";
import { ForbiddenError, NotFoundError } from "./errors";
import { getProperty, updatePropertyDetails } from "../property";

describe.skipIf(!TEST_DATABASE_URL)("tenant isolation (integration, Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof freshTestDb>>;
  const ids = {} as Record<string, string>;

  beforeAll(async () => {
    ctx = await freshTestDb();
    const { db } = ctx;
    const [orgA] = await db.insert(organizations).values({ name: "Group A" }).returning();
    const [orgB] = await db.insert(organizations).values({ name: "Group B" }).returning();
    const [propA] = await db.insert(properties).values({ organizationId: orgA!.id, slug: "hotel-a", name: "Hotel A", businessDate: "2026-11-24" }).returning();
    const [propB] = await db.insert(properties).values({ organizationId: orgB!.id, slug: "hotel-b", name: "Hotel B", businessDate: "2026-11-24" }).returning();
    const [desk] = await db.insert(users).values({ organizationId: orgA!.id, email: "desk@a.example", name: "Desk A" }).returning();
    const [admin] = await db.insert(users).values({ organizationId: orgA!.id, email: "admin@a.example", name: "Admin A" }).returning();
    const [ownerB] = await db.insert(users).values({ organizationId: orgB!.id, email: "owner@b.example", name: "Owner B" }).returning();
    const [gone] = await db.insert(users).values({ organizationId: orgA!.id, email: "gone@a.example", name: "Gone", active: false }).returning();
    await db.insert(propertyRoles).values([
      { organizationId: orgA!.id, propertyId: propA!.id, userId: desk!.id, role: "FRONT_DESK" },
      { organizationId: orgA!.id, propertyId: propA!.id, userId: admin!.id, role: "ADMIN" },
      { organizationId: orgB!.id, propertyId: propB!.id, userId: ownerB!.id, role: "OWNER" },
      { organizationId: orgA!.id, propertyId: propA!.id, userId: gone!.id, role: "ADMIN" },
    ]);
    Object.assign(ids, { propA: propA!.id, propB: propB!.id, desk: desk!.id, admin: admin!.id, ownerB: ownerB!.id, gone: gone!.id });
  });
  afterAll(async () => {
    await ctx?.pool.end();
  });

  it("resolves the user's own property", async () => {
    const t = await resolveTenant(ctx.db, { userId: ids.desk!, propertySlug: "hotel-a" });
    expect(t.propertyId).toBe(ids.propA);
    expect(t.role).toBe("FRONT_DESK");
  });

  it("answers not found for another organization's property", async () => {
    await expect(resolveTenant(ctx.db, { userId: ids.desk!, propertySlug: "hotel-b" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveTenant(ctx.db, { userId: ids.ownerB!, propertySlug: "hotel-a" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(resolveTenant(ctx.db, { userId: ids.desk!, propertySlug: "no-such-hotel" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("refuses a deactivated user", async () => {
    await expect(resolveTenant(ctx.db, { userId: ids.gone!, propertySlug: "hotel-a" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("only reads the tenant's own property, even with a forged context", async () => {
    const own = await resolveTenant(ctx.db, { userId: ids.desk!, propertySlug: "hotel-a" });
    expect((await getProperty(ctx.db, own)).name).toBe("Hotel A");
    // A context pointing at B's property but A's organization must not read B.
    await expect(getProperty(ctx.db, { ...own, propertyId: ids.propB! })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("enforces permissions and records audit and outbox rows in the same write", async () => {
    const desk = await resolveTenant(ctx.db, { userId: ids.desk!, propertySlug: "hotel-a" });
    expect(() => authorize(desk, "property.manage")).toThrow(ForbiddenError);
    await expect(updatePropertyDetails(ctx.db, desk, { name: "Hacked" })).rejects.toBeInstanceOf(ForbiddenError);

    const admin = await resolveTenant(ctx.db, { userId: ids.admin!, propertySlug: "hotel-a" });
    const updated = await updatePropertyDetails(ctx.db, admin, { registeredName: "Hotel A Corp", tin: "000-000-000-00000" });
    expect(updated.registeredName).toBe("Hotel A Corp");
    const audits = await ctx.db.select().from(auditLog).where(eq(auditLog.entityId, ids.propA!));
    const events = await ctx.db.select().from(outboxEvents).where(eq(outboxEvents.entityId, ids.propA!));
    expect(audits).toHaveLength(1);
    expect(audits[0]!.actorUserId).toBe(ids.admin);
    expect(events).toHaveLength(1);
    expect(events[0]!.op).toBe("update");
    const [b] = await ctx.db.select().from(properties).where(eq(properties.id, ids.propB!));
    expect(b!.registeredName).toBeNull();
  });
});
