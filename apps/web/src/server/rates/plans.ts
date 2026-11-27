import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { parsePeso } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { policies, ratePlans } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "../iam/tenant";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "../iam/errors";
import { recordChange } from "../data/write";
import { percentToBp } from "../inventory/taxes";

export const PLAN_TYPE_LABEL = { STANDARD: "Standard", DERIVED: "Derived", PACKAGE: "Package" } as const;

export const ratePlanInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, "Code: up to 12 letters, numbers or dashes."),
  name: z.string().trim().min(2, "Enter a name.").max(80),
  type: z.enum(["STANDARD", "DERIVED", "PACKAGE"]),
  parentId: z.string().optional().transform((v) => v || null),
  adjustKind: z.enum(["PERCENT", "FIXED"]).default("PERCENT"),
  /** "-10" for 10% cheaper, or "-200" pesos with FIXED. */
  adjustValue: z.string().trim().optional().transform((v) => v || "0"),
  packageAdd: z.string().trim().optional().transform((v) => v || "0"),
  inclusions: z.string().trim().max(500).optional().transform((v) => v || null),
  policyId: z.string().length(26, "Choose a policy."),
  sellOnline: z.union([z.literal("on"), z.literal(""), z.boolean()]).optional().transform((v) => v === "on" || v === true),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

function signedPercentBp(s: string): bigint {
  const neg = s.startsWith("-");
  const bp = percentToBp(s.replace(/^[-+]/, ""));
  return neg ? -bp : bp;
}

async function normalize(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], ctx: TenantContext, d: z.infer<typeof ratePlanInput>, selfId?: string) {
  const [pol] = await tx.select().from(policies).where(and(eq(policies.id, d.policyId), eq(policies.propertyId, ctx.propertyId), eq(policies.active, true))).limit(1);
  if (!pol) throw new ValidationError("Choose an active policy of this property.", "policyId");
  let adjustValue = 0n;
  let packageAddCentavos = 0n;
  if (d.type === "STANDARD") {
    d.parentId = null;
  } else {
    if (!d.parentId) throw new ValidationError("Choose the plan this one follows.", "parentId");
    if (d.parentId === selfId) throw new ValidationError("A plan cannot follow itself.");
    const [parent] = await tx.select().from(ratePlans).where(and(eq(ratePlans.id, d.parentId), eq(ratePlans.propertyId, ctx.propertyId))).limit(1);
    if (!parent) throw new ValidationError("Choose a plan of this property.", "parentId");
    if (parent.type !== "STANDARD") throw new ValidationError("Derived and package plans follow a standard plan.", "parentId");
    try {
      if (d.type === "DERIVED") adjustValue = d.adjustKind === "PERCENT" ? signedPercentBp(d.adjustValue) : parsePeso(d.adjustValue);
      if (d.type === "PACKAGE") packageAddCentavos = parsePeso(d.packageAdd);
    } catch (e) {
      throw new ValidationError(e instanceof ValidationError ? e.message : "Enter an amount like -10 or 600.00.");
    }
    if (packageAddCentavos < 0n) throw new ValidationError("The package amount cannot be negative.");
  }
  return { code: d.code, name: d.name, type: d.type, parentId: d.parentId, adjustKind: d.adjustKind, adjustValue, packageAddCentavos, inclusions: d.inclusions, policyId: d.policyId, sellOnline: d.sellOnline, sortOrder: d.sortOrder };
}

export async function listRatePlans(db: Db, ctx: TenantContext, opts: { includeInactive?: boolean } = {}) {
  authorize(ctx, "reservations.view");
  return db
    .select({ plan: ratePlans, policyName: policies.name })
    .from(ratePlans)
    .innerJoin(policies, eq(policies.id, ratePlans.policyId))
    .where(and(eq(ratePlans.propertyId, ctx.propertyId), eq(ratePlans.organizationId, ctx.organizationId), opts.includeInactive ? undefined : eq(ratePlans.active, true)))
    .orderBy(asc(ratePlans.sortOrder), asc(ratePlans.code));
}

export async function createRatePlan(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "rates.manage");
  const d = ratePlanInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const v = await normalize(tx, ctx, d);
      const [row] = await tx.insert(ratePlans).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, ...v }).returning();
      await recordChange(tx, ctx, { entity: "rate_plan", entityId: row!.id, op: "insert", action: "rate_plan.create", after: row });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Rate plan code ${d.code} is already used.`);
    throw e;
  }
}

export async function updateRatePlan(db: Db, ctx: TenantContext, id: string, raw: unknown) {
  authorize(ctx, "rates.manage");
  const d = ratePlanInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(ratePlans).where(and(eq(ratePlans.id, id), eq(ratePlans.propertyId, ctx.propertyId))).for("update");
      if (!before) throw new NotFoundError("Rate plan not found.");
      if (before.type !== d.type) throw new ValidationError("The plan type cannot change. Make a new plan instead.");
      if (d.type === "STANDARD") {
        // Leaving STANDARD would orphan children; already refused above.
      }
      const v = await normalize(tx, ctx, d, id);
      const [after] = await tx.update(ratePlans).set(v).where(eq(ratePlans.id, id)).returning();
      await recordChange(tx, ctx, { entity: "rate_plan", entityId: id, op: "update", action: "rate_plan.update", before, after });
      return after!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Rate plan code ${d.code} is already used.`);
    throw e;
  }
}

export async function setRatePlanActive(db: Db, ctx: TenantContext, id: string, active: boolean) {
  authorize(ctx, "rates.manage");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(ratePlans).where(and(eq(ratePlans.id, id), eq(ratePlans.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Rate plan not found.");
    if (!active) {
      const kids = await tx.select({ id: ratePlans.id }).from(ratePlans).where(and(eq(ratePlans.parentId, id), eq(ratePlans.active, true))).limit(1);
      if (kids.length) throw new ValidationError("Other active plans follow this one. Turn them off first.");
    } else if (before.parentId) {
      const [parent] = await tx.select().from(ratePlans).where(eq(ratePlans.id, before.parentId)).limit(1);
      if (!parent?.active) throw new ValidationError("Turn on the plan this one follows first.");
    }
    const [after] = await tx.update(ratePlans).set({ active }).where(eq(ratePlans.id, id)).returning();
    await recordChange(tx, ctx, { entity: "rate_plan", entityId: id, op: "update", action: active ? "rate_plan.activate" : "rate_plan.deactivate", before, after });
    return after!;
  });
}
