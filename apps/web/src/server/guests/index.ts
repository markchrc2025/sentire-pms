import { and, asc, desc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@sentire-pms/db";
import { guests, reservations } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "../iam/tenant";
import { NotFoundError } from "../iam/errors";
import { recordChange, type Tx } from "../data/write";

const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

/** Philippine mobiles become +639XXXXXXXXX; other numbers keep their digits and a leading +. */
export function normalizeMobile(v: string | null): string | null {
  if (!v) return null;
  const digits = v.replace(/[^\d+]/g, "");
  if (/^09\d{9}$/.test(digits)) return `+63${digits.slice(1)}`;
  if (/^639\d{9}$/.test(digits)) return `+${digits}`;
  return digits.startsWith("+") ? digits : digits || null;
}

export const guestInput = z.object({
  firstName: z.string().trim().min(1, "Enter the first name.").max(80),
  lastName: z.string().trim().min(1, "Enter the last name.").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email.").max(254).optional().or(z.literal("")).transform((v) => v || null),
  mobile: opt(32).transform(normalizeMobile).refine((v) => v === null || /^\+?\d{7,15}$/.test(v), "Enter a valid mobile number."),
  nationality: z.string().trim().toUpperCase().optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || /^[A-Z]{2}$/.test(v), "Use a 2-letter country code like PH."),
  address: opt(500),
  birthDate: z.string().optional().nullable().transform((v) => (v ? v : null)).refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), "Use a valid date."),
  company: opt(120),
  notes: opt(2000),
  marketingConsent: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((v) => v === true || v === "on"),
});
export type GuestInput = z.input<typeof guestInput>;

export async function createGuestTx(tx: Tx, ctx: TenantContext, raw: unknown) {
  const d = guestInput.parse(raw);
  const [g] = await tx.insert(guests).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, ...d }).returning();
  await recordChange(tx, ctx, { entity: "guest", entityId: g!.id, op: "insert", action: "guest.create", after: g });
  return g!;
}

export async function createGuest(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "guests.manage");
  return db.transaction((tx) => createGuestTx(tx, ctx, raw));
}

export async function updateGuest(db: Db, ctx: TenantContext, id: string, raw: unknown) {
  authorize(ctx, "guests.manage");
  const d = guestInput.parse(raw);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(guests).where(and(eq(guests.id, id), eq(guests.propertyId, ctx.propertyId))).for("update");
    if (!before || before.anonymizedAt) throw new NotFoundError("Guest not found.");
    const [after] = await tx.update(guests).set(d).where(eq(guests.id, id)).returning();
    await recordChange(tx, ctx, { entity: "guest", entityId: id, op: "update", action: "guest.update", before, after });
    return after!;
  });
}

export async function getGuest(db: Db, ctx: TenantContext, id: string) {
  authorize(ctx, "guests.view");
  const [g] = await db.select().from(guests).where(and(eq(guests.id, id), eq(guests.propertyId, ctx.propertyId), eq(guests.organizationId, ctx.organizationId))).limit(1);
  if (!g) throw new NotFoundError("Guest not found.");
  const stays = await db.select().from(reservations).where(and(eq(reservations.mainGuestId, id), eq(reservations.propertyId, ctx.propertyId))).orderBy(desc(reservations.checkIn)).limit(50);
  return { guest: g, stays };
}

const like = (q: string) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Search guests by name, email or mobile. */
export async function searchGuests(db: Db, ctx: TenantContext, q: string, limit = 30) {
  authorize(ctx, "guests.view");
  const t = q.trim();
  const mobile = normalizeMobile(t);
  const where = t
    ? or(
        ilike(sql`${guests.firstName} || ' ' || ${guests.lastName}`, like(t)),
        ilike(sql`${guests.lastName} || ' ' || ${guests.firstName}`, like(t)),
        ilike(guests.email, like(t)),
        mobile && mobile.length >= 4 ? ilike(guests.mobile, like(mobile.replace(/^\+63/, ""))) : undefined,
      )
    : undefined;
  return db
    .select()
    .from(guests)
    .where(and(eq(guests.propertyId, ctx.propertyId), eq(guests.organizationId, ctx.organizationId), isNull(guests.anonymizedAt), where))
    .orderBy(asc(guests.lastName), asc(guests.firstName))
    .limit(limit);
}

/** Guests that may be the same person (same email, same mobile, or same full name). */
export async function duplicateSuggestions(db: Db, ctx: TenantContext, raw: { firstName?: string; lastName?: string; email?: string; mobile?: string }) {
  authorize(ctx, "guests.view");
  const email = raw.email?.trim().toLowerCase() || null;
  const mobile = normalizeMobile(raw.mobile?.trim() || null);
  const fn = raw.firstName?.trim().toLowerCase();
  const ln = raw.lastName?.trim().toLowerCase();
  const conds = [
    email ? eq(sql`lower(${guests.email})`, email) : undefined,
    mobile ? eq(guests.mobile, mobile) : undefined,
    fn && ln ? and(eq(sql`lower(${guests.firstName})`, fn), eq(sql`lower(${guests.lastName})`, ln)) : undefined,
  ].filter(Boolean);
  if (!conds.length) return [];
  return db.select().from(guests).where(and(eq(guests.propertyId, ctx.propertyId), isNull(guests.anonymizedAt), or(...conds))).limit(10);
}
