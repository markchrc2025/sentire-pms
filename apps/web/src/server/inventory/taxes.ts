import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { parsePeso } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { taxFees } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "../iam/tenant";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "../iam/errors";
import { recordChange } from "../data/write";

/** "12" or "12.5" percent to basis points (1200, 1250). */
export function percentToBp(s: string): bigint {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(s.trim().replace(/%$/, ""));
  if (!m) throw new ValidationError("Enter a percentage like 12 or 2.5.");
  const bp = BigInt(m[1]!) * 100n + BigInt((m[2] ?? "").padEnd(2, "0"));
  if (bp > 10000n) throw new ValidationError("A percentage cannot be above 100.");
  return bp;
}

export function formatBp(bp: bigint): string {
  const whole = bp / 100n;
  const frac = bp % 100n;
  return frac === 0n ? `${whole}%` : `${whole}.${frac.toString().padStart(2, "0").replace(/0$/, "")}%`;
}

export const taxFeeInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, "Code: 2 to 20 letters, numbers, dashes."),
  name: z.string().trim().min(2).max(80),
  kind: z.enum(["TAX", "FEE", "DISCOUNT"]),
  calc: z.enum(["PERCENT", "FIXED"]),
  basis: z.enum(["PER_NIGHT", "PER_STAY", "PER_GUEST_PER_NIGHT", "PER_RESERVATION"]),
  value: z.string().trim().min(1, "Enter a value."),
  inclusive: z.union([z.boolean(), z.literal("on"), z.literal("")]).optional().transform((v) => v === true || v === "on"),
  glCode: z.string().trim().min(1, "Enter the GL account code.").max(30),
});

function valueOf(d: z.infer<typeof taxFeeInput>): bigint {
  if (d.calc === "PERCENT") return percentToBp(d.value);
  try {
    const v = parsePeso(d.value);
    if (v < 0n) throw new Error();
    return v;
  } catch {
    throw new ValidationError("Enter a peso amount like 50 or 50.00.");
  }
}

export async function listTaxFees(db: Db, ctx: TenantContext) {
  authorize(ctx, "property.view");
  return db.select().from(taxFees).where(and(eq(taxFees.propertyId, ctx.propertyId), eq(taxFees.organizationId, ctx.organizationId))).orderBy(asc(taxFees.kind), asc(taxFees.name));
}

export async function createTaxFee(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "settings.manage");
  const d = taxFeeInput.parse(raw);
  const value = valueOf(d);
  if (d.kind === "DISCOUNT" && d.inclusive) throw new ValidationError("A discount cannot be included in the rate.");
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx.insert(taxFees).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, code: d.code, name: d.name, kind: d.kind, calc: d.calc, basis: d.basis, value, inclusive: d.inclusive, glCode: d.glCode }).returning();
      await recordChange(tx, ctx, { entity: "tax_fee", entityId: row!.id, op: "insert", action: "tax_fee.create", after: row });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Code ${d.code} is already used.`);
    throw e;
  }
}

export async function updateTaxFee(db: Db, ctx: TenantContext, id: string, raw: unknown) {
  authorize(ctx, "settings.manage");
  const d = taxFeeInput.parse(raw);
  const value = valueOf(d);
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(taxFees).where(and(eq(taxFees.id, id), eq(taxFees.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Tax or fee not found.");
    if (before.system && (d.code !== before.code || d.kind !== before.kind || d.calc !== before.calc)) throw new ValidationError("Code, kind and calculation of a built-in item cannot change.");
    const [after] = await tx.update(taxFees).set({ code: d.code, name: d.name, kind: d.kind, calc: d.calc, basis: d.basis, value, inclusive: d.inclusive, glCode: d.glCode }).where(eq(taxFees.id, id)).returning();
    await recordChange(tx, ctx, { entity: "tax_fee", entityId: id, op: "update", action: "tax_fee.update", before, after });
    return after!;
  });
}

export async function setTaxFeeActive(db: Db, ctx: TenantContext, id: string, active: boolean) {
  authorize(ctx, "settings.manage");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(taxFees).where(and(eq(taxFees.id, id), eq(taxFees.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Tax or fee not found.");
    if (before.system && !active) throw new ValidationError("Built-in items (VAT, senior citizen and PWD) cannot be turned off.");
    const [after] = await tx.update(taxFees).set({ active }).where(eq(taxFees.id, id)).returning();
    await recordChange(tx, ctx, { entity: "tax_fee", entityId: id, op: "update", action: active ? "tax_fee.activate" : "tax_fee.deactivate", before, after });
    return after!;
  });
}
