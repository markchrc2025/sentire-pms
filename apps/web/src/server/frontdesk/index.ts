import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { formatPeso, type IsoDate } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { guests, propertyRoles, reservationDiscounts, reservationRooms, reservations, roomBlocks, rooms, roomTypes, users } from "@sentire-pms/db/schema";
import { authorize, can, type TenantContext } from "../iam/tenant";
import { ForbiddenError, NotFoundError, ValidationError } from "../iam/errors";
import { recordChange, type Tx } from "../data/write";
import { guestInput } from "../guests";
import { transition } from "../reservations";
import { businessDateOf } from "../reservations/core";

/**
 * Folio balance of a reservation. Folios, payments and invoices arrive in Phase 6; until then
 * nothing can be owed, so the balance is zero. Check-out already enforces the rule through this.
 */
export async function folioBalance(_db: Db | Tx, _ctx: TenantContext, _reservationId: string): Promise<bigint> {
  return 0n;
}

export const ID_TYPES = ["Passport", "Driver's license", "UMID", "PhilSys National ID", "SSS ID", "PRC ID", "Postal ID", "Voter's ID", "Senior citizen ID", "PWD ID", "Company ID", "Other"] as const;

const discountLine = z.object({
  reservationRoomId: z.string().length(26),
  type: z.enum(["SENIOR_CITIZEN", "PWD"]),
  holderName: z.string().trim().min(2, "Enter the name on the senior citizen or PWD ID.").max(120),
  idNumber: z.string().trim().min(3, "Enter the senior citizen or PWD ID number.").max(60),
});

export const checkInInput = z.object({
  guest: guestInput.extend({
    idType: z.enum(ID_TYPES).optional().nullable(),
    idNumber: z.string().trim().max(60).optional().nullable().transform((v) => (v ? v : null)),
  }),
  discounts: z.array(discountLine).max(30).default([]),
  allowDirtyRooms: z.boolean().optional(),
});

/**
 * Check-in (FR-20, FR-21, UC-04): update the guest's details and ID, record senior citizen and
 * PWD claims, then move the reservation to Checked in. All in one transaction.
 */
export async function checkIn(db: Db, ctx: TenantContext, reservationId: string, raw: z.input<typeof checkInInput>) {
  authorize(ctx, "reservations.manage");
  const d = checkInInput.parse(raw);
  if (d.allowDirtyRooms && !can(ctx, "property.manage")) throw new ForbiddenError("Only an Owner or Admin can check a guest into a room that is not clean.");
  return db.transaction(async (tx) => {
    const [res] = await tx.select().from(reservations).where(and(eq(reservations.id, reservationId), eq(reservations.propertyId, ctx.propertyId))).limit(1);
    if (!res) throw new NotFoundError("Reservation not found.");
    const [before] = await tx.select().from(guests).where(eq(guests.id, res.mainGuestId)).for("update");
    const [after] = await tx.update(guests).set(d.guest).where(eq(guests.id, res.mainGuestId)).returning();
    await recordChange(tx, ctx, { entity: "guest", entityId: before!.id, op: "update", action: "guest.update", before, after: { ...after, reservationId } });
    const rrIds = new Set((await tx.select({ id: reservationRooms.id }).from(reservationRooms).where(eq(reservationRooms.reservationId, reservationId))).map((r) => r.id));
    for (const x of d.discounts) {
      if (!rrIds.has(x.reservationRoomId)) throw new ValidationError("A discount must be for a room of this reservation.");
      const [row] = await tx.insert(reservationDiscounts).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, reservationRoomId: x.reservationRoomId, type: x.type, holderName: x.holderName, idNumber: x.idNumber }).returning();
      await recordChange(tx, ctx, { entity: "reservation_discount", entityId: row!.id, op: "insert", action: "discount.claim", after: { ...row, reservationId } });
    }
    // Nested transaction (savepoint): the status change and the guest details stand or fall together.
    return transition(tx as unknown as Db, ctx, reservationId, "CHECKED_IN", { allowDirtyRooms: d.allowDirtyRooms });
  });
}

export async function discountsFor(db: Db, ctx: TenantContext, reservationId: string) {
  authorize(ctx, "reservations.view");
  return db
    .select({ d: reservationDiscounts })
    .from(reservationDiscounts)
    .innerJoin(reservationRooms, eq(reservationRooms.id, reservationDiscounts.reservationRoomId))
    .where(and(eq(reservationRooms.reservationId, reservationId), eq(reservationDiscounts.propertyId, ctx.propertyId)));
}

