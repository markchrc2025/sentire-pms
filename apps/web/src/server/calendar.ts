import { and, asc, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { addDays, nightsBetween, type IsoDate, type ResStatus } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { guests, ratePlans, reservations, roomBlocks, roomNights, rooms, roomTypes } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "./iam/tenant";
import { availability } from "./inventory/engine";
import { nightlyRates } from "./rates/pricing";

export interface CalBar {
  reservationId: string;
  reservationRoomId: string;
  code: string;
  guest: string;
  status: ResStatus;
  roomId: string | null;
  roomTypeId: string;
  /** Index of the first visible night and the number of visible nights. */
  start: number;
  span: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
  checkIn: IsoDate;
  checkOut: IsoDate;
}

export interface CalendarData {
  dates: IsoDate[];
  types: {
    id: string;
    code: string;
    name: string;
    rooms: { id: string; number: string; condition: string }[];
    available: number[];
    rates: (string | null)[];
    unassigned: CalBar[];
  }[];
  bars: CalBar[];
  blocks: { roomId: string; start: number; span: number; type: string; reason: string }[];
}

/** Rooms against dates with stays as bars, blocks, availability and the first standard plan's rate (FR-19). */
export async function calendarData(db: Db, ctx: TenantContext, from: IsoDate, days: number): Promise<CalendarData> {
  authorize(ctx, "reservations.view");
  const to = addDays(from, days);
  const dates = nightsBetween(from, to);
  const idx = new Map(dates.map((d, i) => [d, i]));
  const types = await db.select().from(roomTypes).where(and(eq(roomTypes.propertyId, ctx.propertyId), eq(roomTypes.active, true))).orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));
  const roomRows = await db.select().from(rooms).where(and(eq(rooms.propertyId, ctx.propertyId), eq(rooms.active, true))).orderBy(asc(rooms.sortOrder), asc(rooms.number));
  const avail = await availability(db, ctx, from, to);
  const [bar] = await db.select().from(ratePlans).where(and(eq(ratePlans.propertyId, ctx.propertyId), eq(ratePlans.type, "STANDARD"), eq(ratePlans.active, true))).orderBy(asc(ratePlans.sortOrder)).limit(1);
  const nights = await db
    .select({ n: roomNights, code: reservations.code, status: reservations.status, checkIn: reservations.checkIn, checkOut: reservations.checkOut, first: guests.firstName, last: guests.lastName })
    .from(roomNights)
    .innerJoin(reservations, eq(reservations.id, roomNights.reservationId))
    .innerJoin(guests, eq(guests.id, reservations.mainGuestId))
    .where(and(eq(roomNights.propertyId, ctx.propertyId), eq(roomNights.active, true), gte(roomNights.stayDate, from), lt(roomNights.stayDate, to)))
    .orderBy(asc(roomNights.reservationRoomId), asc(roomNights.stayDate));
  // Join consecutive nights of the same booked room in the same room into one bar.
  const bars: CalBar[] = [];
  for (const x of nights) {
    const i = idx.get(x.n.stayDate)!;
    const last = bars[bars.length - 1];
    if (last && last.reservationRoomId === x.n.reservationRoomId && last.roomId === x.n.roomId && last.start + last.span === i) {
      last.span++;
      continue;
    }
    bars.push({ reservationId: x.n.reservationId, reservationRoomId: x.n.reservationRoomId, code: x.code, guest: `${x.first} ${x.last}`, status: x.status, roomId: x.n.roomId, roomTypeId: x.n.roomTypeId, start: i, span: 1, continuesBefore: false, continuesAfter: false, checkIn: x.checkIn, checkOut: x.checkOut });
  }
  for (const b of bars) {
    b.continuesBefore = b.checkIn < from && b.start === 0;
    b.continuesAfter = b.checkOut > to && b.start + b.span === dates.length;
  }
  const blockRows = roomRows.length
    ? await db.select().from(roomBlocks).where(and(inArray(roomBlocks.roomId, roomRows.map((r) => r.id)), isNull(roomBlocks.releasedAt), lt(roomBlocks.startDate, to), gt(roomBlocks.endDate, from)))
    : [];
  const blocks = blockRows.map((b) => {
    const s = b.startDate < from ? 0 : idx.get(b.startDate)!;
    const e = b.endDate > to ? dates.length : idx.get(b.endDate)!;
    return { roomId: b.roomId, start: s, span: e - s, type: b.type, reason: b.reason };
  });
  const out: CalendarData["types"] = [];
  for (const t of types) {
    const rates = bar ? (await nightlyRates(db, ctx, bar.id, t.id, from, to)).map((n) => (n.closed ? null : n.rateCentavos.toString())) : dates.map(() => null);
    out.push({
      id: t.id,
      code: t.code,
      name: t.name,
      rooms: roomRows.filter((r) => r.roomTypeId === t.id).map((r) => ({ id: r.id, number: r.number, condition: r.condition })),
      available: avail.find((a) => a.roomTypeId === t.id)?.days.map((d) => d.available) ?? dates.map(() => 0),
      rates,
      unassigned: bars.filter((b) => !b.roomId && b.roomTypeId === t.id),
    });
  }
  return { dates, types: out, bars: bars.filter((b) => b.roomId), blocks };
}
