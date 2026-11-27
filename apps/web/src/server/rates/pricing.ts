import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { z } from "zod";
import { addDays, dayOfWeek, divRoundHalfUp, guaranteeAmount, isIsoDate, nightsBetween, parsePeso, vatFromInclusive, type IsoDate } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { auditLog, dailyRates, policies, ratePlans, roomTypes, taxFees } from "@sentire-pms/db/schema";
import { percentToBp } from "../inventory/taxes";
import { authorize, type TenantContext } from "../iam/tenant";
import { NotFoundError, ValidationError } from "../iam/errors";
import { recordChange, type Tx } from "../data/write";
import { MAX_RANGE_NIGHTS } from "../inventory/engine";
import { termsOf } from "./policies";

type Q = Db | Tx;
type Scope = Pick<TenantContext, "organizationId" | "propertyId">;

export interface NightRate {
  date: IsoDate;
  rateCentavos: bigint;
  minStay: number;
  maxStay: number | null;
  closed: boolean;
  closedToArrival: boolean;
  closedToDeparture: boolean;
}

type Plan = typeof ratePlans.$inferSelect;

async function planById(q: Q, scope: Scope, ratePlanId: string): Promise<Plan> {
  const [p] = await q.select().from(ratePlans).where(and(eq(ratePlans.id, ratePlanId), eq(ratePlans.propertyId, scope.propertyId), eq(ratePlans.organizationId, scope.organizationId))).limit(1);
  if (!p) throw new NotFoundError("Rate plan not found.");
  return p;
}

/** Apply a derived or package plan's rule to a parent nightly rate. Never below zero. */
export function deriveRate(plan: Pick<Plan, "type" | "adjustKind" | "adjustValue" | "packageAddCentavos">, parentRate: bigint): bigint {
  if (plan.type === "STANDARD") return parentRate;
  if (plan.type === "PACKAGE") return parentRate + plan.packageAddCentavos;
  const v = plan.adjustKind === "PERCENT" ? parentRate + divRoundHalfUp(parentRate * plan.adjustValue, 10_000n) : parentRate + plan.adjustValue;
  return v < 0n ? 0n : v;
}

/**
 * Nightly rates and restrictions for a plan and room type over [from, to). Standard plans read
 * daily_rates (the room type's base rate where a night has no row); derived and package plans
 * follow their parent's rates and restrictions.
 */
export async function nightlyRates(q: Q, scope: Scope, ratePlanId: string, roomTypeId: string, from: IsoDate, to: IsoDate): Promise<NightRate[]> {
  const plan = await planById(q, scope, ratePlanId);
  const standard = plan.type === "STANDARD" ? plan : await planById(q, scope, plan.parentId!);
  const [type] = await q.select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.propertyId, scope.propertyId))).limit(1);
  if (!type) throw new NotFoundError("Room type not found.");
  const rows = await q.select().from(dailyRates).where(and(eq(dailyRates.ratePlanId, standard.id), eq(dailyRates.roomTypeId, roomTypeId), gte(dailyRates.stayDate, from), lt(dailyRates.stayDate, to)));
  const byDate = new Map(rows.map((r) => [r.stayDate, r]));
  return nightsBetween(from, to).map((date) => {
    const r = byDate.get(date);
    const base = r?.rateCentavos ?? type.baseRateCentavos;
    return {
      date,
      rateCentavos: deriveRate(plan, base),
      minStay: r?.minStay ?? 1,
      maxStay: r?.maxStay ?? null,
      closed: r?.closed ?? false,
      closedToArrival: r?.closedToArrival ?? false,
      closedToDeparture: r?.closedToDeparture ?? false,
    };
  });
}

export interface Violation {
  code: "CLOSED" | "CTA" | "CTD" | "MIN_STAY" | "MAX_STAY" | "MAX_GUESTS";
  message: string;
}

