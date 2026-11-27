import { and, desc, eq, gte, ilike, inArray, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { addDays, canTransition, holdsInventory, isIsoDate, nightsBetween, noShowPenaltyAmount, penaltyAt, STATUS_LABEL, zonedInstant, type IsoDate, type ResStatus } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { guests, policies, ratePlans, reservationNotes, reservationRooms, reservations, roomNights, rooms, roomTypes } from "@sentire-pms/db/schema";
import { authorize, can, type TenantContext } from "../iam/tenant";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../iam/errors";
import { recordChange, type Tx } from "../data/write";
import { createGuestTx, normalizeMobile } from "../guests";
import { quoteStay, type StayQuote } from "../rates/pricing";
import { termsOf } from "../rates/policies";
import { activeNights, businessDateOf, checkRoomUsable, checkStayWindow, endNights, hold, lockReservation, newReservationCode, release, roomsOf, setRoomOnNights, writeNights, type Res, type ResRoom } from "./core";

export const SOURCES = { WALK_IN: "Walk-in", PHONE: "Phone", EMAIL: "Email", DIRECT_ENGINE: "Booking engine", CORPORATE: "Corporate", TRAVEL_AGENT: "Travel agent", OTA_AGODA: "Agoda", OTA_BOOKING: "Booking.com", OTA_EXPEDIA: "Expedia", OTHER: "Other" } as const;

const isoDate = z.string().refine(isIsoDate, "Enter a valid date.");
const roomLine = z.object({
  roomTypeId: z.string().length(26, "Choose a room type."),
  ratePlanId: z.string().length(26, "Choose a rate plan."),
  adults: z.coerce.number().int().min(1).max(50),
  children: z.coerce.number().int().min(0).max(50).default(0),
  roomId: z.string().length(26).optional().nullable(),
});

export const createInput = z.object({
  source: z.enum(Object.keys(SOURCES) as [keyof typeof SOURCES, ...(keyof typeof SOURCES)[]]),
  status: z.enum(["INQUIRY", "NOT_CONFIRMED", "CONFIRMED"]),
  checkIn: isoDate,
  checkOut: isoDate,
  guestId: z.string().length(26).optional().nullable(),
  guest: z.record(z.string(), z.unknown()).optional().nullable(),
  rooms: z.array(roomLine).min(1, "Add at least one room.").max(30),
  notes: z.string().trim().max(4000).optional().nullable(),
  externalRef: z.string().trim().max(60).optional().nullable(),
  overbook: z.boolean().optional(),
  ignoreRestrictions: z.boolean().optional(),
});
export type CreateReservationInput = z.input<typeof createInput>;

async function quoteChecked(tx: Tx, ctx: TenantContext, line: z.infer<typeof roomLine>, checkIn: IsoDate, checkOut: IsoDate, ignoreRestrictions: boolean): Promise<StayQuote> {
  const [type] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, line.roomTypeId), eq(roomTypes.propertyId, ctx.propertyId))).limit(1);
  if (!type || !type.active) throw new ValidationError("Choose an active room type of this property.");
  const [plan] = await tx.select().from(ratePlans).where(and(eq(ratePlans.id, line.ratePlanId), eq(ratePlans.propertyId, ctx.propertyId))).limit(1);
  if (!plan || !plan.active) throw new ValidationError("Choose an active rate plan of this property.");
  const q = await quoteStay(tx, ctx, { ratePlanId: line.ratePlanId, roomTypeId: line.roomTypeId, checkIn, checkOut, adults: line.adults, children: line.children });
  const blocking = q.violations.filter((v) => v.code === "MAX_GUESTS" || !ignoreRestrictions);
  if (blocking.length) throw new ValidationError(`${type.name}: ${blocking.map((v) => v.message).join(" ")}`);
  return q;
}