/** Check-out (FR-20, UC-06): the folio balance must be zero; the rooms become Dirty. */
export async function checkOut(db: Db, ctx: TenantContext, reservationId: string) {
  authorize(ctx, "reservations.manage");
  return db.transaction(async (tx) => {
    const balance = await folioBalance(tx, ctx, reservationId);
    if (balance !== 0n) throw new ValidationError(`The folio balance is ${formatPeso(balance)}. Take payment or move it to a city ledger account first.`);
    return transition(tx as unknown as Db, ctx, reservationId, "CHECKED_OUT");
  });
}

// ---------- Housekeeping (FR-22, FR-23) ----------

export type FrontDeskStatus = "ARRIVAL" | "DEPARTURE" | "TURNOVER" | "STAYOVER" | "OCCUPIED" | "VACANT" | "OUT_OF_SERVICE";
export const FD_LABEL: Record<FrontDeskStatus, string> = { ARRIVAL: "Arrival", DEPARTURE: "Departure", TURNOVER: "Turnover", STAYOVER: "Stayover", OCCUPIED: "Arrived", VACANT: "Vacant", OUT_OF_SERVICE: "Out of service" };

export interface BoardRoom {
  id: string;
  number: string;
  typeCode: string;
  typeName: string;
  condition: "DIRTY" | "CLEAN" | "INSPECTED";
  conditionChangedAt: Date | null;
  housekeeperUserId: string | null;
  housekeeperName: string | null;
  status: FrontDeskStatus;
  guest: string | null;
  notes: string | null;
}

/** Every room with its condition, front desk status for the business date and housekeeper. */
export async function housekeepingBoard(db: Db, ctx: TenantContext): Promise<{ businessDate: IsoDate; rooms: BoardRoom[]; housekeepers: { id: string; name: string }[] }> {
  authorize(ctx, "housekeeping.view");
  const bd = (await businessDateOf(db, ctx)).businessDate;
  const list = await db
    .select({ r: rooms, typeCode: roomTypes.code, typeName: roomTypes.name, hk: users.name })
    .from(rooms)
    .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .leftJoin(users, eq(users.id, rooms.housekeeperUserId))
    .where(and(eq(rooms.propertyId, ctx.propertyId), eq(rooms.organizationId, ctx.organizationId), eq(rooms.active, true)))
    .orderBy(asc(roomTypes.sortOrder), asc(rooms.sortOrder), asc(rooms.number));
  // Who sleeps in each room last night and tonight (active nights), and live stays arriving today.
  const nights = await db.execute(sql`
    select n.room_id, n.stay_date::text as d, r.status, r.check_in::text as check_in, r.check_out::text as check_out, g.first_name || ' ' || g.last_name as guest
    from room_nights n join reservations r on r.id = n.reservation_id join guests g on g.id = r.main_guest_id
    where n.property_id = ${ctx.propertyId} and n.active and n.room_id is not null and n.stay_date in (${bd}::date - 1, ${bd}::date)`);
  const departed = await db.execute(sql`
    select rr.room_id from reservations r join reservation_rooms rr on rr.reservation_id = r.id
    where r.property_id = ${ctx.propertyId} and r.status = 'CHECKED_OUT' and r.checked_out_business_date = ${bd} and rr.room_id is not null`);
  const blocks = await db.select({ roomId: roomBlocks.roomId }).from(roomBlocks).where(and(eq(roomBlocks.propertyId, ctx.propertyId), isNull(roomBlocks.releasedAt), sql`${roomBlocks.startDate} <= ${bd}`, sql`${roomBlocks.endDate} > ${bd}`));
  const blocked = new Set(blocks.map((b) => b.roomId));
  const departedRooms = new Set((departed.rows as { room_id: string }[]).map((x) => x.room_id));
  type N = { room_id: string; d: string; status: string; check_in: string; check_out: string; guest: string };
  const byRoom = new Map<string, N[]>();
  for (const n of nights.rows as N[]) byRoom.set(n.room_id, [...(byRoom.get(n.room_id) ?? []), n]);
  const hk = await db
    .select({ id: users.id, name: users.name })
    .from(propertyRoles)
    .innerJoin(users, eq(users.id, propertyRoles.userId))
    .where(and(eq(propertyRoles.propertyId, ctx.propertyId), eq(users.active, true), inArray(propertyRoles.role, ["HOUSEKEEPING", "ADMIN", "OWNER"])))
    .orderBy(asc(users.name));
  return {
    businessDate: bd,
    housekeepers: hk,
    rooms: list.map(({ r, typeCode, typeName, hk: hkName }) => {
      const ns = byRoom.get(r.id) ?? [];
      const tonight = ns.find((n) => n.d === bd);
      const lastNight = ns.find((n) => n.d < bd);
      const leaving = (lastNight && lastNight.check_out === bd) || departedRooms.has(r.id);
      const arriving = tonight && tonight.check_in === bd;
      let status: FrontDeskStatus = "VACANT";
      if (blocked.has(r.id)) status = "OUT_OF_SERVICE";
      else if (leaving && arriving) status = "TURNOVER";
      else if (arriving) status = tonight.status === "CHECKED_IN" ? "OCCUPIED" : "ARRIVAL";
      else if (leaving) status = "DEPARTURE";
      else if (tonight) status = "STAYOVER";
      return { id: r.id, number: r.number, typeCode, typeName, condition: r.condition, conditionChangedAt: r.conditionChangedAt, housekeeperUserId: r.housekeeperUserId, housekeeperName: hkName, status, guest: tonight?.guest ?? lastNight?.guest ?? null, notes: r.notes };
    }),
  };
}

