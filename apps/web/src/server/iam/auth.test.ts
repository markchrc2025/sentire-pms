import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { auditLog, organizations, properties, propertyRoles, sessions, users } from "@sentire-pms/db/schema";
import { firstRunSetup, hasAnyUser, MAX_FAILED_SIGN_INS, propertiesForUser, signIn, signOut, userForToken } from "./auth";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the right password and rejects others", async () => {
    const h = await hashPassword("correct horse 1");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await verifyPassword("correct horse 1", h)).toBe(true);
    expect(await verifyPassword("correct horse 2", h)).toBe(false);
    expect(await verifyPassword("x", null)).toBe(false);
  });
  it("enforces the minimum rule", () => {
    expect(passwordProblem("short1")).toMatch(/10/);
    expect(passwordProblem("longbutnonumber")).toMatch(/number/);
    expect(passwordProblem("goodpassword1")).toBeNull();
  });
});

describe.skipIf(!TEST_DATABASE_URL)("sign-in and sessions (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  beforeAll(async () => {
    c = await freshTestDb();
  });
  afterAll(async () => {
    await c?.pool.end();
  });

  it("first-run setup works once only", async () => {
    expect(await hasAnyUser(c.db)).toBe(false);
    const bad = await firstRunSetup(c.db, { organizationName: "Org", propertyName: "Inn", propertySlug: "my-inn", businessDate: "2026-11-24", ownerName: "Owner", ownerEmail: "o@x.example", password: "short" });
    expect(bad.ok).toBe(false);
    const ok = await firstRunSetup(c.db, { organizationName: "Org", propertyName: "Inn", propertySlug: "my-inn", businessDate: "2026-11-24", ownerName: "Owner", ownerEmail: "O@X.example", password: "goodpassword1" });
    expect(ok).toEqual({ ok: true, propertySlug: "my-inn" });
    const again = await firstRunSetup(c.db, { organizationName: "Org2", propertyName: "Inn2", propertySlug: "other", businessDate: "2026-11-24", ownerName: "Mallory", ownerEmail: "m@x.example", password: "goodpassword1" });
    expect(again.ok).toBe(false);
    expect(await c.db.select().from(properties)).toHaveLength(1);
  });

  it("signs in with the right password, case-insensitive email, and creates a hashed session", async () => {
    const r = await signIn(c.db, { email: " o@x.EXAMPLE ", password: "goodpassword1" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [s] = await c.db.select().from(sessions);
    expect(s!.tokenHash).not.toBe(r.token);
    expect(s!.tokenHash).toHaveLength(64);
    const u = await userForToken(c.db, r.token);
    expect(u?.email).toBe("o@x.example");
    expect((await propertiesForUser(c.db, r.userId))[0]?.role).toBe("OWNER");
  });

  it("gives the same message for unknown email and wrong password", async () => {
    const a = await signIn(c.db, { email: "nobody@x.example", password: "whatever1" });
    const b = await signIn(c.db, { email: "o@x.example", password: "wrongpassword1" });
    expect(a).toEqual({ ok: false, error: "Email or password is not correct." });
    expect(b).toEqual(a);
  });

  it("locks the account after five wrong passwords, then unlocks after 15 minutes", async () => {
    const now = new Date("2026-11-24T02:00:00Z");
    for (let i = 1; i < MAX_FAILED_SIGN_INS; i++) await signIn(c.db, { email: "o@x.example", password: "nope" }, {}, now);
    const fifth = await signIn(c.db, { email: "o@x.example", password: "nope" }, {}, now);
    expect(fifth.ok).toBe(false);
    if (!fifth.ok) expect(fifth.error).toMatch(/Too many/);
    const right = await signIn(c.db, { email: "o@x.example", password: "goodpassword1" }, {}, new Date(now.getTime() + 60_000));
    expect(right.ok).toBe(false);
    const later = await signIn(c.db, { email: "o@x.example", password: "goodpassword1" }, {}, new Date(now.getTime() + 16 * 60_000));
    expect(later.ok).toBe(true);
    const locks = await c.db.select().from(auditLog).where(eq(auditLog.action, "user.locked"));
    expect(locks).toHaveLength(1);
  });

  it("rejects expired, revoked and deactivated sessions", async () => {
    const r = await signIn(c.db, { email: "o@x.example", password: "goodpassword1" });
    if (!r.ok) throw new Error("sign-in failed");
    expect(await userForToken(c.db, r.token, new Date(Date.now() + 13 * 3_600_000))).toBeNull();
    expect(await userForToken(c.db, "forged-token")).toBeNull();
    await signOut(c.db, r.token);
    expect(await userForToken(c.db, r.token)).toBeNull();
    const r2 = await signIn(c.db, { email: "o@x.example", password: "goodpassword1" });
    if (!r2.ok) throw new Error("sign-in failed");
    await c.db.update(users).set({ active: false }).where(eq(users.email, "o@x.example"));
    expect(await userForToken(c.db, r2.token)).toBeNull();
    expect((await signIn(c.db, { email: "o@x.example", password: "goodpassword1" })).ok).toBe(false);
  });

  it("a user of another organization sees none of this hub's properties", async () => {
    const [org] = await c.db.insert(organizations).values({ name: "Other" }).returning();
    const [u] = await c.db.insert(users).values({ organizationId: org!.id, email: "x@other.example", name: "X", passwordHash: await hashPassword("goodpassword1") }).returning();
    expect(await propertiesForUser(c.db, u!.id)).toEqual([]);
    expect(await c.db.select().from(propertyRoles).where(eq(propertyRoles.userId, u!.id))).toEqual([]);
  });
});
