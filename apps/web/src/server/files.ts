import { createHash } from "node:crypto";
import { and, desc, eq, isNull } from "drizzle-orm";
import type { Db } from "@sentire-pms/db";
import { guests, reservations, storedFiles } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "./iam/tenant";
import { NotFoundError, ValidationError } from "./iam/errors";
import { recordChange } from "./data/write";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);
export type FileKind = "reservation_doc" | "guest_id";

/** Keep a file on the hub (FR-17, FR-21). PDF and photos up to 10 MB. */
export async function uploadFile(db: Db, ctx: TenantContext, input: { kind: FileKind; ownerId: string; file: File }) {
  authorize(ctx, input.kind === "guest_id" ? "guests.manage" : "reservations.manage");
  const { file } = input;
  if (file.size > MAX_FILE_BYTES) throw new ValidationError("Files can be at most 10 MB.");
  if (!TYPES.has(file.type)) throw new ValidationError("Upload a PDF or a photo (JPG, PNG, WebP, HEIC).");
  const owner =
    input.kind === "guest_id"
      ? await db.select({ id: guests.id }).from(guests).where(and(eq(guests.id, input.ownerId), eq(guests.propertyId, ctx.propertyId))).limit(1)
      : await db.select({ id: reservations.id }).from(reservations).where(and(eq(reservations.id, input.ownerId), eq(reservations.propertyId, ctx.propertyId))).limit(1);
  if (!owner.length) throw new NotFoundError("Not found.");
  const data = Buffer.from(await file.arrayBuffer());
  return db.transaction(async (tx) => {
    const [row] = await tx
      .insert(storedFiles)
      .values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, kind: input.kind, ownerId: input.ownerId, fileName: file.name.slice(0, 200) || "file", contentType: file.type, sizeBytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), data, uploadedByUserId: ctx.userId })
      .returning({ id: storedFiles.id, fileName: storedFiles.fileName, sizeBytes: storedFiles.sizeBytes, kind: storedFiles.kind, ownerId: storedFiles.ownerId });
    // Audit only (files stay on the hub): the entity is not in the sync registry.
    await recordChange(tx, ctx, { entity: "stored_file", entityId: row!.id, op: "insert", action: `file.${input.kind}`, after: { ...row, reservationId: input.kind === "reservation_doc" ? input.ownerId : undefined } });
    return row!;
  });
}

export async function listFiles(db: Db, ctx: TenantContext, ownerId: string) {
  authorize(ctx, "reservations.view");
  return db
    .select({ id: storedFiles.id, fileName: storedFiles.fileName, contentType: storedFiles.contentType, sizeBytes: storedFiles.sizeBytes, createdAt: storedFiles.createdAt, kind: storedFiles.kind })
    .from(storedFiles)
    .where(and(eq(storedFiles.ownerId, ownerId), eq(storedFiles.propertyId, ctx.propertyId), isNull(storedFiles.deletedAt)))
    .orderBy(desc(storedFiles.createdAt));
}

export async function readFile(db: Db, ctx: TenantContext, id: string) {
  const [f] = await db.select().from(storedFiles).where(and(eq(storedFiles.id, id), eq(storedFiles.propertyId, ctx.propertyId), isNull(storedFiles.deletedAt))).limit(1);
  if (!f) throw new NotFoundError("File not found.");
  authorize(ctx, f.kind === "guest_id" ? "guests.view" : "reservations.view");
  return f;
}
