import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { auditLog, inventoryDays, outboxEvents } from "@sentire-pms/db/schema";
import { makeProperty } from "@/test/fixtures";
import { availability, NoAvailabilityError, releaseUnits, takeUnits } from "./engine";
import { createBlock, createRoom, createRoomRange, createRoomType, listRooms, listRoomTypes, releaseBlock, setRoomActive, setRoomTypeActive, updateRoom } from "./rooms";
import { createTaxFee, formatBp, listTaxFees, percentToBp, setTaxFeeActive } from "./taxes";
import { ConflictError, ForbiddenError, ValidationError } from "../iam/errors";
import { ZodError } from "zod";

describe("tax helpers", () => {
  it("converts percentages to basis points and back", () => {
    expect(percentToBp("12")).toBe(1200n);
    expect(percentToBp("2.5")).toBe(250n);
    expect(formatBp(1200n)).toBe("12%");
    expect(formatBp(250n)).toBe("2.5%");
    expect(() => percentToBp("101")).toThrow(ValidationError);
    expect(() => percentToBp("1.234")).toThrow(ValidationError);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("property and inventory (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  let p: Awaited<ReturnType<typeof makeProperty>>;
  let other: Awaited<ReturnType<typeof makeProperty>>;
  let dlx: { id: string };
  beforeAll(async () => {
    c = await freshTestDb();
    p = await makeProperty(c.db);
    other = await makeProperty(c.db);
  });
  afterAll(async () => {
    await c?.pool.end();
  });

  it("creates room types and rooms, building inventory with the right totals", async () => {
    dlx = await createRoomType(c.db, p.ctx.ADMIN, { code: "dlx", name: "Deluxe Queen", kind: "PRIVATE", maxGuests: 2, baseRate: "3,200.00" });
    await createRoomRange(c.db, p.ctx.ADMIN, { roomTypeId: dlx.id, prefix: "", from: 101, to: 103 });
    const a = await availability(c.db, p.ctx.FRONT_DESK, "2026-11-24", "2026-11-27");
    expect(a[0]!.code).toBe("DLX");
    expect(a[0]!.days.map((d) => d.available)).toEqual([3, 3, 3]);
    expect((await listRoomTypes(c.db, p.ctx.ADMIN))[0]!.roomCount).toBe(3);
    const [row] = await c.db.select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, dlx.id), eq(inventoryDays.stayDate, "2026-12-31")));
    expect(row!.totalUnits).toBe(3);
  });

  it("rejects duplicate codes and room numbers and bad input", async () => {
    await expect(createRoomType(c.db, p.ctx.ADMIN, { code: "DLX", name: "Again", kind: "PRIVATE", maxGuests: 2, baseRate: "1" })).rejects.toBeInstanceOf(ConflictError);
    await expect(createRoom(c.db, p.ctx.ADMIN, { roomTypeId: dlx.id, number: "101" })).rejects.toBeInstanceOf(ConflictError);
    await expect(createRoomType(c.db, p.ctx.ADMIN, { code: "X", name: "Bad rate", kind: "PRIVATE", maxGuests: 2, baseRate: "12.345" })).rejects.toBeInstanceOf(ZodError);
    // The same room number at another property is fine.
    const t = await createRoomType(c.db, other.ctx.ADMIN, { code: "DLX", name: "Deluxe", kind: "PRIVATE", maxGuests: 2, baseRate: "2000" });
    await expect(createRoom(c.db, other.ctx.ADMIN, { roomTypeId: t.id, number: "101" })).resolves.toBeTruthy();
  });

  it("keeps tenants apart and enforces permissions", async () => {
    await expect(createRoomType(c.db, p.ctx.FRONT_DESK, { code: "Z", name: "Nope", kind: "PRIVATE", maxGuests: 2, baseRate: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    // A room cannot be put under another property's room type.
    await expect(createRoom(c.db, other.ctx.ADMIN, { roomTypeId: dlx.id, number: "999" })).rejects.toBeInstanceOf(ValidationError);
    expect((await listRooms(c.db, other.ctx.ADMIN)).map((r) => r.room.number)).toEqual(["101"]);
    const rooms = await listRooms(c.db, p.ctx.HOUSEKEEPING);
    await expect(updateRoom(c.db, other.ctx.ADMIN, rooms[0]!.room.id, { roomTypeId: dlx.id, number: "x" })).rejects.toThrow();
  });

  it("blocks remove a room from sale and release puts it back; overlapping blocks are refused", async () => {
    const [r101] = (await listRooms(c.db, p.ctx.ADMIN)).filter((r) => r.room.number === "101");
    const b = await createBlock(c.db, p.ctx.ADMIN, { roomId: r101!.room.id, startDate: "2026-11-25", endDate: "2026-11-27", type: "OUT_OF_SERVICE", reason: "Aircon repair" });
    let a = await availability(c.db, p.ctx.ADMIN, "2026-11-24", "2026-11-28");
    expect(a[0]!.days.map((d) => d.available)).toEqual([3, 2, 2, 3]);
    await expect(createBlock(c.db, p.ctx.ADMIN, { roomId: r101!.room.id, startDate: "2026-11-26", endDate: "2026-11-28", type: "OWNER_STAY", reason: "Owner" })).rejects.toBeInstanceOf(ConflictError);
    await expect(createBlock(c.db, p.ctx.ADMIN, { roomId: r101!.room.id, startDate: "2026-11-26", endDate: "2026-11-26", type: "OWNER_STAY", reason: "Owner" })).rejects.toBeInstanceOf(ZodError);
    await releaseBlock(c.db, p.ctx.ADMIN, b.id);
    a = await availability(c.db, p.ctx.ADMIN, "2026-11-24", "2026-11-28");
    expect(a[0]!.days.map((d) => d.available)).toEqual([3, 3, 3, 3]);
  });

  it("refuses to block or switch off rooms that are already sold", async () => {
    await c.db.transaction((tx) => takeUnits(tx, p.ctx.ADMIN, dlx.id, "2026-12-10", "2026-12-12", { units: 3 }));
    const rooms = await listRooms(c.db, p.ctx.ADMIN);
    await expect(createBlock(c.db, p.ctx.ADMIN, { roomId: rooms[0]!.room.id, startDate: "2026-12-11", endDate: "2026-12-12", type: "OUT_OF_SERVICE", reason: "Paint" })).rejects.toBeInstanceOf(ConflictError);
    await expect(setRoomActive(c.db, p.ctx.ADMIN, rooms[0]!.room.id, false)).rejects.toBeInstanceOf(ConflictError);
    await expect(setRoomTypeActive(c.db, p.ctx.ADMIN, dlx.id, false)).rejects.toBeInstanceOf(ConflictError);
    await c.db.transaction((tx) => releaseUnits(tx, p.ctx.ADMIN, dlx.id, "2026-12-10", "2026-12-12", 3));
    await expect(setRoomActive(c.db, p.ctx.ADMIN, rooms[0]!.room.id, false)).resolves.toBeTruthy();
    await setRoomActive(c.db, p.ctx.ADMIN, rooms[0]!.room.id, true);
  });

  it("never sells below zero unless overbooking is allowed", async () => {
    await c.db.transaction((tx) => takeUnits(tx, p.ctx.ADMIN, dlx.id, "2027-01-05", "2027-01-06", { units: 3 }));
    await expect(c.db.transaction((tx) => takeUnits(tx, p.ctx.ADMIN, dlx.id, "2027-01-05", "2027-01-06"))).rejects.toBeInstanceOf(NoAvailabilityError);
    await c.db.transaction((tx) => takeUnits(tx, p.ctx.ADMIN, dlx.id, "2027-01-05", "2027-01-06", { allowOverbook: true }));
    const [r] = await c.db.select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, dlx.id), eq(inventoryDays.stayDate, "2027-01-05")));
    expect([r!.soldUnits, r!.overbookedUnits]).toEqual([4, 1]);
    const a = await availability(c.db, p.ctx.ADMIN, "2027-01-05", "2027-01-06");
    expect(a[0]!.days[0]!.available).toBe(-1);
  });

  it("P1.6: 20 parallel bookings for the last unit, exactly one succeeds", async () => {
    // Leave exactly one unit on 2027-02-01.
    await c.db.transaction((tx) => takeUnits(tx, p.ctx.ADMIN, dlx.id, "2027-02-01", "2027-02-02", { units: 2 }));
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => c.db.transaction((tx) => takeUnits(tx, p.ctx.FRONT_DESK, dlx.id, "2027-02-01", "2027-02-02"))));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failed = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(failed).toHaveLength(19);
    expect(failed.every((f) => f.reason instanceof NoAvailabilityError)).toBe(true);
    const [r] = await c.db.select().from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, dlx.id), eq(inventoryDays.stayDate, "2027-02-01")));
    expect(r!.soldUnits).toBe(3);
  });

  it("taxes: VAT is built in and cannot be switched off; new fees validate", async () => {
    const list = await listTaxFees(c.db, p.ctx.ACCOUNTANT);
    const vat = list.find((t) => t.code === "VAT")!;
    expect([vat.value, vat.inclusive]).toEqual([1200n, true]);
    await expect(setTaxFeeActive(c.db, p.ctx.ADMIN, vat.id, false)).rejects.toBeInstanceOf(ValidationError);
    await expect(createTaxFee(c.db, p.ctx.FRONT_DESK, { code: "ENV", name: "Environmental fee", kind: "FEE", calc: "FIXED", basis: "PER_GUEST_PER_NIGHT", value: "50", glCode: "4200" })).rejects.toBeInstanceOf(ForbiddenError);
    const env = await createTaxFee(c.db, p.ctx.ADMIN, { code: "ENV", name: "Environmental fee", kind: "FEE", calc: "FIXED", basis: "PER_GUEST_PER_NIGHT", value: "50", glCode: "4200" });
    expect(env.value).toBe(5000n);
    await expect(createTaxFee(c.db, p.ctx.ADMIN, { code: "PROMO", name: "Promo", kind: "DISCOUNT", calc: "PERCENT", basis: "PER_NIGHT", value: "10", inclusive: "on", glCode: "4199" })).rejects.toBeInstanceOf(ValidationError);
  });

  it("every write leaves audit and outbox rows", async () => {
    const audits = await c.db.select().from(auditLog).where(eq(auditLog.action, "room.create"));
    const events = await c.db.select().from(outboxEvents).where(eq(outboxEvents.entity, "room"));
    expect(audits.length).toBeGreaterThanOrEqual(4);
    expect(events.length).toBe(audits.length + (await c.db.select().from(auditLog).where(eq(auditLog.entity, "room"))).length - audits.length);
    const [rt] = await c.db.select().from(auditLog).where(eq(auditLog.action, "room_type.create")).limit(1);
    expect((rt!.after as { baseRateCentavos: string }).baseRateCentavos).toBe("320000");
  });
});