/** Create a reservation (FR-11, UC-02): price each room, hold inventory, assign rooms if chosen. */
export async function createReservation(db: Db, ctx: TenantContext, raw: CreateReservationInput) {
  authorize(ctx, "reservations.manage");
  const d = createInput.parse(raw);
  if (d.overbook && !can(ctx, "property.manage")) throw new ForbiddenError("Only an Owner or Admin can overbook.");
  if (d.ignoreRestrictions && !can(ctx, "rates.manage")) throw new ForbiddenError("Only an Owner or Admin can book past rate restrictions.");
  if (!d.guestId && !d.guest) throw new ValidationError("Choose or add the main guest.");
  return db.transaction(async (tx) => {
    const prop = await businessDateOf(tx, ctx);
    checkStayWindow(prop.businessDate, d.checkIn, d.checkOut);
    let guestId = d.guestId ?? null;
    if (guestId) {
      const [g] = await tx.select({ id: guests.id }).from(guests).where(and(eq(guests.id, guestId), eq(guests.propertyId, ctx.propertyId))).limit(1);
      if (!g) throw new ValidationError("Choose a guest of this property.");
    } else {
      authorize(ctx, "guests.manage");
      guestId = (await createGuestTx(tx, ctx, d.guest)).id;
    }
    const quotes = [];
    for (const line of d.rooms) quotes.push({ line, q: await quoteChecked(tx, ctx, line, d.checkIn, d.checkOut, Boolean(d.ignoreRestrictions)) });
    const total = quotes.reduce((a, x) => a + x.q.roomTotalCentavos, 0n);
    const guarantee = quotes.reduce((a, x) => a + x.q.guaranteeCentavos, 0n);
    let holdUntil: Date | null = null;
    if (d.status === "NOT_CONFIRMED") {
      const hours = await tx.select({ h: policies.holdHours }).from(policies).where(inArray(policies.id, quotes.map((x) => x.q.policyId)));
      const min = Math.min(...hours.map((h) => h.h).filter((h) => h > 0));
      if (Number.isFinite(min)) holdUntil = new Date(Date.now() + min * 3_600_000);
    }
    const [res] = await tx
      .insert(reservations)
      .values({
        organizationId: ctx.organizationId,
        propertyId: ctx.propertyId,
        code: await newReservationCode(tx, ctx.propertyId),
        status: d.status,
        source: d.source,
        checkIn: d.checkIn,
        checkOut: d.checkOut,
        mainGuestId: guestId,
        adults: d.rooms.reduce((a, r) => a + r.adults, 0),
        children: d.rooms.reduce((a, r) => a + r.children, 0),
        totalCentavos: total,
        guaranteeCentavos: guarantee,
        notes: d.notes || null,
        externalRef: d.externalRef || null,
        createdBusinessDate: prop.businessDate,
        createdByUserId: ctx.userId,
        holdUntil,
        confirmedAt: d.status === "CONFIRMED" ? new Date() : null,
      })
      .returning();
    await recordChange(tx, ctx, { entity: "reservation", entityId: res!.id, op: "insert", action: "reservation.create", after: res });
    const holds = holdsInventory(d.status);
    for (const { line, q } of quotes) {
      const [rr] = await tx.insert(reservationRooms).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, reservationId: res!.id, roomTypeId: line.roomTypeId, ratePlanId: line.ratePlanId, checkIn: d.checkIn, checkOut: d.checkOut, adults: line.adults, children: line.children, totalCentavos: q.roomTotalCentavos, active: holds }).returning();
      await recordChange(tx, ctx, { entity: "reservation_room", entityId: rr!.id, op: "insert", action: "reservation_room.create", after: rr });
      if (holds) {
        await hold(tx, ctx, line.roomTypeId, d.checkIn, d.checkOut, Boolean(d.overbook));
        if (line.roomId) await checkRoomUsable(tx, ctx, line.roomId, line.roomTypeId, d.checkIn, d.checkOut);
        await writeNights(tx, ctx, rr!, q.nights, null);
        if (line.roomId) await setRoomOnNights(tx, ctx, rr!, line.roomId, d.checkIn);
      }
    }
    return res!;
  });
}

// ---------- Status changes (rule 10: the only place statuses change) ----------

export interface TransitionOptions {
  reason?: string;
  /** Check-in: rooms must be Clean or Inspected unless this is set (setting in Phase 5). */
  allowDirtyRooms?: boolean;
  now?: Date;
}

async function policyPenalty(tx: Tx, ctx: TenantContext, res: Res, kind: "cancel" | "noshow", now: Date): Promise<bigint> {
  const prop = await businessDateOf(tx, ctx);
  let total = 0n;
  for (const rr of await roomsOf(tx, res.id)) {
    const [plan] = await tx.select().from(ratePlans).where(eq(ratePlans.id, rr.ratePlanId)).limit(1);
    const [pol] = await tx.select().from(policies).where(eq(policies.id, plan!.policyId)).limit(1);
    const nightly = (await activeNights(tx, rr.id)).map((n) => n.rateCentavos);
    if (!pol) continue;
    total += kind === "noshow" ? noShowPenaltyAmount(termsOf(pol), nightly) : penaltyAt(termsOf(pol), { arrivalAt: zonedInstant(res.checkIn, prop.checkInTime, prop.timezone), cancelAt: now, nightlyRates: nightly });
  }
  return total;
}

