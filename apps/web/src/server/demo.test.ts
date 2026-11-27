import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { seedDemo } from "@sentire-pms/db";
import { properties, reservations } from "@sentire-pms/db/schema";
import "./demo";

describe.skipIf(!TEST_DATABASE_URL)("demo stays (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  beforeAll(async () => {
    c = await freshTestDb();
  });
  afterAll(async () => {
    await c?.pool.end();
  });
  it("books the demo stays through the services and leaves the business date at 24 Nov 2026", async () => {
    await seedDemo(c.db, "demo-pass-123");
    const rows = await c.db.select().from(reservations);
    expect(rows).toHaveLength(10);
    expect(rows.filter((r) => r.status === "CHECKED_IN")).toHaveLength(3);
    expect(rows.filter((r) => r.status === "CANCELLED")).toHaveLength(1);
    expect((await c.db.select().from(properties))[0]!.businessDate).toBe("2026-11-24");
    await seedDemo(c.db, "demo-pass-123");
    expect(await c.db.select().from(reservations)).toHaveLength(10);
  });
});