export async function setRoomCondition(db: Db, ctx: TenantContext, roomId: string, condition: "DIRTY" | "CLEAN" | "INSPECTED") {
  authorize(ctx, "housekeeping.update");
  const c = z.enum(["DIRTY", "CLEAN", "INSPECTED"]).parse(condition);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Room not found.");
    if (c === "INSPECTED" && before.condition === "DIRTY") throw new ValidationError(`Room ${before.number} must be cleaned before it can be inspected.`);
    const [after] = await tx.update(rooms).set({ condition: c, conditionChangedAt: new Date() }).where(eq(rooms.id, roomId)).returning();
    await recordChange(tx, ctx, { entity: "room", entityId: roomId, op: "update", action: "room.condition", before: { id: before.id, condition: before.condition }, after: { id: after!.id, condition: after!.condition, conditionChangedAt: after!.conditionChangedAt } });
    return after!;
  });
}

export async function assignHousekeeper(db: Db, ctx: TenantContext, roomId: string, userId: string | null) {
  authorize(ctx, "housekeeping.update");
  if (!can(ctx, "property.manage") && userId && userId !== ctx.userId) throw new ForbiddenError("Only an Owner or Admin can give rooms to other housekeepers.");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(rooms).where(and(eq(rooms.id, roomId), eq(rooms.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Room not found.");
    if (userId) {
      const [r] = await tx.select().from(propertyRoles).where(and(eq(propertyRoles.userId, userId), eq(propertyRoles.propertyId, ctx.propertyId))).limit(1);
      if (!r) throw new ValidationError("Choose a staff member of this property.");
    }
    const [after] = await tx.update(rooms).set({ housekeeperUserId: userId }).where(eq(rooms.id, roomId)).returning();
    await recordChange(tx, ctx, { entity: "room", entityId: roomId, op: "update", action: "room.housekeeper", before: { id: before.id, housekeeperUserId: before.housekeeperUserId }, after: { id: after!.id, housekeeperUserId: after!.housekeeperUserId } });
    return after!;
  });
}

/** Registration card data (FR-21): property, guest, stay, rooms and claimed discounts. */
export async function registrationCard(db: Db, ctx: TenantContext, reservationId: string) {
  authorize(ctx, "reservations.view");
  const { getReservation } = await import("../reservations");
  const data = await getReservation(db, ctx, reservationId);
  const prop = await businessDateOf(db, ctx);
  const discounts = await discountsFor(db, ctx, reservationId);
  return { ...data, property: prop, discounts: discounts.map((x) => x.d) };
}


/** Store a photo or scan of the guest's ID on the hub and link it to the guest (FR-21). */
export async function attachIdImage(db: Db, ctx: TenantContext, guestId: string, file: File) {
  const { uploadFile } = await import("../files");
  const f = await uploadFile(db, ctx, { kind: "guest_id", ownerId: guestId, file });
  await db.transaction(async (tx) => {
    const [after] = await tx.update(guests).set({ idFileId: f.id }).where(and(eq(guests.id, guestId), eq(guests.propertyId, ctx.propertyId))).returning();
    await recordChange(tx, ctx, { entity: "guest", entityId: guestId, op: "update", action: "guest.id_image", after: { id: after!.id, idFileId: after!.idFileId } });
  });
  return f;
}