/** Restrictions broken by a stay (FR-07). Min and max stay are those of the arrival night. */
export function checkRestrictions(nights: NightRate[], departureNight: NightRate | undefined): Violation[] {
  const out: Violation[] = [];
  const first = nights[0];
  if (!first) return out;
  for (const n of nights) if (n.closed) out.push({ code: "CLOSED", message: `Closed on ${n.date}.` });
  if (first.closedToArrival) out.push({ code: "CTA", message: `No arrivals on ${first.date}.` });
  if (departureNight?.closedToDeparture) out.push({ code: "CTD", message: `No departures on ${departureNight.date}.` });
  if (nights.length < first.minStay) out.push({ code: "MIN_STAY", message: `Minimum stay from ${first.date} is ${first.minStay} nights.` });
  if (first.maxStay !== null && nights.length > first.maxStay) out.push({ code: "MAX_STAY", message: `Maximum stay from ${first.date} is ${first.maxStay} nights.` });
  return out;
}

export interface FeeLine {
  code: string;
  name: string;
  kind: "TAX" | "FEE";
  amountCentavos: bigint;
  glCode: string;
}

export interface StayQuote {
  ratePlanId: string;
  roomTypeId: string;
  checkIn: IsoDate;
  checkOut: IsoDate;
  nights: NightRate[];
  roomTotalCentavos: bigint;
  /** VAT contained in the room charges (rates are VAT-inclusive). */
  vatIncludedCentavos: bigint;
  addedFees: FeeLine[];
  totalCentavos: bigint;
  guaranteeCentavos: bigint;
  policyId: string;
  policyName: string;
  violations: Violation[];
}

export const quoteInput = z
  .object({
    ratePlanId: z.string().length(26),
    roomTypeId: z.string().length(26),
    checkIn: z.string().refine(isIsoDate, "Enter a valid arrival date."),
    checkOut: z.string().refine(isIsoDate, "Enter a valid departure date."),
    adults: z.coerce.number().int().min(1).max(50).default(2),
    children: z.coerce.number().int().min(0).max(50).default(0),
  })
  .refine((v) => v.checkOut > v.checkIn, { message: "Departure must be after arrival.", path: ["checkOut"] })
  .refine((v) => nightsBetween(v.checkIn, v.checkOut).length <= MAX_RANGE_NIGHTS, { message: `A stay can be at most ${MAX_RANGE_NIGHTS} nights.`, path: ["checkOut"] });

/** Price a stay (P3.2): nightly rates, VAT inside, added fees, guarantee and restriction checks. */
export async function quoteStay(q: Q, scope: Scope, raw: z.input<typeof quoteInput>): Promise<StayQuote> {
  const d = quoteInput.parse(raw);
  const plan = await planById(q, scope, d.ratePlanId);
  const nights = await nightlyRates(q, scope, d.ratePlanId, d.roomTypeId, d.checkIn, d.checkOut);
  const [dep] = await nightlyRates(q, scope, d.ratePlanId, d.roomTypeId, d.checkOut, addDays(d.checkOut, 1));
  const [type] = await q.select().from(roomTypes).where(eq(roomTypes.id, d.roomTypeId)).limit(1);
  const violations = checkRestrictions(nights, dep);
  const guests = d.adults + d.children;
  if (type && guests > type.maxGuests) violations.push({ code: "MAX_GUESTS", message: `${type.name} takes at most ${type.maxGuests} guests.` });
  const roomTotal = nights.reduce((a, n) => a + n.rateCentavos, 0n);
  const vat = nights.reduce((a, n) => a + vatFromInclusive(n.rateCentavos), 0n);
  const fees = await q.select().from(taxFees).where(and(eq(taxFees.propertyId, scope.propertyId), eq(taxFees.active, true), eq(taxFees.inclusive, false), inArray(taxFees.kind, ["TAX", "FEE"])));
  const addedFees: FeeLine[] = fees.map((f) => {
    let amount: bigint;
    if (f.calc === "PERCENT") amount = divRoundHalfUp(roomTotal * f.value, 10_000n);
    else {
      const n = BigInt(nights.length);
      amount = f.basis === "PER_NIGHT" ? f.value * n : f.basis === "PER_GUEST_PER_NIGHT" ? f.value * n * BigInt(guests) : f.value;
    }
    return { code: f.code, name: f.name, kind: f.kind as "TAX" | "FEE", amountCentavos: amount, glCode: f.glCode };
  });
  const [pol] = await q.select().from(policies).where(eq(policies.id, plan.policyId)).limit(1);
  return {
    ratePlanId: d.ratePlanId,
    roomTypeId: d.roomTypeId,
    checkIn: d.checkIn,
    checkOut: d.checkOut,
    nights,
    roomTotalCentavos: roomTotal,
    vatIncludedCentavos: vat,
    addedFees,
    totalCentavos: roomTotal + addedFees.reduce((a, f) => a + f.amountCentavos, 0n),
    guaranteeCentavos: pol ? guaranteeAmount(termsOf(pol), nights.map((n) => n.rateCentavos)) : 0n,
    policyId: plan.policyId,
    policyName: pol?.name ?? "",
    violations,
  };
}

