import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { guests, properties, rooms } from "@sentire-pms/db/schema";
import { makeBookableProperty } from "@/test/fixtures";
import { ForbiddenError, NotFoundError, ValidationError } from "../iam/errors";
import { createReservation, getReservation } from "../reservations";
import { createBlock } from "../inventory/rooms";
import { assignHousekeeper, attachIdImage, checkIn, checkOut, discountsFor, housekeepingBoard, registrationCard, setRoomCondition } from "./index";
import { readFile } from "../files";

describe.skipIf(!TEST_DATABASE_URL)("front desk and housekeeping (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  let p: Awaited<ReturnType<typeof makeBookableProperty>>;
  let q: Awaited<ReturnType<typeof makeBookableProperty>>;
  const guestBase = { firstName: "Lola", lastName: "Basyang", mobile: "09171234000", nationality: "PH" };
  beforeAll(async () => {
    c = await freshTestDb();
    p = await makeBookableProperty(c.db);
    q = await makeBookableProperty(c.db);
  });
  afterAll(async () => {
    await c?.pool.end();
  });

  it("checks in with guest details, ID and a senior citizen claim in one transaction", async () => {
    const r = await createReservation(c.db, p.ctx.FRONT_DESK, { source: "WALK_IN", status: "CONFIRMED", checkIn: "2026-11-24", checkOut: "2026-11-26", guest: guestBase, rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 2, roomId: p.dlxRooms[0]!.id }] });
    const rr = (await getReservation(c.db, p.ctx.FRONT_DESK, r.id)).rooms[0]!.rr;
    // A bad discount line rolls back everything, including the guest update.
    await expect(checkIn(c.db, p.ctx.FRONT_DESK, r.id, { guest: { ...guestBase, idType: "Passport", idNumber: "P1234567" }, discounts: [{ reservationRoomId: rr.id, type: "SENIOR_CITIZEN", holderName: "Lola Basyang", idNumber: "" }] })).rejects.toThrow();
    expect((await c.db.select().from(guests).where(eq(guests.id, r.mainGuestId)))[0]!.idNumber).toBeNull();
    const after = await checkIn(c.db, p.ctx.FRONT_DESK, r.id, { guest: { ...guestBase, address: "Marikina", idType: "Senior citizen ID", idNumber: "SC-0001" }, discounts: [{ reservationRoomId: rr.id, type: "SENIOR_CITIZEN", holderName: "Lola Basyang", idNumber: "MKN-SC-12345" }] });
    expect(after.status).toBe("CHECKED_IN");
    expect((await c.db.select().from(guests).where(eq(guests.id, r.mainGuestId)))[0]!.idNumber).toBe("SC-0001");
    const ds = await discountsFor(c.db, p.ctx.FRONT_DESK, r.id);
    expect(ds.map((x) => [x.d.type, x.d.idNumber])).toEqual([["SENIOR_CITIZEN", "MKN-SC-12345"]]);
    const card = await registrationCard(c.db, p.ctx.FRONT_DESK, r.id);
    expect(card.discounts).toHaveLength(1);
    expect(card.guest.address).toBe("Marikina");
  });

  it("stores the ID image on the hub, readable only inside the property", async () => {
    const [g] = await c.db.select().from(guests).where(eq(guests.firstName, "Lola"));
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3])], "id.jpg", { type: "image/jpeg" });
    const f = await attachIdImage(c.db, p.ctx.FRONT_DESK, g!.id, file);
    expect((await readFile(c.db, p.ctx.FRONT_DESK, f.id)).sizeBytes).toBe(6);
    await expect(readFile(c.db, q.ctx.ADMIN, f.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(readFile(c.db, p.ctx.HOUSEKEEPING, f.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(attachIdImage(c.db, p.ctx.FRONT_DESK, g!.id, new File(["x"], "a.exe", { type: "application/x-msdownload" }))).rejects.toBeInstanceOf(ValidationError);
  });

  it("only an Admin may check a guest into a dirty room", async () => {
    const r = await createReservation(c.db, p.ctx.FRONT_DESK, { source: "WALK_IN", status: "CONFIRMED", checkIn: "2026-11-24", checkOut: "2026-11-25", guest: { firstName: "Dirty", lastName: "Room" }, rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1, roomId: p.dlxRooms[1]!.id }] });
    await setRoomCondition(c.db, p.ctx.HOUSEKEEPING, p.dlxRooms[1]!.id, "DIRTY");
    const g = { firstName: "Dirty", lastName: "Room" };
    await expect(checkIn(c.db, p.ctx.FRONT_DESK, r.id, { guest: g })).rejects.toThrow(/not clean/);
    await expect(checkIn(c.db, p.ctx.FRONT_DESK, r.id, { guest: g, allowDirtyRooms: true })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await checkIn(c.db, p.ctx.ADMIN, r.id, { guest: g, allowDirtyRooms: true })).status).toBe("CHECKED_IN");
  });

  it("housekeeping board shows condition and front desk status; check-out makes the room dirty", async () => {
    let board = await housekeepingBoard(c.db, p.ctx.HOUSEKEEPING);
    const by = (n: string) => board.rooms.find((r) => r.number === n)!;
    expect([by("101").status, by("102").status, by("103").status]).toEqual(["OCCUPIED", "OCCUPIED", "VACANT"]);
    await createBlock(c.db, p.ctx.ADMIN, { roomId: p.dlxRooms[2]!.id, startDate: "2026-11-24", endDate: "2026-11-25", type: "OUT_OF_SERVICE", reason: "Paint" });
    // Next business day: 101 is a stayover, 102 departs.
    await c.db.update(properties).set({ businessDate: "2026-11-25" }).where(eq(properties.id, p.prop.id));
    board = await housekeepingBoard(c.db, p.ctx.HOUSEKEEPING);
    expect([by("101").status, by("102").status, by("103").status]).toEqual(["STAYOVER", "DEPARTURE", "VACANT"]);
    const dep = (await createReservation(c.db, p.ctx.FRONT_DESK, { source: "WALK_IN", status: "CONFIRMED", checkIn: "2026-11-25", checkOut: "2026-11-26", guest: { firstName: "Next", lastName: "Guest" }, rooms: [{ roomTypeId: p.dlx.id, ratePlanId: p.bar.id, adults: 1, roomId: p.dlxRooms[1]!.id }] })).id;
    board = await housekeepingBoard(c.db, p.ctx.HOUSEKEEPING);
    expect(by("102").status).toBe("TURNOVER");
    const checkedIn = board.rooms.find((r) => r.number === "102");
    expect(checkedIn).toBeTruthy();
    const resId = (await c.db.execute(`select reservation_id from room_nights where room_id = '${p.dlxRooms[1]!.id}' and stay_date = '2026-11-24' and active`)).rows[0] as { reservation_id: string };
    await checkOut(c.db, p.ctx.FRONT_DESK, resId.reservation_id);
    expect((await c.db.select().from(rooms).where(eq(rooms.id, p.dlxRooms[1]!.id)))[0]!.condition).toBe("DIRTY");
    expect(dep).toBeTruthy();
  });

  it("condition rules and housekeeper assignment", async () => {
    const id = p.dlxRooms[1]!.id;
    await expect(setRoomCondition(c.db, p.ctx.HOUSEKEEPING, id, "INSPECTED")).rejects.toThrow(/cleaned before/);
    await setRoomCondition(c.db, p.ctx.HOUSEKEEPING, id, "CLEAN");
    await setRoomCondition(c.db, p.ctx.HOUSEKEEPING, id, "INSPECTED");
    await expect(setRoomCondition(c.db, p.ctx.ACCOUNTANT, id, "DIRTY")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setRoomCondition(c.db, q.ctx.ADMIN, id, "DIRTY")).rejects.toBeInstanceOf(NotFoundError);
    await assignHousekeeper(c.db, p.ctx.ADMIN, id, p.ctx.HOUSEKEEPING.userId);
    await expect(assignHousekeeper(c.db, p.ctx.HOUSEKEEPING, id, p.ctx.ADMIN.userId)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(assignHousekeeper(c.db, p.ctx.ADMIN, id, q.ctx.HOUSEKEEPING.userId)).rejects.toBeInstanceOf(ValidationError);
    const board = await housekeepingBoard(c.db, p.ctx.ADMIN);
    expect(board.rooms.find((r) => r.id === id)!.housekeeperName).toBe(`HOUSEKEEPING ${p.prop.slug}`);
  });
});
