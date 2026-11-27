import { and, count, eq } from "drizzle-orm";
import { DEMO_USERS, registerDemoStep, type Db } from "@sentire-pms/db";
import { properties, ratePlans, reservations, rooms, roomTypes, users } from "@sentire-pms/db/schema";
import { resolveTenant } from "./iam/tenant";
import { createReservation, transition } from "./reservations";

/**
 * Phase 4 demo stays around the demo business date (24 Nov 2026): guests in house, a departure
 * and arrivals today, future bookings, a cancellation and an inquiry. Made through the real
 * services (inventory, pricing, state machine), by moving the business date back while booking.
 */
async function seedStays(db: Db, s: { organizationId: string; propertyId: string }) {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(reservations).where(eq(reservations.propertyId, s.propertyId));
  if (n > 0) return;
  const [prop] = await db.select().from(properties).where(eq(properties.id, s.propertyId)).limit(1);
  const [owner] = await db.select().from(users).where(eq(users.email, DEMO_USERS[0].email)).limit(1);
  if (!prop || !owner || prop.businessDate !== "2026-11-24") return;
  const ctx = await resolveTenant(db, { userId: owner.id, propertySlug: prop.slug });
  const plan = async (code: string) => (await db.select().from(ratePlans).where(and(eq(ratePlans.propertyId, s.propertyId), eq(ratePlans.code, code))).limit(1))[0]?.id;
  const type = async (code: string) => (await db.select().from(roomTypes).where(and(eq(roomTypes.propertyId, s.propertyId), eq(roomTypes.code, code))).limit(1))[0]?.id;
  const room = async (num: string) => (await db.select().from(rooms).where(and(eq(rooms.propertyId, s.propertyId), eq(rooms.number, num))).limit(1))[0]!.id;
  const [BAR, NR, BB, DLX, TWN, FAM, DRM] = await Promise.all([plan("BAR"), plan("NR"), plan("BB"), type("DLX"), type("TWN"), type("FAM"), type("DRM")]);
  if (!BAR || !NR || !BB || !DLX || !TWN || !FAM || !DRM) return;
  const setBd = (d: string) => db.update(properties).set({ businessDate: d }).where(eq(properties.id, s.propertyId));
  const g = (first: string, last: string, mobile: string) => ({ firstName: first, lastName: last, email: `${first.toLowerCase()}.${last.toLowerCase().replace(/\s+/g, "")}@demo-guest.example`, mobile, nationality: "PH" });
  const book = async (checkIn: string, checkOut: string, guest: ReturnType<typeof g>, lines: { t: string; p: string; adults: number; room?: string }[], status: "CONFIRMED" | "NOT_CONFIRMED" | "INQUIRY" = "CONFIRMED", source: "PHONE" | "WALK_IN" | "EMAIL" | "OTA_AGODA" | "OTA_BOOKING" = "PHONE") =>
    createReservation(db, ctx, { source, status, checkIn, checkOut, guest, notes: "[DEMO]", rooms: await Promise.all(lines.map(async (l) => ({ roomTypeId: l.t, ratePlanId: l.p, adults: l.adults, children: 0, roomId: l.room ? await room(l.room) : null }))) });
  try {
    await setBd("2026-11-21");
    const a = await book("2026-11-21", "2026-11-26", g("Maria", "Reyes", "09171110001"), [{ t: DLX, p: BAR, adults: 2, room: "101" }], "CONFIRMED", "OTA_AGODA");
    await transition(db, ctx, a.id, "CHECKED_IN");
    await setBd("2026-11-22");
    const b = await book("2026-11-22", "2026-11-24", g("Jose", "Garcia", "09171110002"), [{ t: TWN, p: BB, adults: 2, room: "201" }], "CONFIRMED", "WALK_IN");
    await transition(db, ctx, b.id, "CHECKED_IN");
    const c2 = await book("2026-11-22", "2026-11-27", g("Liza", "Tan", "09171110003"), [{ t: FAM, p: BAR, adults: 4, room: "301" }, { t: DRM, p: BAR, adults: 1, room: "D1" }], "CONFIRMED", "EMAIL");
    await transition(db, ctx, c2.id, "CHECKED_IN");
    await setBd("2026-11-24");
    await book("2026-11-24", "2026-11-26", g("Paolo", "Cruz", "09171110004"), [{ t: DLX, p: BAR, adults: 2, room: "102" }]);
    await book("2026-11-24", "2026-11-25", g("Andrea", "Lim", "09171110005"), [{ t: TWN, p: NR, adults: 1 }], "CONFIRMED", "OTA_BOOKING");
    await book("2026-11-24", "2026-11-27", g("Ramon", "Dela Cruz", "09171110006"), [{ t: DLX, p: BB, adults: 2 }], "NOT_CONFIRMED", "PHONE");
    await book("2026-11-28", "2026-12-01", g("Grace", "Villanueva", "09171110007"), [{ t: FAM, p: BB, adults: 3, room: "302" }]);
    await book("2026-12-05", "2026-12-07", g("Kenji", "Sato", "+81 90 1234 5678"), [{ t: DLX, p: NR, adults: 2 }], "CONFIRMED", "OTA_AGODA");
    const x = await book("2026-12-10", "2026-12-12", g("Bea", "Santos", "09171110009"), [{ t: TWN, p: BAR, adults: 2 }]);
    await transition(db, ctx, x.id, "CANCELLED", { reason: "[DEMO] Guest changed travel dates" });
    await book("2026-12-20", "2026-12-23", g("Carlo", "Mendoza", "09171110010"), [{ t: FAM, p: BAR, adults: 4 }], "INQUIRY", "EMAIL");
  } finally {
    await setBd("2026-11-24");
  }
}

registerDemoStep(seedStays);