/** Quote as the signed-in user (needs reservations.view). */
export async function quote(db: Db, ctx: TenantContext, raw: z.input<typeof quoteInput>) {
  authorize(ctx, "reservations.view");
  return quoteStay(db, ctx, raw);
}

// ---------- Matrix ----------

export interface MatrixRow {
  roomTypeId: string;
  code: string;
  name: string;
  nights: NightRate[];
}

/** Rates and restrictions of one plan for every active room type over [from, to) (P3.3). */
export async function rateMatrix(db: Db, ctx: TenantContext, ratePlanId: string, from: IsoDate, to: IsoDate): Promise<MatrixRow[]> {
  authorize(ctx, "reservations.view");
  const types = await db.select().from(roomTypes).where(and(eq(roomTypes.propertyId, ctx.propertyId), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));
  const out: MatrixRow[] = [];
  for (const t of types) out.push({ roomTypeId: t.id, code: t.code, name: t.name, nights: await nightlyRates(db, ctx, ratePlanId, t.id, from, to) });
  return out;
}

// ---------- Editing (standard plans only) ----------

const restrictionPatch = z.object({
  rateCentavos: z.bigint().nonnegative().nullable().optional(),
  minStay: z.number().int().min(1).max(365).optional(),
  maxStay: z.number().int().min(1).max(365).nullable().optional(),
  closed: z.boolean().optional(),
  closedToArrival: z.boolean().optional(),
  closedToDeparture: z.boolean().optional(),
});
export type DayPatch = z.infer<typeof restrictionPatch>;

async function standardPlan(q: Q, scope: Scope, ratePlanId: string) {
  const plan = await planById(q, scope, ratePlanId);
  if (plan.type !== "STANDARD") throw new ValidationError(`${plan.name} follows another plan. Change the plan it follows instead.`);
  return plan;
}

/** Write one night's rate and restrictions, merging with what is there. */
async function writeDay(tx: Tx, ctx: TenantContext, planId: string, roomTypeId: string, date: IsoDate, patch: DayPatch, existing?: typeof dailyRates.$inferSelect) {
  const next = {
    rateCentavos: patch.rateCentavos !== undefined ? patch.rateCentavos : (existing?.rateCentavos ?? null),
    minStay: patch.minStay ?? existing?.minStay ?? 1,
    maxStay: patch.maxStay !== undefined ? patch.maxStay : (existing?.maxStay ?? null),
    closed: patch.closed ?? existing?.closed ?? false,
    closedToArrival: patch.closedToArrival ?? existing?.closedToArrival ?? false,
    closedToDeparture: patch.closedToDeparture ?? existing?.closedToDeparture ?? false,
  };
  if (next.maxStay !== null && next.maxStay < next.minStay) throw new ValidationError(`On ${date} the maximum stay would be below the minimum stay.`);
  if (existing) {
    const [after] = await tx.update(dailyRates).set(next).where(eq(dailyRates.id, existing.id)).returning();
    await recordChange(tx, ctx, { entity: "daily_rate", entityId: existing.id, op: "update", action: "daily_rate.update", before: existing, after });
  } else {
    const [after] = await tx.insert(dailyRates).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, ratePlanId: planId, roomTypeId, stayDate: date, ...next }).returning();
    await recordChange(tx, ctx, { entity: "daily_rate", entityId: after!.id, op: "insert", action: "daily_rate.create", after });
  }
}