/** What cancelling now would cost under the policies (shown before the agent confirms). */
export async function cancellationPreview(db: Db, ctx: TenantContext, id: string) {
  authorize(ctx, "reservations.view");
  return db.transaction(async (tx) => {
    const res = await lockReservation(tx, ctx, id);
    return { penaltyCentavos: holdsInventory(res.status) || res.status === "INQUIRY" ? await policyPenalty(tx, ctx, res, "cancel", new Date()) : 0n };
  });
}

/**
 * Move a reservation to another status, enforcing the state machine and each transition's rules.
 * Folio balance checks join at check-out in Phase 6.
 */
export async function transition(db: Db, ctx: TenantContext, id: string, to: ResStatus, opts: TransitionOptions = {}) {
  authorize(ctx, "reservations.manage");
  const now = opts.now ?? new Date();
  return db.transaction(async (tx) => {
    const res = await lockReservation(tx, ctx, id);
    if (!canTransition(res.status, to)) throw new ValidationError(`A reservation that is ${STATUS_LABEL[res.status]} cannot become ${STATUS_LABEL[to]}.`);
    const prop = await businessDateOf(tx, ctx);
    const bd = prop.businessDate;
    const patch: Partial<Res> = { status: to };
    const rrs = await roomsOf(tx, res.id, { activeOnly: false });

    if (res.status === "INQUIRY" && holdsInventory(to)) {
      // An inquiry becomes a booking: hold rooms and write nights at today's rates.
      checkStayWindow(bd, res.checkIn, res.checkOut);
      for (const rr of rrs) {
        const q = await quoteStay(tx, ctx, { ratePlanId: rr.ratePlanId, roomTypeId: rr.roomTypeId, checkIn: rr.checkIn, checkOut: rr.checkOut, adults: rr.adults, children: rr.children });
        await hold(tx, ctx, rr.roomTypeId, rr.checkIn, rr.checkOut);
        await tx.update(reservationRooms).set({ active: true, totalCentavos: q.roomTotalCentavos }).where(eq(reservationRooms.id, rr.id));
        await writeNights(tx, ctx, { ...rr, active: true }, q.nights, null);
      }
    }
    if (to === "CONFIRMED") {
      patch.confirmedAt = now;
      patch.holdUntil = null;
    }
    if (to === "CANCELLED" || to === "NO_SHOW") {
      if (to === "CANCELLED" && !opts.reason?.trim()) throw new ValidationError("Give a reason for the cancellation.");
      if (to === "NO_SHOW" && bd < res.checkIn) throw new ValidationError(`A no-show can be marked from the arrival date (${res.checkIn}).`);
      patch.penaltyCentavos = res.status === "INQUIRY" ? 0n : await policyPenalty(tx, ctx, res, to === "NO_SHOW" ? "noshow" : "cancel", now);
      if (to === "CANCELLED") {
        patch.cancelledAt = now;
        patch.cancelledBusinessDate = bd;
        patch.cancelReason = opts.reason!.trim().slice(0, 500);
      } else patch.noShowAt = now;
      for (const rr of rrs.filter((r) => r.active)) {
        await release(tx, ctx, rr.roomTypeId, rr.checkIn, rr.checkOut);
        await endNights(tx, ctx, rr.id);
        await tx.update(reservationRooms).set({ active: false }).where(eq(reservationRooms.id, rr.id));
      }
    }
    if (to === "CHECKED_IN") {
      if (res.status === "CHECKED_OUT") {
        if (!can(ctx, "property.manage")) throw new ForbiddenError("Only an Owner or Admin can reopen a checked-out stay.");
        if (res.checkedOutBusinessDate !== bd) throw new ValidationError("A stay can be reopened only on the business date it was checked out.");
        patch.checkedOutAt = null;
        patch.checkedOutBusinessDate = null;
      } else {
        if (bd < res.checkIn) throw new ValidationError(`Check-in opens on the arrival date (${res.checkIn}).`);
        if (bd >= res.checkOut) throw new ValidationError("The stay has already ended. Mark it as a no-show or change the dates.");
        const active = rrs.filter((r) => r.active);
        const unassigned = active.filter((r) => !r.roomId);
        if (unassigned.length) throw new ValidationError("Assign a room to every booked room before check-in.");
        const assigned = await tx.select().from(rooms).where(inArray(rooms.id, active.map((r) => r.roomId!)));
        const dirty = assigned.filter((r) => r.condition === "DIRTY");
        if (dirty.length && !opts.allowDirtyRooms) throw new ValidationError(`Room ${dirty.map((r) => r.number).join(", ")} is not clean yet.`);
        // Arriving later than booked: nights before today were not used.
        if (bd > res.checkIn) throw new ValidationError("This guest arrives after the booked arrival date. Change the arrival date first.");
        patch.checkedInAt = now;
      }
    }
    if (to === "CHECKED_OUT") {
      patch.checkedOutAt = now;
      patch.checkedOutBusinessDate = bd;
      const active = rrs.filter((r) => r.active);
      // Early departure: give back the nights from today on (keep at least the first night).
      const releaseFrom = bd > res.checkIn ? bd : addDays(res.checkIn, 1);
      if (releaseFrom < res.checkOut) {
        for (const rr of active) {
          await release(tx, ctx, rr.roomTypeId, releaseFrom, rr.checkOut);
          await endNights(tx, ctx, rr.id, releaseFrom);
          await tx.update(reservationRooms).set({ checkOut: releaseFrom }).where(eq(reservationRooms.id, rr.id));
        }
        patch.checkOut = releaseFrom;
      }
      // The guest has left: the rooms need cleaning (FR-22).
      const ids = active.map((r) => r.roomId).filter((x): x is string => Boolean(x));
      if (ids.length) {
        const changed = await tx.update(rooms).set({ condition: "DIRTY", conditionChangedAt: now }).where(inArray(rooms.id, ids)).returning();
        for (const r of changed) await recordChange(tx, ctx, { entity: "room", entityId: r.id, op: "update", action: "room.condition", after: { id: r.id, condition: r.condition, conditionChangedAt: r.conditionChangedAt } });
      }
    }
    const [after] = await tx.update(reservations).set(patch).where(eq(reservations.id, id)).returning();
    await recordChange(tx, ctx, { entity: "reservation", entityId: id, op: "update", action: `reservation.${to.toLowerCase()}`, before: res, after });
    return after!;
  });
}

