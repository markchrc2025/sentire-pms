import { and, count, eq } from "drizzle-orm";
import type { Db } from "./index";
import { dailyRates, organizations, policies, properties, propertyRoles, ratePlans, roomBlocks, rooms, roomTypes, taxFees, users } from "./schema";
import { defaultTaxFees } from "./defaults";
import { hashPassword } from "./password";

export const DEMO_PROPERTY_SLUG = "bahay-kubo-marikina";

export const DEMO_USERS = [
  { email: "owner@demo.example", name: "Demo Owner", role: "OWNER" },
  { email: "admin@demo.example", name: "Ana Admin", role: "ADMIN" },
  { email: "frontdesk@demo.example", name: "Franco Desk", role: "FRONT_DESK" },
  { email: "housekeeping@demo.example", name: "Helen Keeping", role: "HOUSEKEEPING" },
  { email: "accountant@demo.example", name: "Carlo Accountant", role: "ACCOUNTANT" },
] as const;

type Step = (db: Db, ctx: { organizationId: string; propertyId: string }) => Promise<void>;
const extraSteps: Step[] = [];
/** Later phases register their demo data here (rooms, rates, guests, reservations). Each step must be idempotent. */
export function registerDemoStep(step: Step) {
  extraSteps.push(step);
}

/**
 * Demo data for development and staging only (PMS_SEED_DEMO=1). Creates the demo property only
 * when the database has no properties, so it never touches real data. Demo staff get the password
 * in PMS_DEMO_PASSWORD (a generated secret in Dokploy); without it they cannot sign in.
 */
export async function seedDemo(db: Db, password = process.env.PMS_DEMO_PASSWORD): Promise<boolean> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(properties);
  let created = false;
  if (n === 0) {
    await db.transaction(async (tx) => {
      const [org] = await tx.insert(organizations).values({ name: "Demo Hospitality Group" }).returning();
      await tx.insert(properties).values({
        organizationId: org!.id,
        slug: DEMO_PROPERTY_SLUG,
        name: "Bahay Kubo Suites, Marikina",
        registeredName: "[DEMO] Bahay Kubo Hospitality Inc.",
        tin: "000-123-456-00000",
        address: "Marikina City, Metro Manila",
        businessDate: "2026-11-24",
      });
    });
    created = true;
  }
  const [prop] = await db.select().from(properties).where(eq(properties.slug, DEMO_PROPERTY_SLUG)).limit(1);
  if (!prop) return created;
  const hash = password ? await hashPassword(password) : null;
  for (const du of DEMO_USERS) {
    let [u] = await db.select().from(users).where(eq(users.email, du.email)).limit(1);
    if (!u) [u] = await db.insert(users).values({ organizationId: prop.organizationId, email: du.email, name: du.name, passwordHash: hash }).returning();
    else if (!u.passwordHash && hash) await db.update(users).set({ passwordHash: hash }).where(eq(users.id, u.id));
    const [r] = await db.select().from(propertyRoles).where(and(eq(propertyRoles.userId, u!.id), eq(propertyRoles.propertyId, prop.id))).limit(1);
    if (!r) await db.insert(propertyRoles).values({ organizationId: prop.organizationId, propertyId: prop.id, userId: u!.id, role: du.role });
  }
  await seedPropertySetup(db, prop.organizationId, prop.id);
  await seedRates(db, prop.organizationId, prop.id);
  for (const step of extraSteps) await step(db, { organizationId: prop.organizationId, propertyId: prop.id });
  return created;
}

