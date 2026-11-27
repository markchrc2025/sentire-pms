import { and, count, eq } from "drizzle-orm";
import type { Db } from "./index";
import { organizations, properties, propertyRoles, users } from "./schema";
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
  for (const step of extraSteps) await step(db, { organizationId: prop.organizationId, propertyId: prop.id });
  return created;
}