// ---------- Room assignment (FR-13) ----------

async function lockResRoom(tx: Tx, ctx: TenantContext, reservationRoomId: string) {
  const [rr] = await tx.select().from(reservationRooms).where(and(eq(reservationRooms.id, reservationRoomId), eq(reservationRooms.propertyId, ctx.propertyId))).for("update");
  if (!rr) throw new NotFoundError("Booked room not found.");
  const res = await lockReservation(tx, ctx, rr.reservationId);
  return { rr, res };
}

/** Assign, change or remove the room of a booked room. Nights already slept keep their room. */
export async function assignRoom(db: Db, ctx: TenantContext, reservationRoomId: string, roomId: string | null) {
  authorize(ctx, "reservations.manage");
  return db.transaction(async (tx) => {
    const { rr, res } = await lockResRoom(tx, ctx, reservationRoomId);
    if (!holdsInventory(res.status) || !rr.active) throw new ValidationError(`Rooms can be assigned to live bookings only (this one is ${STATUS_LABEL[res.status]}).`);
    const bd = (await businessDateOf(tx, ctx)).businessDate;
    const from = res.status === "CHECKED_IN" && bd > rr.checkIn ? bd : rr.checkIn;
    if (!roomId && res.status === "CHECKED_IN") throw new ValidationError("A checked-in guest must keep a room. Move them to another room instead.");
    if (roomId) await checkRoomUsable(tx, ctx, roomId, rr.roomTypeId, from, rr.checkOut);
    return setRoomOnNights(tx, ctx, rr, roomId, from);
  });
}

