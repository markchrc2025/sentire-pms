import { and, eq } from "drizzle-orm";
import { z } from "zod";
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

const opt = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));

/** Property settings (FR-01). The business date is not here: it changes only through night audit. */
export const propertyDetailsInput = z
  .object({
    name: z.string().trim().min(2, "Enter the property name.").max(120),
    registeredName: opt(200),
    tin: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^\d{3}-\d{3}-\d{3}(-\d{3,5})?$/.test(v), "TIN format: 000-000-000-00000."),
    branchCode: z
      .string()
      .trim()
      .optional()
      .nullable()
      .transform((v) => (v ? v : null))
      .refine((v) => v === null || /^\d{3,5}$/.test(v), "Branch code: 3 to 5 digits."),
    address: opt(500),
    timezone: z.string().trim().default("Asia/Manila").refine((tz) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone."),
    checkInTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM.").default("14:00"),
    checkOutTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/, "Use HH:MM.").default("12:00"),
  })
  .partial()
  .strict();

export type PropertyDetailsInput = z.input<typeof propertyDetailsInput>;

/** Update property details. Writes the audit log and the sync outbox in the same transaction. */
export async function updatePropertyDetails(db: Db, ctx: TenantContext, raw: PropertyDetailsInput) {
  authorize(ctx, "property.manage");
  const input = propertyDetailsInput.parse(raw);
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