export async function setDay(db: Db, ctx: TenantContext, input: { ratePlanId: string; roomTypeId: string; date: IsoDate; patch: DayPatch }) {
  authorize(ctx, "rates.manage");
  const patch = restrictionPatch.parse(input.patch);
  if (!isIsoDate(input.date)) throw new ValidationError("Enter a valid date.");
  return db.transaction(async (tx) => {
    await standardPlan(tx, ctx, input.ratePlanId);
    const [t] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, input.roomTypeId), eq(roomTypes.propertyId, ctx.propertyId))).limit(1);
    if (!t) throw new NotFoundError("Room type not found.");
    const [existing] = await tx.select().from(dailyRates).where(and(eq(dailyRates.ratePlanId, input.ratePlanId), eq(dailyRates.roomTypeId, input.roomTypeId), eq(dailyRates.stayDate, input.date))).for("update");
    await writeDay(tx, ctx, input.ratePlanId, input.roomTypeId, input.date, patch, existing);
  });
}

// ---------- Bulk update (P3.4, FR-08) ----------

const tri = z.enum(["", "on", "off"]).default("");
export const bulkInput = z
  .object({
    ratePlanId: z.string().length(26, "Choose a standard rate plan."),
    from: z.string().refine(isIsoDate, "Enter a valid start date."),
    to: z.string().refine(isIsoDate, "Enter a valid end date."),
    days: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Choose at least one day of the week."),
    roomTypeIds: z.array(z.string().length(26)).min(1, "Choose at least one room type."),
    rateAction: z.enum(["", "SET", "INCREASE", "DECREASE"]).default(""),
    rateMode: z.enum(["AMOUNT", "PERCENT"]).default("AMOUNT"),
    rateValue: z.string().trim().optional().default(""),
    minStay: z.string().trim().optional().default(""),
    maxStay: z.string().trim().optional().default(""),
    closed: tri,
    closedToArrival: tri,
    closedToDeparture: tri,
  })
  .refine((v) => v.to >= v.from, { message: "The end date must not be before the start date.", path: ["to"] })
  .refine((v) => nightsBetween(v.from, addDays(v.to, 1)).length <= 400, { message: "Update at most 400 days at once.", path: ["to"] });

export interface BulkChange {
  roomTypeId: string;
  roomTypeCode: string;
  date: IsoDate;
  before: NightRate;
  after: NightRate;
}