/** Rooms of the right type free for every night of a booked room (for the assign list). */
export async function freeRoomsFor(db: Db, ctx: TenantContext, reservationRoomId: string) {
  authorize(ctx, "reservations.view");
  const [rr] = await db.select().from(reservationRooms).where(and(eq(reservationRooms.id, reservationRoomId), eq(reservationRooms.propertyId, ctx.propertyId))).limit(1);
  if (!rr) throw new NotFoundError("Booked room not found.");
  const r = await db.execute(sql`
    select r.id, r.number, r.condition from rooms r
    where r.property_id = ${ctx.propertyId} and r.room_type_id = ${rr.roomTypeId} and r.active
      and not exists (select 1 from room_nights n where n.room_id = r.id and n.active and n.stay_date >= ${rr.checkIn} and n.stay_date < ${rr.checkOut} and n.reservation_room_id <> ${rr.id})
      and not exists (select 1 from room_blocks b where b.room_id = r.id and b.released_at is null and b.start_date < ${rr.checkOut} and b.end_date > ${rr.checkIn})
    order by r.sort_order, r.number`);
  return r.rows as { id: string; number: string; condition: string }[];
}

// ---------- Changes to dates and rooms (FR-14) ----------

export const changeDatesInput = z.object({ checkIn: isoDate, checkOut: isoDate, overbook: z.boolean().optional(), ignoreRestrictions: z.boolean().optional() });

/**
 * Change arrival and departure. Every booked room is re-priced at current rates and re-checked
 * against availability; assigned rooms are kept when still free, otherwise unassigned. A
 * checked-in stay can only move its departure.
 */
export async function changeDates(db: Db, ctx: TenantContext, id: string, raw: z.input<typeof changeDatesInput>) {
  authorize(ctx, "reservations.manage");
  const d = changeDatesInput.parse(raw);
  if (d.overbook && !can(ctx, "property.manage")) throw new ForbiddenError("Only an Owner or Admin can overbook.");
  if (d.ignoreRestrictions && !can(ctx, "rates.manage")) throw new ForbiddenError("Only an Owner or Admin can book past rate restrictions.");
  return db.transaction(async (tx) => {
    const res = await lockReservation(tx, ctx, id);
    if (!["INQUIRY", "NOT_CONFIRMED", "CONFIRMED", "CHECKED_IN"].includes(res.status)) throw new ValidationError(`Dates of a ${STATUS_LABEL[res.status]} reservation cannot change.`);
    const bd = (await businessDateOf(tx, ctx)).businessDate;
    const unassigned: string[] = [];
    if (res.status === "CHECKED_IN") {
      if (d.checkIn !== res.checkIn) throw new ValidationError("The guest is checked in: only the departure date can change.");
      if (d.checkOut <= bd) throw new ValidationError("Departure must be after the business date. To leave today, check the guest out.");
      checkStayWindow(bd, d.checkIn, d.checkOut, { allowPastArrival: true });
      for (const rr of await roomsOf(tx, res.id)) {
        if (d.checkOut > rr.checkOut) {
          const q = await quoteChecked(tx, ctx, rr, rr.checkOut, d.checkOut, Boolean(d.ignoreRestrictions));
          await hold(tx, ctx, rr.roomTypeId, rr.checkOut, d.checkOut, Boolean(d.overbook));
          await checkRoomUsable(tx, ctx, rr.roomId!, rr.roomTypeId, rr.checkOut, d.checkOut);
          await writeNights(tx, ctx, rr, q.nights, rr.roomId);
        } else if (d.checkOut < rr.checkOut) {
          await release(tx, ctx, rr.roomTypeId, d.checkOut, rr.checkOut);
          await endNights(tx, ctx, rr.id, d.checkOut);
        }
        const total = (await activeNights(tx, rr.id)).reduce((a, n) => a + n.rateCentavos, 0n);
        await tx.update(reservationRooms).set({ checkOut: d.checkOut, totalCentavos: total }).where(eq(reservationRooms.id, rr.id));
      }
    } else {
      checkStayWindow(bd, d.checkIn, d.checkOut);
      const holds = holdsInventory(res.status);
      for (const rr of await roomsOf(tx, res.id, { activeOnly: holds })) {
        const q = await quoteChecked(tx, ctx, rr, d.checkIn, d.checkOut, Boolean(d.ignoreRestrictions));
        if (holds) {
          await release(tx, ctx, rr.roomTypeId, rr.checkIn, rr.checkOut);
          await endNights(tx, ctx, rr.id);
          await hold(tx, ctx, rr.roomTypeId, d.checkIn, d.checkOut, Boolean(d.overbook));
          await writeNights(tx, ctx, rr, q.nights, null);
          if (rr.roomId) {
            try {
              await checkRoomUsable(tx, ctx, rr.roomId, rr.roomTypeId, d.checkIn, d.checkOut);
              await setRoomOnNights(tx, ctx, { ...rr, checkIn: d.checkIn, checkOut: d.checkOut }, rr.roomId, d.checkIn);
            } catch (e) {
              if (!(e instanceof ConflictError)) throw e;
              unassigned.push(rr.id);
              await tx.update(reservationRooms).set({ roomId: null }).where(eq(reservationRooms.id, rr.id));
            }
          }
        }
        await tx.update(reservationRooms).set({ checkIn: d.checkIn, checkOut: d.checkOut, totalCentavos: q.roomTotalCentavos }).where(eq(reservationRooms.id, rr.id));
      }
    }
    const rrs = await roomsOf(tx, res.id, { activeOnly: false });
    const [after] = await tx.update(reservations).set({ checkIn: d.checkIn, checkOut: d.checkOut, totalCentavos: rrs.reduce((a, r) => a + r.totalCentavos, 0n) }).where(eq(reservations.id, id)).returning();
    await recordChange(tx, ctx, { entity: "reservation", entityId: id, op: "update", action: "reservation.change_dates", before: res, after });
    return { reservation: after!, unassigned };
  });
}

