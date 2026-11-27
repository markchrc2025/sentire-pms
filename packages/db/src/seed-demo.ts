import { count } from "drizzle-orm";
import type { Db } from "./index";
import { organizations, properties, propertyRoles, users } from "./schema";

export const DEMO_PROPERTY_SLUG = "bahay-kubo-marikina";

/**
 * Demo data for development and staging only (PMS_SEED_DEMO=1). Does nothing if any property
 * exists, so it never touches real data.
 */
export async function seedDemo(db: Db): Promise<boolean> {
  const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(properties);
  if (n > 0) return false;
  await db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: "Demo Hospitality Group" }).returning();
    const [prop] = await tx
      .insert(properties)
      .values({
        organizationId: org!.id,
        slug: DEMO_PROPERTY_SLUG,
        name: "Bahay Kubo Suites, Marikina",
        registeredName: "[DEMO] Bahay Kubo Hospitality Inc.",
        address: "Marikina City, Metro Manila",
        businessDate: "2026-11-24",
      })
      .returning();
    const [owner] = await tx.insert(users).values({ organizationId: org!.id, email: "owner@demo.example", name: "Demo Owner" }).returning();
    await tx.insert(propertyRoles).values({ organizationId: org!.id, propertyId: prop!.id, userId: owner!.id, role: "OWNER" });
  });
  return true;
}
