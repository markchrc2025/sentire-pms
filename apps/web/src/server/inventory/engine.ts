import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { addDays, newId, nightsBetween, type IsoDate } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { inventoryDays, properties, roomBlocks, rooms, roomTypes } from "@sentire-pms/db/schema";
import type { TenantContext } from "../iam/tenant";
import { authorize } from "../iam/tenant";
import { ConflictError, ValidationError } from "../iam/errors";
import type { Tx } from "../data/write";

/** How far ahead inventory rows are kept built, from the business date. */
export const INVENTORY_HORIZON_DAYS = 550;
/** Longest stay or range one request may touch. */
export const MAX_RANGE_NIGHTS = 400;

type Q = Db | Tx;
type Scope = Pick<TenantContext, "organizationId" | "propertyId">;

export class NoAvailabilityError extends ConflictError {
  constructor(readonly roomTypeId: string, readonly date: IsoDate) {
    super(`No rooms of this type left on ${date}.`);
    this.name = "NoAvailabilityError";
  }
}

function checkRange(from: IsoDate, to: IsoDate) {
  if (!(to > from)) throw new ValidationError("The end date must be after the start date.");
  if (nightsBetween(from, to).length > MAX_RANGE_NIGHTS) throw new ValidationError(`A range can cover at most ${MAX_RANGE_NIGHTS} nights.`);
}

/**
 * Units of a room type per night from rooms and blocks: active rooms of the type, and how many of
 * them are blocked each night. Sold units are not touched here.
 */
async function supplyFor(q: Q, scope: Scope, roomTypeId: string, from: IsoDate, to: IsoDate) {
  const [type] = await q.select({ active: roomTypes.active }).from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.propertyId, scope.propertyId))).limit(1);
  const active = await q.select({ id: rooms.id }).from(rooms).where(and(eq(rooms.roomTypeId, roomTypeId), eq(rooms.propertyId, scope.propertyId), eq(rooms.active, true)));
  const total = type?.active ? active.length : 0;
  const ids = active.map((r) => r.id);
  const blocks = ids.length && total
    ? await q
        .select({ roomId: roomBlocks.roomId, start: roomBlocks.startDate, end: roomBlocks.endDate })
        .from(roomBlocks)
        .where(and(inArray(roomBlocks.roomId, ids), isNull(roomBlocks.releasedAt), lt(roomBlocks.startDate, to), sql`${roomBlocks.endDate} > ${from}`))
    : [];
  const out = new Map<IsoDate, { total: number; blocked: number }>();
  for (const d of nightsBetween(from, to)) {
    const blockedRooms = new Set(blocks.filter((b) => b.start <= d && d < b.end).map((b) => b.roomId));
    out.set(d, { total, blocked: blockedRooms.size });
  }
  return out;
}

/**
 * Lock the inventory rows of a room type for [from, to) with SELECT ... FOR UPDATE, creating any
 * missing rows first. Always call inside the transaction that changes availability.
 */
export async function lockDays(tx: Tx, scope: Scope, roomTypeId: string, from: IsoDate, to: IsoDate) {
  checkRange(from, to);
  const existing = await tx
    .select({ stayDate: inventoryDays.stayDate })
    .from(inventoryDays)
    .where(and(eq(inventoryDays.roomTypeId, roomTypeId), gte(inventoryDays.stayDate, from), lt(inventoryDays.stayDate, to)));
  const have = new Set(existing.map((r) => r.stayDate));
  const missing = nightsBetween(from, to).filter((d) => !have.has(d));
  if (missing.length) {
    const supply = await supplyFor(tx, scope, roomTypeId, missing[0]!, addDays(missing[missing.length - 1]!, 1));
    await tx
      .insert(inventoryDays)
      .values(missing.map((d) => ({ id: newId(), organizationId: scope.organizationId, propertyId: scope.propertyId, roomTypeId, stayDate: d, totalUnits: supply.get(d)!.total, blockedUnits: supply.get(d)!.blocked })))
      .onConflictDoNothing();
  }
  return tx
    .select()
    .from(inventoryDays)
    .where(and(eq(inventoryDays.roomTypeId, roomTypeId), eq(inventoryDays.propertyId, scope.propertyId), gte(inventoryDays.stayDate, from), lt(inventoryDays.stayDate, to)))
    .orderBy(asc(inventoryDays.stayDate))
    .for("update");
}

/**
 * Rebuild total and blocked units for a room type after rooms or blocks change. Refuses (and
 * rolls back the caller) if any night would end up with more sold rooms than sellable rooms.
 */
