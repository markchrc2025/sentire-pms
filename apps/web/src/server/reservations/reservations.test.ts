import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ZodError } from "zod";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { inventoryDays, properties, roomNights, rooms } from "@sentire-pms/db/schema";
import { makeBookableProperty } from "@/test/fixtures";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "../iam/errors";
import { NoAvailabilityError } from "../inventory/engine";
import { createBlock } from "../inventory/rooms";
import { setDay } from "../rates/pricing";
import { activityLog, addBookedRoom, addNote, assignRoom, cancellationPreview, changeBookedRoom, changeDates, createReservation, freeRoomsFor, getReservation, listReservations, removeBookedRoom, transition } from "./index";
import { duplicateSuggestions, searchGuests } from "../guests";

type P = Awaited<ReturnType<typeof makeBookableProperty>>;
const guest = (n: string) => ({ firstName: n, lastName: "Santos", email: `${n.toLowerCase()}@guest.example`, mobile: "0917 123 4567" });

async function sold(db: Awaited<ReturnType<typeof freshTestDb>>["db"], typeId: string, date: string) {
  const [r] = await db.select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, typeId), eq(inventoryDays.stayDate, date)));
  return r?.soldUnits ?? 0;
}

describe.skipIf(!TEST_DATABASE_URL)("reservations (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  let p: P;
  let other: P;
  beforeAll(async () => {
    c = await freshTestDb();
    p = await makeBookableProperty(c.db);
    other = await makeBookableProperty(c.db);
  });
  afterAll(async () => {
    await c?.pool.end();
  });
  const fd = () => p.ctx.FRONT_DESK;

  it("creates a confirmed booking: prices nights, holds inventory, makes the guest", async () => {
    const r = await createReservation(c.db, fd(), { source: "PHONE", status: "CONFIRMED", checkIn: "2026-11-26", checkOut: "2026-11-28", guest: guest("Ana"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 2 }] });
    expect(r.code).toMatch(/^R[2-9A-Z]{6}$/);
    expect(r.totalCentavos).toBe(640000n);
    expect(r.guaranteeCentavos).toBe(320000n);
    expect(await sold(c.db, p.dlx.id, "2026-11-26")).toBe(1);
    expect(await sold(c.db, p.dlx.id, "2026-11-28")).toBe(0);
    const g = (await searchGuests(c.db, fd(), "ana santos"))[0]!;
    expect(g.mobile).toBe("+639171234567");
    expect((await duplicateSuggestions(c.db, fd(), { mobile: "09171234567" })).length).toBe(1);
  });

  it("validates input, restrictions, guests per room and permissions", async () => {
    const base = { source: "PHONE" as const, status: "CONFIRMED" as const, checkIn: "2026-11-26", checkOut: "2026-11-27", guest: guest("Ben") };
    await expect(createReservation(c.db, fd(), { ...base, rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 3 }] })).rejects.toThrow(/at most 2 guests/);
    await expect(createReservation(c.db, fd(), { ...base, checkIn: "2026-11-20", rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 }] })).rejects.toThrow(/before the business date/);
    await expect(createReservation(c.db, fd(), { ...base, rooms: [] })).rejects.toBeInstanceOf(ZodError);
    await expect(createReservation(c.db, p.ctx.HOUSEKEEPING, { ...base, rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(createReservation(c.db, other.ctx.FRONT_DESK, { ...base, rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 }] })).rejects.toBeInstanceOf(ValidationError);
    await setDay(c.db, p.ctx.ADMIN, { ratePlanId: p.bar.id, roomTypeId: p.dlx.id, date: "2026-12-05", patch: { minStay: 2 } });
    const minStay = { ...base, checkIn: "2026-12-05", checkOut: "2026-12-06", rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 }] };
    await expect(createReservation(c.db, fd(), minStay)).rejects.toThrow(/Minimum stay/);
    await expect(createReservation(c.db, fd(), { ...minStay, ignoreRestrictions: true })).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await createReservation(c.db, p.ctx.ADMIN, { ...minStay, ignoreRestrictions: true });
    await transition(c.db, p.ctx.ADMIN, ok.id, "CANCELLED", { reason: "test" });
  });

  it("never sells the last room twice, even in parallel; Admins may overbook", async () => {
    const line = (n: string) => ({ source: "PHONE" as const, status: "CONFIRMED" as const, checkIn: "2026-12-20", checkOut: "2026-12-21", guest: guest(n), rooms: [{ roomTypeId: p.fam.id, ratePlanId: p.bar.id, adults: 2 }] });
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => createReservation(c.db, fd(), line(`Par${i}`))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected").every((r) => (r as PromiseRejectedResult).reason instanceof NoAvailabilityError)).toBe(true);
    await expect(createReservation(c.db, fd(), { ...line("Over"), overbook: true })).rejects.toBeInstanceOf(ForbiddenError);
    const over = await createReservation(c.db, p.ctx.ADMIN, { ...line("Over"), overbook: true });
    expect(await sold(c.db, p.fam.id, "2026-12-20")).toBe(2);
    await transition(c.db, p.ctx.ADMIN, over.id, "CANCELLED", { reason: "Overbooking test" });
  });

  it("assigns rooms; the unique room-night index refuses a collision; blocked rooms are refused", async () => {
    const a = await createReservation(c.db, fd(), { source: "WALK_IN", status: "CONFIRMED", checkIn: "2026-11-24", checkOut: "2026-11-26", guest: guest("Cara"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1, roomId: p.dlxRooms[0]!.id }] });
    const b = await createReservation(c.db, fd(), { source: "WALK_IN", status: "CONFIRMED", checkIn: "2026-11-25", checkOut: "2026-11-27", guest: guest("Dan"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 }] });
    const bRoom = (await getReservation(c.db, fd(), b.id)).rooms[0]!.rr;
    await expect(assignRoom(c.db, fd(), bRoom.id, p.dlxRooms[0]!.id)).rejects.toBeInstanceOf(ConflictError);
    expect((await freeRoomsFor(c.db, fd(), bRoom.id)).map((r) => r.number)).not.toContain("101");
    await createBlock(c.db, p.ctx.ADMIN, { roomId: p.dlxRooms[2]!.id, startDate: "2026-11-26", endDate: "2026-11-27", type: "OUT_OF_SERVICE", reason: "Leak" });
    await expect(assignRoom(c.db, fd(), bRoom.id, p.dlxRooms[2]!.id)).rejects.toThrow(/blocked/);
    await expect(assignRoom(c.db, fd(), bRoom.id, p.famRooms[0]!.id)).rejects.toThrow(/another room type/);
    await assignRoom(c.db, fd(), bRoom.id, p.dlxRooms[1]!.id);
    expect((await getReservation(c.db, fd(), b.id)).rooms[0]!.roomNumber).toBe("102");
    // A raw insert past the service still cannot double-book: the database refuses it.
    const [n] = await c.db.select().from(roomNights).where(and(eq(roomNights.reservationId, a.id), eq(roomNights.stayDate, "2026-11-25")));
    await expect(c.db.insert(roomNights).values({ ...n!, id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", reservationId: b.id, reservationRoomId: bRoom.id })).rejects.toThrow();
  });

  it("check-in needs the arrival date, assigned and clean rooms; check-out frees the room and marks it dirty", async () => {
    const r = await createReservation(c.db, fd(), { source: "WALK_IN", status: "NOT_CONFIRMED", checkIn: "2026-11-24", checkOut: "2026-11-27", guest: guest("Eva"), rooms: [{ roomTypeId: p.fam.id, ratePlanId: p.bar.id, adults: 2 }] });
    await expect(transition(c.db, fd(), r.id, "CHECKED_IN")).rejects.toThrow(/cannot become Checked in/);
    await transition(c.db, fd(), r.id, "CONFIRMED");
    await expect(transition(c.db, fd(), r.id, "CHECKED_IN")).rejects.toThrow(/Assign a room/);
    const rr = (await getReservation(c.db, fd(), r.id)).rooms[0]!.rr;
    await assignRoom(c.db, fd(), rr.id, p.famRooms[0]!.id);
    await c.db.update(rooms).set({ condition: "DIRTY" }).where(eq(rooms.id, p.famRooms[0]!.id));
    await expect(transition(c.db, fd(), r.id, "CHECKED_IN")).rejects.toThrow(/not clean/);
    await c.db.update(rooms).set({ condition: "CLEAN" }).where(eq(rooms.id, p.famRooms[0]!.id));
    await transition(c.db, fd(), r.id, "CHECKED_IN");
    await expect(transition(c.db, fd(), r.id, "CANCELLED", { reason: "x" })).rejects.toBeInstanceOf(ValidationError);
    await expect(assignRoom(c.db, fd(), rr.id, null)).rejects.toThrow(/must keep a room/);
    // Early departure on the business date: nights from today are released, the room is dirty.
    await c.db.update(properties).set({ businessDate: "2026-11-25" }).where(eq(properties.id, p.prop.id));
    expect(await sold(c.db, p.fam.id, "2026-11-25")).toBe(1);
    const out = await transition(c.db, fd(), r.id, "CHECKED_OUT");
    expect(out.checkOut).toBe("2026-11-25");
    expect(await sold(c.db, p.fam.id, "2026-11-25")).toBe(0);
    expect(await sold(c.db, p.fam.id, "2026-11-24")).toBe(1);
    expect((await c.db.select().from(rooms).where(eq(rooms.id, p.famRooms[0]!.id)))[0]!.condition).toBe("DIRTY");
    // Reopen: Admin only, same business date.
    await expect(transition(c.db, fd(), r.id, "CHECKED_IN")).rejects.toBeInstanceOf(ForbiddenError);
    await transition(c.db, p.ctx.ADMIN, r.id, "CHECKED_IN");
    await transition(c.db, fd(), r.id, "CHECKED_OUT");
    await c.db.update(properties).set({ businessDate: "2026-11-24" }).where(eq(properties.id, p.prop.id));
  });

  it("cancellation applies the policy penalty and gives the rooms back; no-show only from arrival", async () => {
    const far = await createReservation(c.db, fd(), { source: "EMAIL", status: "CONFIRMED", checkIn: "2027-01-10", checkOut: "2027-01-12", guest: guest("Flor"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 2 }] });
    expect((await cancellationPreview(c.db, fd(), far.id)).penaltyCentavos).toBe(0n);
    await expect(transition(c.db, fd(), far.id, "CANCELLED")).rejects.toThrow(/reason/);
    const cancelled = await transition(c.db, fd(), far.id, "CANCELLED", { reason: "Change of plans" });
    expect(cancelled.penaltyCentavos).toBe(0n);
    expect(await sold(c.db, p.dlx.id, "2027-01-10")).toBe(0);
    const nr = await createReservation(c.db, fd(), { source: "EMAIL", status: "CONFIRMED", checkIn: "2027-01-10", checkOut: "2027-01-12", guest: guest("Gil"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.nr.id, adults: 2 }] });
    // Non-refundable: 2 x (3,200 less 10%) = 5,760.00, charged even far ahead.
    expect((await transition(c.db, fd(), nr.id, "CANCELLED", { reason: "Changed mind" })).penaltyCentavos).toBe(576000n);
    const late = await createReservation(c.db, fd(), { source: "EMAIL", status: "CONFIRMED", checkIn: "2026-11-25", checkOut: "2026-11-26", guest: guest("Hugo"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 }] });
    await expect(transition(c.db, fd(), late.id, "NO_SHOW")).rejects.toThrow(/from the arrival date/);
    await c.db.update(properties).set({ businessDate: "2026-11-25" }).where(eq(properties.id, p.prop.id));
    expect((await transition(c.db, fd(), late.id, "NO_SHOW")).penaltyCentavos).toBe(320000n);
    await c.db.update(properties).set({ businessDate: "2026-11-24" }).where(eq(properties.id, p.prop.id));
    await expect(transition(c.db, fd(), late.id, "CONFIRMED")).rejects.toBeInstanceOf(ValidationError);
  });

  it("changing dates re-prices and re-checks availability, keeping the room when free", async () => {
    await setDay(c.db, p.ctx.ADMIN, { ratePlanId: p.bar.id, roomTypeId: p.dlx.id, date: "2027-02-06", patch: { rateCentavos: 400000n } });
    const r = await createReservation(c.db, fd(), { source: "PHONE", status: "CONFIRMED", checkIn: "2027-02-04", checkOut: "2027-02-06", guest: guest("Ivy"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 2, roomId: p.dlxRooms[1]!.id }] });
    const moved = await changeDates(c.db, fd(), r.id, { checkIn: "2027-02-05", checkOut: "2027-02-07" });
    expect(moved.reservation.totalCentavos).toBe(720000n);
    expect(moved.unassigned).toEqual([]);
    expect(await sold(c.db, p.dlx.id, "2027-02-04")).toBe(0);
    expect(await sold(c.db, p.dlx.id, "2027-02-06")).toBe(1);
    expect((await getReservation(c.db, fd(), r.id)).rooms[0]!.roomNumber).toBe("102");
    const fam = await createReservation(c.db, fd(), { source: "PHONE", status: "CONFIRMED", checkIn: "2027-02-05", checkOut: "2027-02-06", guest: guest("Jon"), rooms: [{ roomTypeId: p.fam.id, ratePlanId: p.bar.id, adults: 2 }] });
    const other2 = await createReservation(c.db, fd(), { source: "PHONE", status: "CONFIRMED", checkIn: "2027-02-08", checkOut: "2027-02-09", guest: guest("Kim"), rooms: [{ roomTypeId: p.fam.id, ratePlanId: p.bar.id, adults: 2 }] });
    await expect(changeDates(c.db, fd(), fam.id, { checkIn: "2027-02-05", checkOut: "2027-02-09" })).rejects.toBeInstanceOf(NoAvailabilityError);
    expect(await sold(c.db, p.fam.id, "2027-02-05")).toBe(1);
    await transition(c.db, fd(), other2.id, "CANCELLED", { reason: "x" });
  });

  it("changes, adds and removes booked rooms with re-pricing", async () => {
    const r = await createReservation(c.db, fd(), { source: "PHONE", status: "CONFIRMED", checkIn: "2027-03-01", checkOut: "2027-03-03", guest: guest("Lia"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 2 }] });
    const rr = (await getReservation(c.db, fd(), r.id)).rooms[0]!.rr;
    await changeBookedRoom(c.db, fd(), rr.id, { roomTypeId: p.fam.id, ratePlanId: p.nr.id, adults: 3 });
    expect(await sold(c.db, p.dlx.id, "2027-03-01")).toBe(0);
    expect(await sold(c.db, p.fam.id, "2027-03-01")).toBe(1);
    let full = await getReservation(c.db, fd(), r.id);
    expect(full.reservation.totalCentavos).toBe(990000n); // 2 x 5,500 less 10%
    const added = await addBookedRoom(c.db, fd(), r.id, { roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 });
    full = await getReservation(c.db, fd(), r.id);
    expect(full.reservation.totalCentavos).toBe(1630000n);
    expect(full.reservation.adults).toBe(4);
    await removeBookedRoom(c.db, fd(), added.id);
    await expect(removeBookedRoom(c.db, fd(), rr.id)).rejects.toThrow(/at least one room/);
    expect((await getReservation(c.db, fd(), r.id)).reservation.totalCentavos).toBe(990000n);
  });

  it("inquiries hold nothing until they become bookings", async () => {
    const q = await createReservation(c.db, fd(), { source: "EMAIL", status: "INQUIRY", checkIn: "2027-04-01", checkOut: "2027-04-02", guest: guest("Mia"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 2 }] });
    expect(await sold(c.db, p.dlx.id, "2027-04-01")).toBe(0);
    await transition(c.db, fd(), q.id, "NOT_CONFIRMED");
    expect(await sold(c.db, p.dlx.id, "2027-04-01")).toBe(1);
    const rr = (await getReservation(c.db, fd(), q.id)).rooms[0]!.rr;
    expect(rr.active).toBe(true);
  });

  it("notes, activity, list and search stay inside the tenant", async () => {
    const { rows } = await listReservations(c.db, fd(), { q: "ana" });
    expect(rows).toHaveLength(1);
    const id = rows[0]!.r.id;
    await addNote(c.db, fd(), id, "Late arrival, around 10 PM");
    const act = await activityLog(c.db, fd(), id);
    expect(act.map((a) => a.action)).toContain("reservation_note.create");
    expect((await listReservations(c.db, fd(), { q: "+639171234567" })).rows.length).toBeGreaterThan(1);
    expect((await listReservations(c.db, fd(), { status: ["CANCELLED"] })).rows.every((x) => x.r.status === "CANCELLED")).toBe(true);
    expect((await listReservations(c.db, other.ctx.FRONT_DESK, { q: "ana" })).rows).toHaveLength(0);
    await expect(getReservation(c.db, other.ctx.FRONT_DESK, id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(addNote(c.db, other.ctx.FRONT_DESK, id, "x")).rejects.toBeInstanceOf(NotFoundError);
    await expect(transition(c.db, other.ctx.ADMIN, id, "CANCELLED", { reason: "x" })).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("dashboard (integration, Postgres)", () => {
  it("counts arrivals, in-house, departures and new bookings for the business date", async () => {
    const c = await freshTestDb();
    const p = await makeBookableProperty(c.db);
    const { dashboard } = await import("../dashboard");
    const g = (n: string) => ({ firstName: n, lastName: "Test" });
    const a = await createReservation(c.db, p.ctx.FRONT_DESK, { source: "PHONE", status: "CONFIRMED", checkIn: "2026-11-24", checkOut: "2026-11-26", guest: g("A"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1, roomId: p.dlxRooms[0]!.id }] });
    await createReservation(c.db, p.ctx.FRONT_DESK, { source: "PHONE", status: "NOT_CONFIRMED", checkIn: "2026-11-24", checkOut: "2026-11-25", guest: g("B"), rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1 }] });
    await createReservation(c.db, p.ctx.FRONT_DESK, { source: "PHONE", status: "CONFIRMED", checkIn: "2026-11-30", checkOut: "2026-12-01", guest: g("C"), rooms: [{ roomTypeId: p.fam.id, ratePlanId: p.bar.id, adults: 1 }] });
    await transition(c.db, p.ctx.FRONT_DESK, a.id, "CHECKED_IN");
    const d = await dashboard(c.db, p.ctx.FRONT_DESK);
    expect([d.lists.arrivals.length, d.lists.inhouse.length, d.lists.departures.length, d.lists.new.length, d.lists.cancellations.length]).toEqual([2, 1, 0, 3, 0]);
    // 4 sellable rooms (3 DLX, 1 FAM), 2 sold tonight: 50%.
    expect([d.today.sold, d.today.sellable, d.today.occupancy]).toEqual([2, 4, 50]);
    expect(d.forecast).toHaveLength(14);
    expect(d.forecast[6]!.arrivals).toBe(1);
    await c.pool.end();
  });
});
