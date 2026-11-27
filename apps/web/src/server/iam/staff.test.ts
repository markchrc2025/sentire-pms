import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { makeProperty } from "@/test/fixtures";
import { addStaff, changeStaffRole, listStaff, resetStaffPassword, setStaffActive } from "./staff";
import { signIn, userForToken } from "./auth";
import { ConflictError, ForbiddenError, ValidationError } from "./errors";

describe.skipIf(!TEST_DATABASE_URL)("staff management (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  let p: Awaited<ReturnType<typeof makeProperty>>;
  let q: Awaited<ReturnType<typeof makeProperty>>;
  beforeAll(async () => {
    c = await freshTestDb();
    p = await makeProperty(c.db);
    q = await makeProperty(c.db);
  });
  afterAll(async () => {
    await c?.pool.end();
  });

  it("adds staff who can then sign in, and only Admins and Owners may", async () => {
    await expect(addStaff(c.db, p.ctx.FRONT_DESK, { name: "New", email: "n@x.example", role: "FRONT_DESK", password: "temporary123" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(addStaff(c.db, p.ctx.ADMIN, { name: "New", email: "n@x.example", role: "FRONT_DESK", password: "short" })).rejects.toBeInstanceOf(ValidationError);
    await expect(addStaff(c.db, p.ctx.ADMIN, { name: "Boss", email: "b@x.example", role: "OWNER", password: "temporary123" })).rejects.toBeInstanceOf(ForbiddenError);
    const s = await addStaff(c.db, p.ctx.ADMIN, { name: "New Desk", email: "N@x.example", role: "FRONT_DESK", password: "temporary123" });
    expect((await signIn(c.db, { email: "n@x.example", password: "temporary123" })).ok).toBe(true);
    await expect(addStaff(c.db, p.ctx.ADMIN, { name: "New Desk", email: "n@x.example", role: "HOUSEKEEPING", password: "temporary123" })).rejects.toBeInstanceOf(ConflictError);
    // Another company cannot claim this email.
    await expect(addStaff(c.db, q.ctx.OWNER, { name: "Xavier", email: "n@x.example", role: "FRONT_DESK", password: "temporary123" })).rejects.toBeInstanceOf(ConflictError);
    expect((await listStaff(c.db, q.ctx.OWNER)).some((x) => x.email === "n@x.example")).toBe(false);
    await changeStaffRole(c.db, p.ctx.ADMIN, s.userId, "HOUSEKEEPING");
    expect((await listStaff(c.db, p.ctx.ADMIN)).find((x) => x.id === s.userId)?.role).toBe("HOUSEKEEPING");
  });

  it("deactivation and password reset end sessions; the last Owner stays", async () => {
    const r = await signIn(c.db, { email: "n@x.example", password: "temporary123" });
    if (!r.ok) throw new Error("no sign-in");
    await resetStaffPassword(c.db, p.ctx.ADMIN, r.userId, "brandnewpass9");
    expect(await userForToken(c.db, r.token)).toBeNull();
    await setStaffActive(c.db, p.ctx.ADMIN, r.userId, false);
    expect((await signIn(c.db, { email: "n@x.example", password: "brandnewpass9" })).ok).toBe(false);
    await expect(setStaffActive(c.db, p.ctx.OWNER, p.ctx.OWNER.userId, false)).rejects.toBeInstanceOf(ValidationError);
    await expect(changeStaffRole(c.db, p.ctx.OWNER, p.ctx.OWNER.userId, "ADMIN")).rejects.toBeInstanceOf(ValidationError);
    await expect(setStaffActive(c.db, p.ctx.ADMIN, p.ctx.OWNER.userId, false)).rejects.toBeInstanceOf(ForbiddenError);
  });
});