export async function recomputeSupply(tx: Tx, scope: Scope, roomTypeId: string, from: IsoDate, to: IsoDate) {
  const locked = await lockDays(tx, scope, roomTypeId, from, to);
  const supply = await supplyFor(tx, scope, roomTypeId, from, to);
  for (const row of locked) {
    const s = supply.get(row.stayDate)!;
    if (s.total === row.totalUnits && s.blocked === row.blockedUnits) continue;
    if (row.soldUnits + s.blocked > s.total + row.overbookedUnits) {
      throw new ConflictError(`Not enough free rooms on ${row.stayDate}: ${row.soldUnits} already sold. Move or cancel those stays first.`);
    }
    await tx.update(inventoryDays).set({ totalUnits: s.total, blockedUnits: s.blocked, updatedAt: new Date() }).where(eq(inventoryDays.id, row.id));
  }
}

/** Horizon for rebuilds: business date to business date + INVENTORY_HORIZON_DAYS. */
export async function horizon(q: Q, scope: Scope): Promise<{ from: IsoDate; to: IsoDate }> {
  const [p] = await q.select({ businessDate: properties.businessDate }).from(properties).where(eq(properties.id, scope.propertyId)).limit(1);
  const from = p!.businessDate;
  return { from, to: addDays(from, INVENTORY_HORIZON_DAYS) };
}

/** Rebuild supply over the whole horizon, in chunks no larger than MAX_RANGE_NIGHTS. */
export async function recomputeSupplyHorizon(tx: Tx, scope: Scope, roomTypeId: string) {
  const h = await horizon(tx, scope);
  for (let start = h.from; start < h.to; start = addDays(start, MAX_RANGE_NIGHTS)) {
    const end = addDays(start, MAX_RANGE_NIGHTS) < h.to ? addDays(start, MAX_RANGE_NIGHTS) : h.to;
    await recomputeSupply(tx, scope, roomTypeId, start, end);
  }
}

/**
 * Take units of a room type for every night of [from, to). Locks the rows, checks availability
 * and increments sold units. allowOverbook lets an Admin sell past zero (FR-10); the excess is
 * recorded in overbooked_units.
 */
export async function takeUnits(tx: Tx, scope: Scope, roomTypeId: string, from: IsoDate, to: IsoDate, opts: { units?: number; allowOverbook?: boolean } = {}) {
  const units = opts.units ?? 1;
  const rows = await lockDays(tx, scope, roomTypeId, from, to);
  for (const r of rows) {
    const free = r.totalUnits + r.overbookedUnits - r.blockedUnits - r.soldUnits;
    if (free < units && !opts.allowOverbook) throw new NoAvailabilityError(roomTypeId, r.stayDate);
  }
  for (const r of rows) {
    const sold = r.soldUnits + units;
    const over = Math.max(r.overbookedUnits, sold + r.blockedUnits - r.totalUnits, 0);
    await tx.update(inventoryDays).set({ soldUnits: sold, overbookedUnits: over, updatedAt: new Date() }).where(eq(inventoryDays.id, r.id));
  }
}

/** Give units back (cancellation, shorter stay, room type change). */
export async function releaseUnits(tx: Tx, scope: Scope, roomTypeId: string, from: IsoDate, to: IsoDate, units = 1) {
  const rows = await lockDays(tx, scope, roomTypeId, from, to);
  for (const r of rows) {
    const sold = Math.max(0, r.soldUnits - units);
    const over = Math.max(0, sold + r.blockedUnits - r.totalUnits);
    await tx.update(inventoryDays).set({ soldUnits: sold, overbookedUnits: over, updatedAt: new Date() }).where(eq(inventoryDays.id, r.id));
  }
}

export interface AvailabilityRow {
  roomTypeId: string;
  code: string;
  name: string;
  days: { date: IsoDate; total: number; blocked: number; sold: number; available: number }[];
}

/** Availability per active room type and night (read only, no locks). Missing rows are computed. */
export async function availability(db: Db, ctx: TenantContext, from: IsoDate, to: IsoDate): Promise<AvailabilityRow[]> {
  authorize(ctx, "reservations.view");
  checkRange(from, to);
  const types = await db.select().from(roomTypes).where(and(eq(roomTypes.propertyId, ctx.propertyId), eq(roomTypes.organizationId, ctx.organizationId), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));
  const out: AvailabilityRow[] = [];
  for (const t of types) {
    const rows = await db.select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, t.id), gte(inventoryDays.stayDate, from), lt(inventoryDays.stayDate, to)));
    const byDate = new Map(rows.map((r) => [r.stayDate, r]));
    const supply = rows.length === nightsBetween(from, to).length ? null : await supplyFor(db, ctx, t.id, from, to);
    out.push({
      roomTypeId: t.id,
      code: t.code,
      name: t.name,
      days: nightsBetween(from, to).map((d) => {
        const r = byDate.get(d);
        const total = r?.totalUnits ?? supply!.get(d)!.total;
        const blocked = r?.blockedUnits ?? supply!.get(d)!.blocked;
        const sold = r?.soldUnits ?? 0;
        return { date: d, total, blocked, sold, available: total - blocked - sold };
      }),
    });
  }
  return out;
}