export const roomChangeInput = z.object({ roomTypeId: z.string().length(26), ratePlanId: z.string().length(26), adults: z.coerce.number().int().min(1).max(50), children: z.coerce.number().int().min(0).max(50).default(0) });

/** Change the room type, rate plan or guests of a booked room (before check-in); re-prices it. */
export async function changeBookedRoom(db: Db, ctx: TenantContext, reservationRoomId: string, raw: z.input<typeof roomChangeInput>, opts: { overbook?: boolean } = {}) {
  authorize(ctx, "reservations.manage");
  const d = roomChangeInput.parse(raw);
  if (opts.overbook && !can(ctx, "property.manage")) throw new ForbiddenError("Only an Owner or Admin can overbook.");
  return db.transaction(async (tx) => {
    const { rr, res } = await lockResRoom(tx, ctx, reservationRoomId);
    if (!["INQUIRY", "NOT_CONFIRMED", "CONFIRMED"].includes(res.status)) throw new ValidationError("Change rooms before check-in. For a checked-in guest, move them to another room.");
    const q = await quoteChecked(tx, ctx, d, rr.checkIn, rr.checkOut, false);
    const holds = holdsInventory(res.status) && rr.active;
    const typeChanged = d.roomTypeId !== rr.roomTypeId;
    if (holds) {
      await release(tx, ctx, rr.roomTypeId, rr.checkIn, rr.checkOut);
      await endNights(tx, ctx, rr.id);
      await hold(tx, ctx, d.roomTypeId, rr.checkIn, rr.checkOut, Boolean(opts.overbook));
    }
    const [after] = await tx.update(reservationRooms).set({ ...d, totalCentavos: q.roomTotalCentavos, roomId: typeChanged ? null : rr.roomId }).where(eq(reservationRooms.id, rr.id)).returning();
    if (holds) await writeNights(tx, ctx, after!, q.nights, typeChanged ? null : rr.roomId);
    await recordChange(tx, ctx, { entity: "reservation_room", entityId: rr.id, op: "update", action: "reservation_room.change", before: rr, after });
    await refreshTotals(tx, ctx, res);
    return after!;
  });
}

export async function addBookedRoom(db: Db, ctx: TenantContext, reservationId: string, raw: z.input<typeof roomChangeInput>, opts: { overbook?: boolean } = {}) {
  authorize(ctx, "reservations.manage");
  const d = roomChangeInput.parse(raw);
  if (opts.overbook && !can(ctx, "property.manage")) throw new ForbiddenError("Only an Owner or Admin can overbook.");
  return db.transaction(async (tx) => {
    const res = await lockReservation(tx, ctx, reservationId);
    if (!["INQUIRY", "NOT_CONFIRMED", "CONFIRMED"].includes(res.status)) throw new ValidationError("Add rooms before check-in.");
    const q = await quoteChecked(tx, ctx, d, res.checkIn, res.checkOut, false);
    const holds = holdsInventory(res.status);
    const [rr] = await tx.insert(reservationRooms).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, reservationId, ...d, checkIn: res.checkIn, checkOut: res.checkOut, totalCentavos: q.roomTotalCentavos, active: holds }).returning();
    await recordChange(tx, ctx, { entity: "reservation_room", entityId: rr!.id, op: "insert", action: "reservation_room.create", after: rr });
    if (holds) {
      await hold(tx, ctx, d.roomTypeId, res.checkIn, res.checkOut, Boolean(opts.overbook));
      await writeNights(tx, ctx, rr!, q.nights, null);
    }
    await refreshTotals(tx, ctx, res);
    return rr!;
  });
}

