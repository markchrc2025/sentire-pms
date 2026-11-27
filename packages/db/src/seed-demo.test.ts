import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDb, TEST_DATABASE_URL } from "./test/db";
import { properties } from "./schema";
import { seedDemo } from "./seed-demo";

describe.skipIf(!TEST_DATABASE_URL)("seedDemo (integration, Postgres)", () => {
  let ctx: Awaited<ReturnType<typeof freshTestDb>>;
  beforeAll(async () => {
    ctx = await freshTestDb();
  });
  afterAll(async () => {
    await ctx?.pool.end();
  });
  it("seeds once and never again", async () => {
    expect(await seedDemo(ctx.db)).toBe(true);
    expect(await seedDemo(ctx.db)).toBe(false);
    expect(await ctx.db.select().from(properties)).toHaveLength(1);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("seedDemo users (integration, Postgres)", () => {
  it("creates one staff user per role, with a password only when PMS_DEMO_PASSWORD is given", async () => {
    const c = await freshTestDb();
    const { users, propertyRoles } = await import("./schema");
    const { verifyPassword } = await import("./password");
    await seedDemo(c.db, undefined);
    expect((await c.db.select().from(users)).every((u) => u.passwordHash === null)).toBe(true);
    await seedDemo(c.db, "demo-pass-123");
    const all = await c.db.select().from(users);
    expect(all).toHaveLength(5);
    expect(await verifyPassword("demo-pass-123", all[0]!.passwordHash)).toBe(true);
    expect(await c.db.select().from(propertyRoles)).toHaveLength(5);
    const { rooms, roomTypes, taxFees } = await import("./schema");
    expect(await c.db.select().from(roomTypes)).toHaveLength(4);
    expect(await c.db.select().from(rooms)).toHaveLength(25);
    expect((await c.db.select().from(taxFees)).map((t) => t.code).sort()).toEqual(["PWD", "SC", "VAT"]);
    const { ratePlans, policies } = await import("./schema");
    expect((await c.db.select().from(ratePlans)).map((r) => r.code).sort()).toEqual(["BAR", "BB", "NR"]);
    expect(await c.db.select().from(policies)).toHaveLength(2);
    await c.pool.end();
  });
});