/** Work out every change a bulk update would make, without writing anything. */
async function planBulk(q: Q, ctx: TenantContext, raw: unknown) {
  const d = bulkInput.parse(raw);
  const plan = await standardPlan(q, ctx, d.ratePlanId);
  const types = await q.select().from(roomTypes).where(and(eq(roomTypes.propertyId, ctx.propertyId), inArray(roomTypes.id, d.roomTypeIds)));
  if (types.length !== new Set(d.roomTypeIds).size) throw new ValidationError("Choose room types of this property.");
  let amount = 0n;
  if (d.rateAction) {
    if (!d.rateValue) throw new ValidationError("Enter the rate amount or percentage.", "rateValue");
    try {
      amount = d.rateMode === "PERCENT" && d.rateAction !== "SET" ? percentToBp(d.rateValue) : parsePeso(d.rateValue);
    } catch (e) {
      throw new ValidationError(e instanceof ValidationError ? e.message : "Enter an amount like 3500 or 3,500.00.", "rateValue");
    }
    if (amount < 0n) throw new ValidationError("Use Decrease instead of a negative amount.", "rateValue");
  }
  const int = (s: string, label: string) => {
    if (!s) return undefined;
    const n = Number(s);
    if (!Number.isInteger(n) || n < 1 || n > 365) throw new ValidationError(`${label} must be 1 to 365 nights.`);
    return n;
  };
  const minStay = int(d.minStay, "Minimum stay");
  const maxStay = d.maxStay === "none" ? null : int(d.maxStay, "Maximum stay");
  const flag = (v: string) => (v === "on" ? true : v === "off" ? false : undefined);
  const days = new Set(d.days);
  const dates = nightsBetween(d.from, addDays(d.to, 1)).filter((x) => days.has(dayOfWeek(x)));
  const changes: (BulkChange & { patch: DayPatch })[] = [];
  for (const t of types) {
    const nights = await nightlyRates(q, ctx, plan.id, t.id, d.from, addDays(d.to, 1));
    const byDate = new Map(nights.map((n) => [n.date, n]));
    for (const date of dates) {
      const before = byDate.get(date)!;
      const patch: DayPatch = {};
      if (d.rateAction) {
        const cur = before.rateCentavos;
        let next = d.rateAction === "SET" ? amount : d.rateMode === "PERCENT" ? cur + (d.rateAction === "INCREASE" ? 1n : -1n) * divRoundHalfUp(cur * amount, 10_000n) : cur + (d.rateAction === "INCREASE" ? amount : -amount);
        if (next < 0n) next = 0n;
        patch.rateCentavos = next;
      }
      if (minStay !== undefined) patch.minStay = minStay;
      if (maxStay !== undefined) patch.maxStay = maxStay;
      if (flag(d.closed) !== undefined) patch.closed = flag(d.closed);
      if (flag(d.closedToArrival) !== undefined) patch.closedToArrival = flag(d.closedToArrival);
      if (flag(d.closedToDeparture) !== undefined) patch.closedToDeparture = flag(d.closedToDeparture);
      const after: NightRate = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as NightRate;
      if (patch.rateCentavos !== undefined) after.rateCentavos = patch.rateCentavos!;
      const same = (Object.keys(patch) as (keyof DayPatch)[]).every((k) => (k === "rateCentavos" ? before.rateCentavos === after.rateCentavos : before[k as keyof NightRate] === after[k as keyof NightRate]));
      if (!same) changes.push({ roomTypeId: t.id, roomTypeCode: t.code, date, before, after, patch });
    }
  }
  if (!d.rateAction && minStay === undefined && maxStay === undefined && [d.closed, d.closedToArrival, d.closedToDeparture].every((x) => x === "")) {
    throw new ValidationError("Choose a rate change or a restriction to set.");
  }
  return { plan, changes };
}

export async function previewBulk(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "rates.manage");
  const { changes } = await planBulk(db, ctx, raw);
  return changes.map(({ patch: _p, ...c }) => c);
}

/** Apply a bulk update in one transaction: every night changes, or none does. */
export async function applyBulk(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "rates.manage");
  return db.transaction(async (tx) => {
    const { plan, changes } = await planBulk(tx, ctx, raw);
    for (const c of changes) {
      const [existing] = await tx.select().from(dailyRates).where(and(eq(dailyRates.ratePlanId, plan.id), eq(dailyRates.roomTypeId, c.roomTypeId), eq(dailyRates.stayDate, c.date))).for("update");
      // Keep "no row" meaning base rate: write the rate only when it changes.
      const patch = { ...c.patch };
      if (patch.rateCentavos === undefined && !existing) patch.rateCentavos = null;
      await writeDay(tx, ctx, plan.id, c.roomTypeId, c.date, patch, existing);
    }
    await tx.insert(auditLog).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, actorUserId: ctx.userId, action: "rates.bulk_update", entity: "rate_plan", entityId: plan.id, after: { nights: changes.length } });
    return changes.length;
  });
}
