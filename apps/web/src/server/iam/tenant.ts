import { and, eq } from "drizzle-orm";
import type { Db } from "@sentire-pms/db";
import { properties, propertyRoles, users } from "@sentire-pms/db/schema";
import { ForbiddenError, NotFoundError } from "./errors";
import { roleAllows, type Permission, type Role } from "./permissions";

/**
 * Who is acting, for which organization and property, with which role. Every service and
 * repository function takes this, and every query filters by organizationId and propertyId.
 */
export interface TenantContext {
  readonly userId: string;
  readonly organizationId: string;
  readonly propertyId: string;
  readonly propertySlug: string;
  readonly role: Role;
}

/**
 * Resolve the tenant for a signed-in user and the property in the URL. Fails closed: an unknown
 * property and a property the user has no role at both answer "not found", so property slugs of
 * other hotels are not revealed.
 */
export async function resolveTenant(db: Db, input: { userId: string; propertySlug: string }): Promise<TenantContext> {
  const rows = await db
    .select({
      userId: users.id,
      userActive: users.active,
      organizationId: properties.organizationId,
      propertyId: properties.id,
      propertySlug: properties.slug,
      propertyActive: properties.active,
      role: propertyRoles.role,
    })
    .from(propertyRoles)
    .innerJoin(users, eq(users.id, propertyRoles.userId))
    .innerJoin(properties, eq(properties.id, propertyRoles.propertyId))
    .where(and(eq(propertyRoles.userId, input.userId), eq(properties.slug, input.propertySlug)))
    .limit(1);
  const r = rows[0];
  if (!r || !r.propertyActive) throw new NotFoundError("Property not found.");
  if (!r.userActive) throw new ForbiddenError("This user account is deactivated.");
  return { userId: r.userId, organizationId: r.organizationId, propertyId: r.propertyId, propertySlug: r.propertySlug, role: r.role };
}

/** Throws ForbiddenError unless the context's role grants the permission. */
export function authorize(ctx: TenantContext, permission: Permission): void {
  if (!roleAllows(ctx.role, permission)) throw new ForbiddenError();
}

export function can(ctx: TenantContext, permission: Permission): boolean {
  return roleAllows(ctx.role, permission);
}
