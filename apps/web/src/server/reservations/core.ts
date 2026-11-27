import { randomInt } from "node:crypto";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { addDays, nightsBetween, type IsoDate } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { properties, reservationRooms, reservations, roomBlocks, roomNights, rooms } from "@sentire-pms/db/schema";
import type { TenantContext } from "../iam/tenant";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "../iam/errors";
import { recordChange, type Tx } from "../data/write";
import { INVENTORY_HORIZON_DAYS, releaseUnits, takeUnits } from "../inventory/engine";
import type { NightRate } from "../rates/pricing";
import { sql } from "drizzle-orm";

export type Res = typeof reservations.$inferSelect;
export type ResRoom = typeof reservationRooms.$inferSelect;
type Q = Db | Tx;

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A short code such as R7K2M9P, unique per property. */
export async function newReservationCode(q: Q, propertyId: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    let c = "R";
    for (let j = 0; j < 6; j++) c += ALPHABET[randomInt(ALPHABET.length)];
    const hit = await q.select({ id: reservations.id }).from(reservations).where(and(eq(reservations.propertyId, propertyId), eq(reservations.code, c))).limit(1);
    if (!hit.length) return c;
  }
  throw new Error("Could not make a reservation code");
}

export async function businessDateOf(q: Q, ctx: Pick<TenantContext, "propertyId">) {
  const [p] = await q.select().from(properties).where(eq(properties.id, ctx.propertyId)).limit(1);
  if (!p) throw new NotFoundError("Property not found.");
  return p;
}

export function checkStayWindow(bd: IsoDate, checkIn: IsoDate, checkOut: IsoDate, opts: { allowPastArrival?: boolean } = {}) {
  if (!(checkOut > checkIn)) throw new ValidationError("Departure must be after arrival.");
  if (!opts.allowPastArrival && checkIn < bd) throw new ValidationError(`Arrival cannot be before the business date (${bd}).`);
  if (checkOut > addDays(bd, INVENTORY_HORIZON_DAYS)) throw new ValidationError(`Stays can be booked up to ${INVENTORY_HORIZON_DAYS} days ahead.`);
}

/** Lock a reservation row for this tenant, or NotFoundError. */
export async function lockReservation(tx: Tx, ctx: TenantContext, id: string): Promise<Res> {
  const [r] = await tx.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.propertyId, ctx.propertyId), eq(reservations.organizationId, ctx.organizationId))).for("update");
  if (!r) throw new NotFoundError("Reservation not found.");
  return r;
}

/** Booked rooms of a reservation: those holding inventory, or (activeOnly false) all not removed. */
export async function roomsOf(q: Q, reservationId: string, opts: { activeOnly?: boolean } = { activeOnly: true }) {
  return q
    .select()
    .from(reservationRooms)
    .where(and(eq(reservationRooms.reservationId, reservationId), opts.activeOnly ? eq(reservationRooms.active, true) : sql`${reservationRooms.removedAt} is null`))
    .orderBy(asc(reservationRooms.createdAt), asc(reservationRooms.id));
}

/** Write the nights of a booked room from quoted rates; assign roomId when given. */
export async function writeNights(tx: Tx, ctx: TenantContext, rr: ResRoom, nights: NightRate[], roomId: string | null) {
  if (!nights.length) return;
  try {
    const rows = await tx
      .insert(roomNights)
      .values(nights.map((n) => ({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, reservationId: rr.reservationId, reservationRoomId: rr.id, roomTypeId: rr.roomTypeId, roomId, stayDate: n.date, rateCentavos: n.rateCentavos })))
      .returning();
    for (const r of rows) await recordChange(tx, ctx, { entity: "room_night", entityId: r.id, op: "insert", action: "room_night.create", after: r });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("That room is already taken on some of these nights.");
    throw e;
  }
}