const DEMO_TYPES = [
  { code: "DLX", name: "Deluxe Queen", kind: "PRIVATE" as const, maxGuests: 2, baseRateCentavos: 320000n, sortOrder: 1, rooms: ["101", "102", "103", "104", "105", "106", "107", "108"] },
  { code: "TWN", name: "Superior Twin", kind: "PRIVATE" as const, maxGuests: 2, baseRateCentavos: 280000n, sortOrder: 2, rooms: ["201", "202", "203", "204", "205", "206"] },
  { code: "FAM", name: "Family Suite", kind: "PRIVATE" as const, maxGuests: 4, baseRateCentavos: 550000n, sortOrder: 3, rooms: ["301", "302", "303"] },
  { code: "DRM", name: "Dorm bed", kind: "DORM_BED" as const, maxGuests: 1, baseRateCentavos: 75000n, sortOrder: 4, rooms: ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8"] },
];

/** Phase 1 demo data: built-in taxes, four room types, 25 rooms and beds, one out-of-service block. */
async function seedPropertySetup(db: Db, organizationId: string, propertyId: string) {
  const [{ t } = { t: 0 }] = await db.select({ t: count() }).from(taxFees).where(eq(taxFees.propertyId, propertyId));
  if (t === 0) await db.insert(taxFees).values(defaultTaxFees(organizationId, propertyId));
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(roomTypes).where(eq(roomTypes.propertyId, propertyId));
  if (n > 0) return;
  await db.transaction(async (tx) => {
    for (const dt of DEMO_TYPES) {
      const { rooms: numbers, ...type } = dt;
      const [rt] = await tx.insert(roomTypes).values({ organizationId, propertyId, ...type }).returning();
      const made = await tx.insert(rooms).values(numbers.map((number, i) => ({ organizationId, propertyId, roomTypeId: rt!.id, number, sortOrder: i }))).returning();
      if (dt.code === "DLX") {
        const r105 = made.find((r) => r.number === "105")!;
        await tx.insert(roomBlocks).values({ organizationId, propertyId, roomId: r105.id, startDate: "2026-11-24", endDate: "2026-11-27", type: "OUT_OF_SERVICE", reason: "[DEMO] Aircon repair" });
      }
    }
  });
}

/** Phase 3 demo data: two policies, three rate plans (BAR, NR at 10% off, BB package) and weekend rates. */
async function seedRates(db: Db, organizationId: string, propertyId: string) {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(ratePlans).where(eq(ratePlans.propertyId, propertyId));
  if (n > 0) return;
  const types = await db.select().from(roomTypes).where(eq(roomTypes.propertyId, propertyId));
  if (!types.length) return;
  await db.transaction(async (tx) => {
    const [flex] = await tx.insert(policies).values({ organizationId, propertyId, name: "Flexible", guarantee: "FIRST_NIGHT", freeCancelHours: 48, lateCancelPenalty: "FIRST_NIGHT", noShowPenalty: "FIRST_NIGHT", holdHours: 24, description: "Free cancellation until 48 hours before arrival. After that, and for no-shows, the first night is charged." }).returning();
    const [nr] = await tx.insert(policies).values({ organizationId, propertyId, name: "Non-refundable", guarantee: "FULL_STAY", freeCancelHours: null, lateCancelPenalty: "FULL_STAY", noShowPenalty: "FULL_STAY", description: "Paid in full when booked. No refund." }).returning();
    const [bar] = await tx.insert(ratePlans).values({ organizationId, propertyId, code: "BAR", name: "Best available rate", type: "STANDARD", policyId: flex!.id, sellOnline: true, sortOrder: 1 }).returning();
    await tx.insert(ratePlans).values({ organizationId, propertyId, code: "NR", name: "Non-refundable, 10% off", type: "DERIVED", parentId: bar!.id, adjustKind: "PERCENT", adjustValue: -1000n, policyId: nr!.id, sellOnline: true, sortOrder: 2 });
    await tx.insert(ratePlans).values({ organizationId, propertyId, code: "BB", name: "Bed and breakfast", type: "PACKAGE", parentId: bar!.id, packageAddCentavos: 60000n, inclusions: "Breakfast for two", policyId: flex!.id, sellOnline: true, sortOrder: 3 });
    // Friday and Saturday nights cost ₱400 more for private rooms for the next 120 days.
    const rows = [];
    for (let i = 0; i < 120; i++) {
      const d = new Date(Date.UTC(2026, 10, 24 + i));
      if (d.getUTCDay() !== 5 && d.getUTCDay() !== 6) continue;
      for (const t of types) if (t.kind === "PRIVATE") rows.push({ organizationId, propertyId, ratePlanId: bar!.id, roomTypeId: t.id, stayDate: d.toISOString().slice(0, 10), rateCentavos: t.baseRateCentavos + 40000n });
    }
    if (rows.length) await tx.insert(dailyRates).values(rows);
  });
}