export async function removeBookedRoom(db: Db, ctx: TenantContext, reservationRoomId: string) {
  authorize(ctx, "reservations.manage");
  return db.transaction(async (tx) => {
    const { rr, res } = await lockResRoom(tx, ctx, reservationRoomId);
    if (!["INQUIRY", "NOT_CONFIRMED", "CONFIRMED"].includes(res.status)) throw new ValidationError("Remove rooms before check-in.");
    const live = await roomsOf(tx, res.id, { activeOnly: false });
    if (live.length <= 1) throw new ValidationError("A reservation needs at least one room. Cancel the reservation instead.");
    if (rr.active && holdsInventory(res.status)) {
      await release(tx, ctx, rr.roomTypeId, rr.checkIn, rr.checkOut);
      await endNights(tx, ctx, rr.id);
    }
    const [after] = await tx.update(reservationRooms).set({ active: false, roomId: null, removedAt: new Date() }).where(eq(reservationRooms.id, rr.id)).returning();
    await recordChange(tx, ctx, { entity: "reservation_room", entityId: rr.id, op: "update", action: "reservation_room.remove", before: rr, after });
    await refreshTotals(tx, ctx, res);
  });
}

async function refreshTotals(tx: Tx, ctx: TenantContext, res: Res) {
  const rrs = await roomsOf(tx, res.id, { activeOnly: false });
  const [after] = await tx
    .update(reservations)
    .set({ totalCentavos: rrs.reduce((a, r) => a + r.totalCentavos, 0n), adults: Math.max(1, rrs.reduce((a, r) => a + r.adults, 0)), children: rrs.reduce((a, r) => a + r.children, 0) })
    .where(eq(reservations.id, res.id))
    .returning();
  await recordChange(tx, ctx, { entity: "reservation", entityId: res.id, op: "update", action: "reservation.totals", before: res, after });
}

export async function updateReservationInfo(db: Db, ctx: TenantContext, id: string, raw: { source?: string; notes?: string | null; externalRef?: string | null; mainGuestId?: string }) {
  authorize(ctx, "reservations.manage");
  const d = z.object({ source: createInput.shape.source.optional(), notes: z.string().trim().max(4000).nullable().optional(), externalRef: z.string().trim().max(60).nullable().optional(), mainGuestId: z.string().length(26).optional() }).parse(raw);
  return db.transaction(async (tx) => {
    const res = await lockReservation(tx, ctx, id);
    if (d.mainGuestId) {
      const [g] = await tx.select({ id: guests.id }).from(guests).where(and(eq(guests.id, d.mainGuestId), eq(guests.propertyId, ctx.propertyId))).limit(1);
      if (!g) throw new ValidationError("Choose a guest of this property.");
    }
    const [after] = await tx.update(reservations).set(d).where(eq(reservations.id, id)).returning();
    await recordChange(tx, ctx, { entity: "reservation", entityId: id, op: "update", action: "reservation.update", before: res, after });
    return after!;
  });
}

// ---------- Notes and activity (FR-17) ----------

export async function addNote(db: Db, ctx: TenantContext, reservationId: string, body: string) {
  authorize(ctx, "reservations.manage");
  const text = z.string().trim().min(1, "Write the note first.").max(4000).parse(body);
  return db.transaction(async (tx) => {
    await lockReservation(tx, ctx, reservationId);
    const [n] = await tx.insert(reservationNotes).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, reservationId, body: text, authorUserId: ctx.userId }).returning();
    await recordChange(tx, ctx, { entity: "reservation_note", entityId: n!.id, op: "insert", action: "reservation_note.create", after: n });
    return n!;
  });
}

/** Everything that happened to a reservation, newest first, from the audit log. */
export async function activityLog(db: Db, ctx: TenantContext, reservationId: string) {
  authorize(ctx, "reservations.view");
  const r = await db.execute(sql`
    select a.action, a.at, a.entity, a.after, u.name as actor from audit_log a left join users u on u.id = a.actor_user_id
    where a.property_id = ${ctx.propertyId} and (a.entity_id = ${reservationId} or a.after->>'reservationId' = ${reservationId})
      and a.entity <> 'room_night'
    order by a.at desc limit 200`);
  return r.rows as { action: string; at: string; entity: string; after: Record<string, unknown> | null; actor: string | null }[];
}

