import { createHash, randomBytes } from "node:crypto";
import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@sentire-pms/db";
import { auditLog, organizations, properties, propertyRoles, sessions, users } from "@sentire-pms/db/schema";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

export const SESSION_COOKIE = "pms_session";
export const SESSION_HOURS = 12;
export const MAX_FAILED_SIGN_INS = 5;
export const LOCK_MINUTES = 15;

export const signInInput = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(254),
  password: z.string().min(1, "Enter your password.").max(200),
});

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SignInResult =
  | { ok: true; token: string; userId: string; expiresAt: Date }
  | { ok: false; error: string };

const GENERIC = "Email or password is not correct.";

/**
 * Local email and password sign-in. Five wrong passwords lock the account for 15 minutes.
 * The same message is shown for an unknown email and a wrong password.
 */
export async function signIn(db: Db, raw: unknown, meta: { ip?: string; userAgent?: string } = {}, now = new Date()): Promise<SignInResult> {
  const parsed = signInInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? GENERIC };
  const { email, password } = parsed.data;
  const [u] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!u) {
    await verifyPassword(password, "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86) + "==");
    return { ok: false, error: GENERIC };
  }
  if (!u.active) return { ok: false, error: "This account is deactivated. Ask your property owner." };
  if (u.lockedUntil && u.lockedUntil > now) return { ok: false, error: `Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes.` };
  const good = await verifyPassword(password, u.passwordHash);
  if (!good) {
    const failed = (u.lockedUntil && u.lockedUntil <= now ? 0 : u.failedSignIns) + 1;
    const lock = failed >= MAX_FAILED_SIGN_INS ? new Date(now.getTime() + LOCK_MINUTES * 60_000) : null;
    await db.update(users).set({ failedSignIns: lock ? 0 : failed, lockedUntil: lock }).where(eq(users.id, u.id));
    await db.insert(auditLog).values({ organizationId: u.organizationId, actorUserId: u.id, action: lock ? "user.locked" : "user.sign_in_failed", entity: "user", entityId: u.id, before: null, after: { failed, ip: meta.ip ?? null } });
    return { ok: false, error: lock ? `Too many wrong passwords. Try again after ${LOCK_MINUTES} minutes.` : GENERIC };
  }
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3_600_000);
  await db.transaction(async (tx) => {
    await tx.insert(sessions).values({ userId: u.id, tokenHash: hashToken(token), ip: meta.ip?.slice(0, 64), userAgent: meta.userAgent?.slice(0, 500), expiresAt });
    await tx.update(users).set({ failedSignIns: 0, lockedUntil: null, lastSignInAt: now }).where(eq(users.id, u.id));
    await tx.insert(auditLog).values({ organizationId: u.organizationId, actorUserId: u.id, action: "user.signed_in", entity: "user", entityId: u.id, before: null, after: { ip: meta.ip ?? null } });
  });
  return { ok: true, token, userId: u.id, expiresAt };
}

export interface SessionUser {
  userId: string;
  organizationId: string;
  email: string;
  name: string;
  sessionId: string;
}

/** The signed-in user for a session token, or null when it is missing, expired or revoked. */
export async function userForToken(db: Db, token: string | undefined, now = new Date()): Promise<SessionUser | null> {
  if (!token) return null;
  const [r] = await db
    .select({ sessionId: sessions.id, userId: users.id, organizationId: users.organizationId, email: users.email, name: users.name, active: users.active, lastSeenAt: sessions.lastSeenAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
    .limit(1);
  if (!r || !r.active) return null;
  if (now.getTime() - r.lastSeenAt.getTime() > 60_000) await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, r.sessionId));
  return { sessionId: r.sessionId, userId: r.userId, organizationId: r.organizationId, email: r.email, name: r.name };
}

export async function signOut(db: Db, token: string | undefined): Promise<void> {
  if (!token) return;
  await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.tokenHash, hashToken(token)), isNull(sessions.revokedAt)));
}

/** Properties the user holds a role at, for the property switcher and the post-sign-in redirect. */
export async function propertiesForUser(db: Db, userId: string) {
  return db
    .select({ slug: properties.slug, name: properties.name, role: propertyRoles.role })
    .from(propertyRoles)
    .innerJoin(properties, eq(properties.id, propertyRoles.propertyId))
    .where(and(eq(propertyRoles.userId, userId), eq(properties.active, true)))
    .orderBy(asc(properties.name));
}

export async function hasAnyUser(db: Db): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return (r?.n ?? 0) > 0;
}

export const setupInput = z.object({
  organizationName: z.string().trim().min(2).max(120),
  propertyName: z.string().trim().min(2).max(120),
  propertySlug: z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes.").min(3).max(64),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."),
  ownerName: z.string().trim().min(2).max(120),
  ownerEmail: z.string().trim().toLowerCase().email().max(254),
  password: z.string().max(200),
});

/**
 * First-run setup on a new hub: creates the organization, the first property and the owner.
 * Only works while the database has no users, so it cannot be used to take over a hub.
 */
export async function firstRunSetup(db: Db, raw: unknown): Promise<{ ok: true; propertySlug: string } | { ok: false; error: string }> {
  const parsed = setupInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  const d = parsed.data;
  const problem = passwordProblem(d.password);
  if (problem) return { ok: false, error: problem };
  const passwordHash = await hashPassword(d.password);
  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE users IN EXCLUSIVE MODE`);
    const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(users);
    if (n > 0) return { ok: false as const, error: "This hub is already set up. Sign in instead." };
    const [org] = await tx.insert(organizations).values({ name: d.organizationName }).returning();
    const [prop] = await tx.insert(properties).values({ organizationId: org!.id, slug: d.propertySlug, name: d.propertyName, businessDate: d.businessDate }).returning();
    const [owner] = await tx.insert(users).values({ organizationId: org!.id, email: d.ownerEmail, name: d.ownerName, passwordHash }).returning();
    await tx.insert(propertyRoles).values({ organizationId: org!.id, propertyId: prop!.id, userId: owner!.id, role: "OWNER" });
    await tx.insert(auditLog).values({ organizationId: org!.id, propertyId: prop!.id, actorUserId: owner!.id, action: "hub.setup", entity: "property", entityId: prop!.id, before: null, after: { slug: prop!.slug } });
    return { ok: true as const, propertySlug: prop!.slug };
  });
}
