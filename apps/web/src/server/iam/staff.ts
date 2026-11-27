import { and, asc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@sentire-pms/db";
import { propertyRoles, sessions, users } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "./tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isUniqueViolation } from "./errors";
import { hashPassword, passwordProblem } from "./password";
import { recordChange } from "../data/write";

const ROLE = z.enum(["OWNER", "ADMIN", "FRONT_DESK", "HOUSEKEEPING", "ACCOUNTANT"]);

/** Staff with a role at this property (UC-12). */
export async function listStaff(db: Db, ctx: TenantContext) {
  authorize(ctx, "users.manage");
  return db
    .select({ id: users.id, name: users.name, email: users.email, active: users.active, lastSignInAt: users.lastSignInAt, role: propertyRoles.role })
    .from(propertyRoles)
    .innerJoin(users, eq(users.id, propertyRoles.userId))
    .where(and(eq(propertyRoles.propertyId, ctx.propertyId), eq(propertyRoles.organizationId, ctx.organizationId)))
    .orderBy(asc(users.name));
}

export const staffInput = z.object({
  name: z.string().trim().min(2, "Enter the name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(254),
  role: ROLE,
  password: z.string().max(200),
});

function guardOwnerRole(ctx: TenantContext, role: string) {
  if (role === "OWNER" && ctx.role !== "OWNER") throw new ForbiddenError("Only an Owner can give the Owner role.");
}

/** Add a staff member with a temporary password, or give an existing user of this organization a role here. */
export async function addStaff(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "users.manage");
  const d = staffInput.parse(raw);
  guardOwnerRole(ctx, d.role);
  const problem = passwordProblem(d.password);
  if (problem) throw new ValidationError(problem, "password");
  const hash = await hashPassword(d.password);
  try {
    return await db.transaction(async (tx) => {
      let [u] = await tx.select().from(users).where(eq(users.email, d.email)).limit(1);
      if (u && u.organizationId !== ctx.organizationId) throw new ConflictError("That email belongs to another company's account.");
      if (!u) {
        [u] = await tx.insert(users).values({ organizationId: ctx.organizationId, email: d.email, name: d.name, passwordHash: hash }).returning();
        await recordChange(tx, ctx, { entity: "user", entityId: u!.id, op: "insert", action: "user.create", after: { id: u!.id, email: u!.email, name: u!.name } });
      }
      const [role] = await tx.insert(propertyRoles).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, userId: u!.id, role: d.role }).returning();
      await recordChange(tx, ctx, { entity: "property_role", entityId: role!.id, op: "insert", action: "staff.add", after: { userId: u!.id, role: d.role } });
      return { userId: u!.id, role: d.role };
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("That person already has a role at this property.");
    throw e;
  }
}

async function roleRow(db: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], ctx: TenantContext, userId: string) {
  const [r] = await db.select().from(propertyRoles).where(and(eq(propertyRoles.userId, userId), eq(propertyRoles.propertyId, ctx.propertyId))).for("update");
  if (!r) throw new NotFoundError("Staff member not found.");
  return r;
}

async function ownersLeft(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], ctx: TenantContext, exceptUserId: string) {
  const [r] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(propertyRoles)
    .innerJoin(users, eq(users.id, propertyRoles.userId))
    .where(and(eq(propertyRoles.propertyId, ctx.propertyId), eq(propertyRoles.role, "OWNER"), eq(users.active, true), ne(users.id, exceptUserId)));
  return r?.n ?? 0;
}

export async function changeStaffRole(db: Db, ctx: TenantContext, userId: string, role: string) {
  authorize(ctx, "users.manage");
  const newRole = ROLE.parse(role);
  guardOwnerRole(ctx, newRole);
  return db.transaction(async (tx) => {
    const before = await roleRow(tx, ctx, userId);
    if (before.role === "OWNER" && ctx.role !== "OWNER") throw new ForbiddenError("Only an Owner can change an Owner.");
    if (before.role === "OWNER" && newRole !== "OWNER" && (await ownersLeft(tx, ctx, userId)) === 0) throw new ValidationError("A property needs at least one active Owner.");
    const [after] = await tx.update(propertyRoles).set({ role: newRole }).where(eq(propertyRoles.id, before.id)).returning();
    await recordChange(tx, ctx, { entity: "property_role", entityId: before.id, op: "update", action: "staff.role_change", before, after });
    return after!;
  });
}

/** Deactivate or reactivate a staff account. Deactivation signs them out everywhere. */
export async function setStaffActive(db: Db, ctx: TenantContext, userId: string, active: boolean) {
  authorize(ctx, "users.manage");
  if (userId === ctx.userId && !active) throw new ValidationError("You cannot deactivate yourself.");
  return db.transaction(async (tx) => {
    const r = await roleRow(tx, ctx, userId);
    if (r.role === "OWNER" && ctx.role !== "OWNER") throw new ForbiddenError("Only an Owner can deactivate an Owner.");
    if (r.role === "OWNER" && !active && (await ownersLeft(tx, ctx, userId)) === 0) throw new ValidationError("A property needs at least one active Owner.");
    const [before] = await tx.select({ id: users.id, active: users.active }).from(users).where(and(eq(users.id, userId), eq(users.organizationId, ctx.organizationId))).for("update");
    if (!before) throw new NotFoundError("Staff member not found.");
    await tx.update(users).set({ active }).where(eq(users.id, userId));
    if (!active) await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} is null`));
    await recordChange(tx, ctx, { entity: "user", entityId: userId, op: "update", action: active ? "user.activate" : "user.deactivate", before, after: { id: userId, active } });
  });
}

export async function resetStaffPassword(db: Db, ctx: TenantContext, userId: string, password: string) {
  authorize(ctx, "users.manage");
  const problem = passwordProblem(password);
  if (problem) throw new ValidationError(problem, "password");
  const hash = await hashPassword(password);
  return db.transaction(async (tx) => {
    const r = await roleRow(tx, ctx, userId);
    if (r.role === "OWNER" && ctx.role !== "OWNER" ) throw new ForbiddenError("Only an Owner can reset an Owner's password.");
    await tx.update(users).set({ passwordHash: hash, failedSignIns: 0, lockedUntil: null }).where(and(eq(users.id, userId), eq(users.organizationId, ctx.organizationId)));
    await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, userId), sql`${sessions.revokedAt} is null`));
    await recordChange(tx, ctx, { entity: "user", entityId: userId, op: "update", action: "user.password_reset", after: { id: userId } });
  });
}