/** Mark nights from a date on as no longer active (they stay in history). */
export async function endNights(tx: Tx, ctx: TenantContext, reservationRoomId: string, from?: IsoDate) {
  const ended = await tx
    .update(roomNights)
    .set({ active: false })
    .where(and(eq(roomNights.reservationRoomId, reservationRoomId), eq(roomNights.active, true), from ? gte(roomNights.stayDate, from) : undefined))
    .returning();
  for (const r of ended) await recordChange(tx, ctx, { entity: "room_night", entityId: r.id, op: "update", action: "room_night.end", after: { id: r.id, active: false } });
  return ended;
}

export async function activeNights(q: Q, reservationRoomId: string) {
  return q.select().from(roomNights).where(and(eq(roomNights.reservationRoomId, reservationRoomId), eq(roomNights.active, true))).orderBy(asc(roomNights.stayDate));
}

/** Check a room can take [from, to): same property, right type, on, and not blocked. */
export async function checkRoomUsable(tx: Tx, ctx: TenantContext, roomId: string, roomTypeId: string, from: IsoDate, to: IsoDate) {
  const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.propertyId, ctx.propertyId))).limit(1);
  if (!room) throw new ValidationError("Choose a room of this property.");
  if (!room.active) throw new ValidationError(`Room ${room.number} is turned off.`);
  if (room.roomTypeId !== roomTypeId) throw new ValidationError(`Room ${room.number} is another room type. Change the booked room type first.`);
  const [block] = await tx
    .select({ id: roomBlocks.id, start: roomBlocks.startDate })
    .from(roomBlocks)
    .where(and(eq(roomBlocks.roomId, roomId), sql`${roomBlocks.releasedAt} is null`, lt(roomBlocks.startDate, to), sql`${roomBlocks.endDate} > ${from}`))
    .limit(1);
  if (block) throw new ConflictError(`Room ${room.number} is blocked from ${block.start}.`);
  return room;
}

/** Point a booked room's nights (from a date on) at a room, or unassign with null. */
export async function setRoomOnNights(tx: Tx, ctx: TenantContext, rr: ResRoom, roomId: string | null, from: IsoDate) {
  const nights = await tx.select().from(roomNights).where(and(eq(roomNights.reservationRoomId, rr.id), eq(roomNights.active, true), gte(roomNights.stayDate, from)));
  if (!nights.length) return;
  try {
    // Clear first so swapping nights between two rooms of the same booking cannot collide with itself.
    await tx.update(roomNights).set({ roomId: null }).where(inArray(roomNights.id, nights.map((n) => n.id)));
    if (roomId) {
      for (const n of nights) {
        const [conflict] = await tx
          .select({ code: reservations.code })
          .from(roomNights)
          .innerJoin(reservations, eq(reservations.id, roomNights.reservationId))
          .where(and(eq(roomNights.roomId, roomId), eq(roomNights.stayDate, n.stayDate), eq(roomNights.active, true)))
          .limit(1);
        if (conflict) throw new ConflictError(`That room is taken on ${n.stayDate} by reservation ${conflict.code}.`);
      }
      await tx.update(roomNights).set({ roomId }).where(inArray(roomNights.id, nights.map((n) => n.id)));
    }
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("That room was just taken for one of these nights.");
    throw e;
  }
  const [after] = await tx.update(reservationRooms).set({ roomId }).where(eq(reservationRooms.id, rr.id)).returning();
  await recordChange(tx, ctx, { entity: "reservation_room", entityId: rr.id, op: "update", action: roomId ? "reservation_room.assign" : "reservation_room.unassign", before: rr, after });
  return after!;
}

export async function hold(tx: Tx, ctx: TenantContext, roomTypeId: string, from: IsoDate, to: IsoDate, allowOverbook = false) {
  if (to > from) await takeUnits(tx, ctx, roomTypeId, from, to, { allowOverbook });
}

export async function release(tx: Tx, ctx: TenantContext, roomTypeId: string, from: IsoDate, to: IsoDate) {
  if (to > from) await releaseUnits(tx, ctx, roomTypeId, from, to);
}

export { nightsBetween };