// ---------- Reading ----------

export async function getReservation(db: Db, ctx: TenantContext, id: string) {
  authorize(ctx, "reservations.view");
  const [res] = await db.select().from(reservations).where(and(eq(reservations.id, id), eq(reservations.propertyId, ctx.propertyId), eq(reservations.organizationId, ctx.organizationId))).limit(1);
  if (!res) throw new NotFoundError("Reservation not found.");
  const [guest] = await db.select().from(guests).where(eq(guests.id, res.mainGuestId)).limit(1);
  const rrs = await db
    .select({ rr: reservationRooms, typeCode: roomTypes.code, typeName: roomTypes.name, planCode: ratePlans.code, planName: ratePlans.name, roomNumber: rooms.number, roomCondition: rooms.condition })
    .from(reservationRooms)
    .innerJoin(roomTypes, eq(roomTypes.id, reservationRooms.roomTypeId))
    .innerJoin(ratePlans, eq(ratePlans.id, reservationRooms.ratePlanId))
    .leftJoin(rooms, eq(rooms.id, reservationRooms.roomId))
    .where(and(eq(reservationRooms.reservationId, id), sql`${reservationRooms.removedAt} is null`))
    .orderBy(reservationRooms.createdAt, reservationRooms.id);
  const nights = await db.select().from(roomNights).where(and(eq(roomNights.reservationId, id), eq(roomNights.active, true))).orderBy(roomNights.stayDate);
  const notes = await db.execute(sql`select n.id, n.body, n.created_at, u.name as author from reservation_notes n left join users u on u.id = n.author_user_id where n.reservation_id = ${id} order by n.created_at desc`);
  return { reservation: res, guest: guest!, rooms: rrs, nights, notes: notes.rows as { id: string; body: string; created_at: string; author: string | null }[] };
}

export const listInput = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.array(z.enum(["INQUIRY", "NOT_CONFIRMED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"])).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  source: z.string().optional(),
  roomTypeId: z.string().length(26).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

/** Reservation list with filters and search by code, guest name, email or mobile (FR-16). */
export async function listReservations(db: Db, ctx: TenantContext, raw: z.input<typeof listInput>) {
  authorize(ctx, "reservations.view");
  const d = listInput.parse(raw);
  const like = d.q ? `%${d.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const mobile = d.q ? normalizeMobile(d.q) : null;
  const where = and(
    eq(reservations.propertyId, ctx.propertyId),
    eq(reservations.organizationId, ctx.organizationId),
    d.status?.length ? inArray(reservations.status, d.status) : undefined,
    d.from ? gte(reservations.checkOut, d.from) : undefined,
    d.to ? lte(reservations.checkIn, d.to) : undefined,
    d.source ? eq(reservations.source, d.source as never) : undefined,
    d.roomTypeId ? sql`exists (select 1 from reservation_rooms x where x.reservation_id = ${reservations.id} and x.room_type_id = ${d.roomTypeId})` : undefined,
    like
      ? or(
          ilike(reservations.code, like),
          ilike(reservations.externalRef, like),
          ilike(sql`${guests.firstName} || ' ' || ${guests.lastName}`, like),
          ilike(guests.email, like),
          mobile && mobile.length >= 4 ? ilike(guests.mobile, `%${mobile.replace(/^\+63/, "")}%`) : undefined,
        )
      : undefined,
  );
  const rows = await db
    .select({
      r: reservations,
      guestName: sql<string>`${guests.firstName} || ' ' || ${guests.lastName}`,
      rooms: sql<string>`(select string_agg(coalesce(rm.number, rt.code), ', ' order by x.created_at) from reservation_rooms x join room_types rt on rt.id = x.room_type_id left join rooms rm on rm.id = x.room_id where x.reservation_id = "reservations"."id" and x.removed_at is null)`,
    })
    .from(reservations)
    .innerJoin(guests, eq(guests.id, reservations.mainGuestId))
    .where(where)
    .orderBy(desc(reservations.checkIn), desc(reservations.createdAt))
    .limit(51)
    .offset((d.page - 1) * 50);
  return { rows: rows.slice(0, 50), more: rows.length > 50 };
}

