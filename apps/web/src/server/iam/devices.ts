import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@sentire-pms/db";
import { auditLog, devices, pairingCodes, properties } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "./tenant";
import { NotFoundError, ValidationError } from "./errors";

export const DEVICE_COOKIE = "pms_device";
export const PAIRING_MINUTES = 10;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** Pairing is enforced on installed hubs (the hub service sets PMS_REQUIRE_PAIRING=1). */
export function pairingRequired(): boolean {
  return process.env.PMS_REQUIRE_PAIRING === "1";
}

/** A one-time 6-digit code an Admin reads out to pair a new device. Shown once, stored hashed. */
export async function createPairingCode(db: Db, ctx: TenantContext): Promise<{ code: string; expiresAt: Date }> {
  authorize(ctx, "settings.manage");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
  await db.insert(pairingCodes).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, codeHash: sha(code), createdByUserId: ctx.userId, expiresAt });
  await db.insert(auditLog).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, actorUserId: ctx.userId, action: "device.pairing_code", entity: "device", after: { expiresAt: expiresAt.toISOString() } });
  return { code, expiresAt };
}

let wrongAttempts = 0;

export const pairInput = z.object({
  code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code from the Admin."),
  name: z.string().trim().min(2, "Name this device, e.g. Front desk 2.").max(60),
  kind: z.enum(["WINDOWS_DESKTOP", "ANDROID_TABLET", "IPAD", "MAC_DESKTOP", "BROWSER"]).default("BROWSER"),
});

/**
 * Pair a device with a one-time code. Ten wrong codes in a row cancel every open code, so codes
 * cannot be guessed (one million possibilities, ten minutes each).
 */
export async function pairDevice(db: Db, raw: unknown, meta: { userAgent?: string } = {}, now = new Date()): Promise<{ token: string; deviceId: string }> {
  const d = pairInput.parse(raw);
  const result = await db.transaction(async (tx) => {
    const [pc] = await tx.select().from(pairingCodes).where(and(eq(pairingCodes.codeHash, sha(d.code)), isNull(pairingCodes.usedAt), gt(pairingCodes.expiresAt, now))).for("update").limit(1);
    if (!pc) return null;
    wrongAttempts = 0;
    await tx.update(pairingCodes).set({ usedAt: now }).where(eq(pairingCodes.id, pc.id));
    const token = randomBytes(32).toString("base64url");
    const [dev] = await tx.insert(devices).values({ organizationId: pc.organizationId, propertyId: pc.propertyId, name: d.name, kind: d.kind, tokenHash: sha(token), pairedByUserId: pc.createdByUserId, userAgent: meta.userAgent?.slice(0, 300), lastSeenAt: now }).returning();
    await tx.insert(auditLog).values({ organizationId: pc.organizationId, propertyId: pc.propertyId, actorUserId: pc.createdByUserId, action: "device.paired", entity: "device", entityId: dev!.id, after: { name: d.name, kind: d.kind } });
    return { token, deviceId: dev!.id };
  });
  if (!result) {
    wrongAttempts++;
    if (wrongAttempts >= 10) {
      await db.update(pairingCodes).set({ usedAt: now }).where(isNull(pairingCodes.usedAt));
      wrongAttempts = 0;
    }
    throw new ValidationError("That code is wrong or has expired. Ask the Admin for a new one.");
  }
  return result;
}

/** The first device on a new hub is paired by the setup itself. */
export async function pairSetupDevice(db: Db, userAgent?: string): Promise<string> {
  const [p] = await db.select().from(properties).limit(1);
  if (!p) throw new NotFoundError("No property.");
  const token = randomBytes(32).toString("base64url");
  await db.insert(devices).values({ organizationId: p.organizationId, propertyId: p.id, name: "Hub PC", kind: "WINDOWS_DESKTOP", tokenHash: sha(token), userAgent: userAgent?.slice(0, 300), lastSeenAt: new Date() });
  return token;
}

export async function deviceForToken(db: Db, token: string | undefined) {
  if (!token) return null;
  const [d] = await db.select().from(devices).where(and(eq(devices.tokenHash, sha(token)), isNull(devices.revokedAt))).limit(1);
  if (!d) return null;
  if (!d.lastSeenAt || Date.now() - d.lastSeenAt.getTime() > 5 * 60_000) await db.update(devices).set({ lastSeenAt: new Date() }).where(eq(devices.id, d.id));
  return d;
}

export async function listDevices(db: Db, ctx: TenantContext) {
  authorize(ctx, "settings.manage");
  return db.select().from(devices).where(and(eq(devices.propertyId, ctx.propertyId), eq(devices.organizationId, ctx.organizationId))).orderBy(desc(devices.createdAt));
}

export async function revokeDevice(db: Db, ctx: TenantContext, id: string) {
  authorize(ctx, "settings.manage");
  const [d] = await db.update(devices).set({ revokedAt: new Date() }).where(and(eq(devices.id, id), eq(devices.propertyId, ctx.propertyId), isNull(devices.revokedAt))).returning();
  if (!d) throw new NotFoundError("Device not found.");
  await db.insert(auditLog).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, actorUserId: ctx.userId, action: "device.revoked", entity: "device", entityId: id, after: { name: d.name } });
  return d;
}

