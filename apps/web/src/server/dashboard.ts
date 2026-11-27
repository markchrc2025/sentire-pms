import { and, eq, gt, gte, inArray, sql } from "drizzle-orm";
import { addDays, nightsBetween, type IsoDate } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { guests, inventoryDays, reservations, roomTypes } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "./iam/tenant";
import { availability } from "./inventory/engine";
import { businessDateOf } from "./reservations/core";

export const TABS = ["arrivals", "departures", "inhouse", "stayovers", "new", "cancellations", "overbookings"] as const;
export type Tab = (typeof TABS)[number];

/** The dashboard for the business date (FR-18): activity lists, occupancy and a 14-day forecast. */
export async function dashboard(db: Db, ctx: TenantContext) {
  authorize(ctx, "reservations.view");
  const p = await businessDateOf(db, ctx);
  const bd = p.businessDate;
  // A fresh query builder for each list: Drizzle builders change in place.
  const base = () => db
    .select({ r: reservations, guest: sql<string>`${guests.firstName} || ' ' || ${guests.lastName}`, rooms: sql<string>`(select string_agg(coalesce(rm.number, rt.code), ', ') from reservation_rooms x join room_types rt on rt.id = x.room_type_id left join rooms rm on rm.id = x.room_id where x.reservation_id = "reservations"."id" and x.removed_at is null)` })
    .from(reservations)
    .innerJoin(guests, eq(guests.id, reservations.mainGuestId));
  const scope = and(eq(reservations.propertyId, ctx.propertyId), eq(reservations.organizationId, ctx.organizationId));
  const [arrivals, departures, inhouse, newOnes, cancellations] = await Promise.all([
    base().where(and(scope, eq(reservations.checkIn, bd), inArray(reservations.status, ["NOT_CONFIRMED", "CONFIRMED", "CHECKED_IN"]))),
    base().where(and(scope, sql`((${reservations.checkOut} = ${bd} and ${reservations.status} = 'CHECKED_IN') or (${reservations.checkedOutBusinessDate} = ${bd} and ${reservations.status} = 'CHECKED_OUT'))`)),
    base().where(and(scope, eq(reservations.status, "CHECKED_IN"))),
    base().where(and(scope, eq(reservations.createdBusinessDate, bd))),
    base().where(and(scope, sql`(${reservations.cancelledBusinessDate} = ${bd} or (${reservations.status} = 'NO_SHOW' and ${reservations.checkIn} = ${bd}))`)),
  ]);
  const stayovers = inhouse.filter((x) => x.r.checkIn < bd && x.r.checkOut > bd);
  const over = await db
    .select({ date: inventoryDays.stayDate, units: inventoryDays.overbookedUnits, type: roomTypes.name })
    .from(inventoryDays)
    .innerJoin(roomTypes, eq(roomTypes.id, inventoryDays.roomTypeId))
    .where(and(eq(inventoryDays.propertyId, ctx.propertyId), gte(inventoryDays.stayDate, bd), gt(inventoryDays.overbookedUnits, 0)))
    .orderBy(inventoryDays.stayDate)
    .limit(50);
  const end = addDays(bd, 14);
  const avail = await availability(db, ctx, bd, end);
  const counts = await db.execute(sql`
    select d::date::text as date,
      (select count(*)::int from reservations r where r.property_id = ${ctx.propertyId} and r.check_in = d::date and r.status in ('NOT_CONFIRMED','CONFIRMED','CHECKED_IN')) as arrivals,
      (select count(*)::int from reservations r where r.property_id = ${ctx.propertyId} and r.check_out = d::date and r.status in ('NOT_CONFIRMED','CONFIRMED','CHECKED_IN')) as departures
    from generate_series(${bd}::date, ${addDays(bd, 13)}::date, interval '1 day') d`);
  const byDate = new Map((counts.rows as { date: string; arrivals: number; departures: number }[]).map((r) => [r.date, r]));
  const forecast = nightsBetween(bd, end).map((date, i) => {
    let sold = 0;
    let sellable = 0;
    for (const t of avail) {
      const d = t.days[i]!;
      sold += d.sold;
      sellable += d.total - d.blocked;
    }
    return { date, sold, sellable, occupancy: sellable ? Math.round((sold / sellable) * 100) : 0, arrivals: byDate.get(date)?.arrivals ?? 0, departures: byDate.get(date)?.departures ?? 0 };
  });
  return {
    businessDate: bd as IsoDate,
    lists: { arrivals, departures, inhouse, stayovers, new: newOnes, cancellations } as Record<Exclude<Tab, "overbookings">, typeof arrivals>,
    overbookings: over,
    today: forecast[0]!,
    forecast,
  };
}

