import { and, eq } from "drizzle-orm";
import type { Db } from "@sentire-pms/db";
import { properties } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "../iam/tenant";
import { NotFoundError } from "../iam/errors";
import { recordChange } from "../data/write";

/** The current property, always scoped to the tenant. */
export async function getProperty(db: Db, ctx: TenantContext) {
  authorize(ctx, "property.view");
  const [row] = await db
    .select()
    .from(properties)
    .where(and(eq(properties.id, ctx.propertyId), eq(properties.organizationId, ctx.organizationId)))
    .limit(1);
  if (!row) throw new NotFoundError("Property not found.");
  return row;
}

export interface PropertyDetailsInput {
  name?: string;
  registeredName?: string | null;
  tin?: string | null;
  branchCode?: string | null;
  address?: string | null;
}

/** Update property details. Writes the audit log and the sync outbox in the same transaction. */
export async function updatePropertyDetails(db: Db, ctx: TenantContext, input: PropertyDetailsInput) {
  authorize(ctx, "property.manage");
  return db.transaction(async (tx) => {
    const [before] = await tx
      .select()
      .from(properties)
      .where(and(eq(properties.id, ctx.propertyId), eq(properties.organizationId, ctx.organizationId)))
      .for("update");
    if (!before) throw new NotFoundError("Property not found.");
    const [after] = await tx
      .update(properties)
      .set(input)
      .where(and(eq(properties.id, ctx.propertyId), eq(properties.organizationId, ctx.organizationId)))
      .returning();
    await recordChange(tx, ctx, { entity: "property", entityId: ctx.propertyId, op: "update", action: "property.update", before, after });
    return after!;
  });
}
