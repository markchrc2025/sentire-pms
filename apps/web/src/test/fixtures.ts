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

/** A property with rooms, two policies and three rate plans, ready for booking tests. */
export async function makeBookableProperty(db: Db, opts: { businessDate?: string } = {}) {
  const p = await makeProperty(db, opts);
  const { createRoomRange, createRoomType } = await import("../server/inventory/rooms");
  const { createPolicy } = await import("../server/rates/policies");
  const { createRatePlan } = await import("../server/rates/plans");
  const a = p.ctx.ADMIN;
  const dlx = await createRoomType(db, a, { code: "DLX", name: "Deluxe", kind: "PRIVATE", maxGuests: 2, baseRate: "3200" });
  const fam = await createRoomType(db, a, { code: "FAM", name: "Family", kind: "PRIVATE", maxGuests: 4, baseRate: "5500" });
  const dlxRooms = await createRoomRange(db, a, { roomTypeId: dlx.id, from: 101, to: 103 });
  const famRooms = await createRoomRange(db, a, { roomTypeId: fam.id, from: 301, to: 301 });
  const flex = await createPolicy(db, a, { name: "Flexible", guarantee: "FIRST_NIGHT", refundable: "on", freeCancelHours: 48, lateCancelPenalty: "FIRST_NIGHT", noShowPenalty: "FIRST_NIGHT" });
  const nrPol = await createPolicy(db, a, { name: "Non-refundable", guarantee: "FULL_STAY", lateCancelPenalty: "FULL_STAY", noShowPenalty: "FULL_STAY" });
  const bar = await createRatePlan(db, a, { code: "BAR", name: "Best available", type: "STANDARD", policyId: flex.id, sellOnline: "on" });
  const nr = await createRatePlan(db, a, { code: "NR", name: "Non-refundable", type: "DERIVED", parentId: bar.id, adjustValue: "-10", policyId: nrPol.id });
  return { ...p, dlx, fam, dlxRooms, famRooms, bar, nr, flex, nrPol };
}
