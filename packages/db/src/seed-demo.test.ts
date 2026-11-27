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
