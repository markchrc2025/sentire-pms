import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { PolicyTerms } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { policies, ratePlans } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "../iam/tenant";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "../iam/errors";
import { recordChange } from "../data/write";
import { percentToBp } from "../inventory/taxes";

export const CHARGE_LABEL = { NONE: "Nothing", FIRST_NIGHT: "First night", PERCENT: "Percentage of the stay", FULL_STAY: "Full stay" } as const;

const kind = z.enum(["NONE", "FIRST_NIGHT", "PERCENT", "FULL_STAY"]);
const pct = z.string().trim().optional().transform((v) => (v ? v : "0"));

export const policyInput = z
  .object({
    name: z.string().trim().min(2, "Enter a name.").max(80),
    guarantee: kind,
    guaranteeValue: pct,
    refundable: z.union([z.literal("on"), z.literal(""), z.boolean()]).optional().transform((v) => v === "on" || v === true),
    freeCancelHours: z.coerce.number().int().min(0).max(8760).optional(),
    lateCancelPenalty: kind,
    lateCancelValue: pct,
    noShowPenalty: kind,
    noShowValue: pct,
    holdHours: z.coerce.number().int().min(0).max(720).default(0),
    description: z.string().trim().max(1000).optional().transform((v) => v || null),
  })
  .transform((d, c) => {
    try {
      return {
        name: d.name,
        guarantee: d.guarantee,
        guaranteeValue: d.guarantee === "PERCENT" ? percentToBp(d.guaranteeValue) : 0n,
        freeCancelHours: d.refundable ? (d.freeCancelHours ?? 0) : null,
        lateCancelPenalty: d.lateCancelPenalty,
        lateCancelValue: d.lateCancelPenalty === "PERCENT" ? percentToBp(d.lateCancelValue) : 0n,
        noShowPenalty: d.noShowPenalty,
        noShowValue: d.noShowPenalty === "PERCENT" ? percentToBp(d.noShowValue) : 0n,
        holdHours: d.holdHours,
        description: d.description,
      };
    } catch (e) {
      c.addIssue({ code: "custom", message: (e as Error).message });
      return z.NEVER;
    }
  });

export function termsOf(p: typeof policies.$inferSelect): PolicyTerms {
  return { guarantee: p.guarantee, guaranteeValue: p.guaranteeValue, freeCancelHours: p.freeCancelHours, lateCancelPenalty: p.lateCancelPenalty, lateCancelValue: p.lateCancelValue, noShowPenalty: p.noShowPenalty, noShowValue: p.noShowValue };
}

export async function listPolicies(db: Db, ctx: TenantContext) {
  authorize(ctx, "reservations.view");
  return db.select().from(policies).where(and(eq(policies.propertyId, ctx.propertyId), eq(policies.organizationId, ctx.organizationId))).orderBy(asc(policies.name));
}

export async function createPolicy(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "rates.manage");
  const d = policyInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(policies).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, ...d }).returning();
      await recordChange(tx, ctx, { entity: "policy", entityId: row!.id, op: "insert", action: "policy.create", after: row });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`A policy named ${d.name} exists.`);
    throw e;
  }
}

export async function updatePolicy(db: Db, ctx: TenantContext, id: string, raw: unknown) {
  authorize(ctx, "rates.manage");
  const d = policyInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(policies).where(and(eq(policies.id, id), eq(policies.propertyId, ctx.propertyId))).for("update");
      if (!before) throw new NotFoundError("Policy not found.");
      const [after] = await tx.update(policies).set(d).where(eq(policies.id, id)).returning();
      await recordChange(tx, ctx, { entity: "policy", entityId: id, op: "update", action: "policy.update", before, after });
      return after!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`A policy named ${d.name} exists.`);
    throw e;
  }
}

export async function setPolicyActive(db: Db, ctx: TenantContext, id: string, active: boolean) {
  authorize(ctx, "rates.manage");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(policies).where(and(eq(policies.id, id), eq(policies.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Policy not found.");
    if (!active) {
      const used = await tx.select({ id: ratePlans.id }).from(ratePlans).where(and(eq(ratePlans.policyId, id), eq(ratePlans.active, true))).limit(1);
      if (used.length) throw new ValidationError("Active rate plans use this policy. Give them another policy first.");
    }
    const [after] = await tx.update(policies).set({ active }).where(eq(policies.id, id)).returning();
    await recordChange(tx, ctx, { entity: "policy", entityId: id, op: "update", action: active ? "policy.activate" : "policy.deactivate", before, after });
    return after!;
  });
}
