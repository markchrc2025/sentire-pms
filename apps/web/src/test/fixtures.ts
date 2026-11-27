import { defaultTaxFees, type Db } from "@sentire-pms/db";
import { organizations, properties, propertyRoles, taxFees, users } from "@sentire-pms/db/schema";
import type { Role } from "../server/iam/permissions";
import { resolveTenant, type TenantContext } from "../server/iam/tenant";

let n = 0;

/** A property with one user per role. Returns a context for each role. */
export async function makeProperty(db: Db, opts: { slug?: string; businessDate?: string } = {}) {
  n++;
  const slug = opts.slug ?? `hotel-${n}-${Math.random().toString(36).slice(2, 7)}`;
  const [org] = await db.insert(organizations).values({ name: `Org ${slug}` }).returning();
  const [prop] = await db.insert(properties).values({ organizationId: org!.id, slug, name: `Hotel ${slug}`, businessDate: opts.businessDate ?? "2026-11-24" }).returning();
  await db.insert(taxFees).values(defaultTaxFees(org!.id, prop!.id));
  const roles: Role[] = ["OWNER", "ADMIN", "FRONT_DESK", "HOUSEKEEPING", "ACCOUNTANT"];
  const ctx = {} as Record<Role, TenantContext>;
  for (const role of roles) {
    const [u] = await db.insert(users).values({ organizationId: org!.id, email: `${role.toLowerCase()}@${slug}.example`, name: `${role} ${slug}` }).returning();
    await db.insert(propertyRoles).values({ organizationId: org!.id, propertyId: prop!.id, userId: u!.id, role });
    ctx[role] = await resolveTenant(db, { userId: u!.id, propertySlug: slug });
  }
  return { org: org!, prop: prop!, ctx };
}
