import { and, asc, eq, gt, gte, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { isIsoDate, nightsBetween, parsePeso } from "@sentire-pms/core";
import type { Db } from "@sentire-pms/db";
import { inventoryDays, roomBlocks, rooms, roomTypes } from "@sentire-pms/db/schema";
import { authorize, type TenantContext } from "../iam/tenant";
import { ConflictError, NotFoundError, ValidationError, isUniqueViolation } from "../iam/errors";
import { recordChange } from "../data/write";
import { horizon, MAX_RANGE_NIGHTS, recomputeSupply, recomputeSupplyHorizon } from "./engine";



const peso = z.union([z.string(), z.number()]).transform((v, c) => {
  try {
    const n = parsePeso(String(v));
    if (n < 0n) throw new Error();
    return n;
  } catch {
    c.addIssue({ code: "custom", message: "Enter a peso amount like 2500 or 2,500.00." });
    return z.NEVER;
  }
});
const isoDate = z.string().refine(isIsoDate, "Enter a valid date.");

// ---------- Room types ----------

export const roomTypeInput = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,12}$/, "Code: up to 12 letters, numbers or dashes."),
  name: z.string().trim().min(2, "Enter a name.").max(80),
  kind: z.enum(["PRIVATE", "DORM_BED", "VIRTUAL"]),
  maxGuests: z.coerce.number().int().min(1, "At least 1 guest.").max(50),
  baseRate: peso,
  description: z.string().trim().max(2000).optional().transform((v) => v || null),
  sortOrder: z.coerce.number().int().min(0).max(999).default(0),
});

export async function listRoomTypes(db: Db, ctx: TenantContext, opts: { includeInactive?: boolean } = {}) {
  authorize(ctx, "property.view");
  const rows = await db
    .select({ t: roomTypes, roomCount: sql<number>`(select count(*)::int from rooms r where r.room_type_id = "room_types"."id" and r.active)` })
    .from(roomTypes)
    .where(and(eq(roomTypes.propertyId, ctx.propertyId), eq(roomTypes.organizationId, ctx.organizationId), opts.includeInactive ? undefined : eq(roomTypes.active, true)))
    .orderBy(asc(roomTypes.sortOrder), asc(roomTypes.name));
  return rows.map((r) => ({ ...r.t, roomCount: r.roomCount }));
}

export async function createRoomType(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "property.manage");
  const d = roomTypeInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(roomTypes)
        .values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, code: d.code, name: d.name, kind: d.kind, maxGuests: d.kind === "DORM_BED" ? 1 : d.maxGuests, baseRateCentavos: d.baseRate, description: d.description, sortOrder: d.sortOrder })
        .returning();
      await recordChange(tx, ctx, { entity: "room_type", entityId: row!.id, op: "insert", action: "room_type.create", after: row });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Room type code ${d.code} is already used.`);
    throw e;
  }
}

export async function updateRoomType(db: Db, ctx: TenantContext, id: string, raw: unknown) {
  authorize(ctx, "property.manage");
  const d = roomTypeInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, id), eq(roomTypes.propertyId, ctx.propertyId))).for("update");
      if (!before) throw new NotFoundError("Room type not found.");
      const [after] = await tx
        .update(roomTypes)
        .set({ code: d.code, name: d.name, kind: d.kind, maxGuests: d.kind === "DORM_BED" ? 1 : d.maxGuests, baseRateCentavos: d.baseRate, description: d.description, sortOrder: d.sortOrder })
        .where(eq(roomTypes.id, id))
        .returning();
      await recordChange(tx, ctx, { entity: "room_type", entityId: id, op: "update", action: "room_type.update", before, after });
      return after!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Room type code ${d.code} is already used.`);
    throw e;
  }
}

/** Turn a room type off or on. Off removes it from sale; refused while future nights are sold. */
export async function setRoomTypeActive(db: Db, ctx: TenantContext, id: string, active: boolean) {
  authorize(ctx, "property.manage");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(roomTypes).where(and(eq(roomTypes.id, id), eq(roomTypes.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Room type not found.");
    if (!active) {
      const h = await horizon(tx, ctx);
      const [sold] = await tx.select({ n: sql<number>`count(*)::int` }).from(inventoryDays).where(and(eq(inventoryDays.roomTypeId, id), gte(inventoryDays.stayDate, h.from), gt(inventoryDays.soldUnits, 0)));
      if ((sold?.n ?? 0) > 0) throw new ConflictError("This room type has upcoming stays. Move them before turning it off.");
    }
    const [after] = await tx.update(roomTypes).set({ active }).where(eq(roomTypes.id, id)).returning();
    await recomputeSupplyHorizon(tx, ctx, id);
    await recordChange(tx, ctx, { entity: "room_type", entityId: id, op: "update", action: active ? "room_type.activate" : "room_type.deactivate", before, after });
    return after!;
  });
}

// ---------- Rooms ----------

export const roomInput = z.object({
  roomTypeId: z.string().length(26, "Choose a room type."),
  number: z.string().trim().min(1, "Enter a room number.").max(20),
  notes: z.string().trim().max(500).optional().transform((v) => v || null),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export async function listRooms(db: Db, ctx: TenantContext, opts: { includeInactive?: boolean } = {}) {
  authorize(ctx, "property.view");
  return db
    .select({ room: rooms, typeName: roomTypes.name, typeCode: roomTypes.code, kind: roomTypes.kind })
    .from(rooms)
    .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .where(and(eq(rooms.propertyId, ctx.propertyId), eq(rooms.organizationId, ctx.organizationId), opts.includeInactive ? undefined : eq(rooms.active, true)))
    .orderBy(asc(roomTypes.sortOrder), asc(rooms.sortOrder), asc(rooms.number));
}

async function typeInProperty(q: Db | Parameters<Parameters<Db["transaction"]>[0]>[0], ctx: TenantContext, roomTypeId: string) {
  const [t] = await q.select().from(roomTypes).where(and(eq(roomTypes.id, roomTypeId), eq(roomTypes.propertyId, ctx.propertyId), eq(roomTypes.organizationId, ctx.organizationId))).limit(1);
  if (!t) throw new ValidationError("Choose a room type of this property.", "roomTypeId");
  return t;
}

export async function createRoom(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "property.manage");
  const d = roomInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      await typeInProperty(tx, ctx, d.roomTypeId);
      const [row] = await tx.insert(rooms).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, roomTypeId: d.roomTypeId, number: d.number, notes: d.notes, sortOrder: d.sortOrder }).returning();
      await recomputeSupplyHorizon(tx, ctx, d.roomTypeId);
      await recordChange(tx, ctx, { entity: "room", entityId: row!.id, op: "insert", action: "room.create", after: row });
      return row!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Room ${d.number} already exists.`);
    throw e;
  }
}

/** Create rooms 101 to 108 style in one go. */
export async function createRoomRange(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "property.manage");
  const d = z.object({ roomTypeId: z.string().length(26), prefix: z.string().trim().max(10).default(""), from: z.coerce.number().int().min(0).max(99999), to: z.coerce.number().int().min(0).max(99999) }).parse(raw);
  if (d.to < d.from) throw new ValidationError("The last number must not be below the first.");
  if (d.to - d.from >= 200) throw new ValidationError("Create at most 200 rooms at once.");
  try {
    return await db.transaction(async (tx) => {
      await typeInProperty(tx, ctx, d.roomTypeId);
      const values = [];
      for (let n = d.from; n <= d.to; n++) values.push({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, roomTypeId: d.roomTypeId, number: `${d.prefix}${n}`, sortOrder: n % 10000 });
      const rows = await tx.insert(rooms).values(values).returning();
      await recomputeSupplyHorizon(tx, ctx, d.roomTypeId);
      for (const r of rows) await recordChange(tx, ctx, { entity: "room", entityId: r.id, op: "insert", action: "room.create", after: r });
      return rows;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError("One of those room numbers already exists.");
    throw e;
  }
}

export async function updateRoom(db: Db, ctx: TenantContext, id: string, raw: unknown) {
  authorize(ctx, "property.manage");
  const d = roomInput.parse(raw);
  try {
    return await db.transaction(async (tx) => {
      const [before] = await tx.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.propertyId, ctx.propertyId))).for("update");
      if (!before) throw new NotFoundError("Room not found.");
      await typeInProperty(tx, ctx, d.roomTypeId);
      const [after] = await tx.update(rooms).set({ roomTypeId: d.roomTypeId, number: d.number, notes: d.notes, sortOrder: d.sortOrder }).where(eq(rooms.id, id)).returning();
      if (before.roomTypeId !== d.roomTypeId) {
        await recomputeSupplyHorizon(tx, ctx, before.roomTypeId);
        await recomputeSupplyHorizon(tx, ctx, d.roomTypeId);
      }
      await recordChange(tx, ctx, { entity: "room", entityId: id, op: "update", action: "room.update", before, after });
      return after!;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new ConflictError(`Room ${d.number} already exists.`);
    throw e;
  }
}

export async function setRoomActive(db: Db, ctx: TenantContext, id: string, active: boolean) {
  authorize(ctx, "property.manage");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(rooms).where(and(eq(rooms.id, id), eq(rooms.propertyId, ctx.propertyId))).for("update");
    if (!before) throw new NotFoundError("Room not found.");
    const [after] = await tx.update(rooms).set({ active }).where(eq(rooms.id, id)).returning();
    await recomputeSupplyHorizon(tx, ctx, before.roomTypeId);
    await recordChange(tx, ctx, { entity: "room", entityId: id, op: "update", action: active ? "room.activate" : "room.deactivate", before, after });
    return after!;
  });
}

// ---------- Blocks ----------

export const BLOCK_TYPES = { OUT_OF_SERVICE: "Out of service", OWNER_STAY: "Owner stay", COURTESY_HOLD: "Courtesy hold" } as const;

export const blockInput = z
  .object({
    roomId: z.string().length(26, "Choose a room."),
    startDate: isoDate,
    endDate: isoDate,
    type: z.enum(["OUT_OF_SERVICE", "OWNER_STAY", "COURTESY_HOLD"]),
    reason: z.string().trim().min(3, "Give a reason.").max(500),
  })
  .refine((v) => v.endDate > v.startDate, { message: "The end date must be after the start date.", path: ["endDate"] })
  .refine((v) => nightsBetween(v.startDate, v.endDate).length <= MAX_RANGE_NIGHTS, { message: `A block can cover at most ${MAX_RANGE_NIGHTS} nights.`, path: ["endDate"] });

export async function listBlocks(db: Db, ctx: TenantContext, opts: { from?: string } = {}) {
  authorize(ctx, "property.view");
  return db
    .select({ block: roomBlocks, roomNumber: rooms.number, typeName: roomTypes.name })
    .from(roomBlocks)
    .innerJoin(rooms, eq(rooms.id, roomBlocks.roomId))
    .innerJoin(roomTypes, eq(roomTypes.id, rooms.roomTypeId))
    .where(and(eq(roomBlocks.propertyId, ctx.propertyId), eq(roomBlocks.organizationId, ctx.organizationId), isNull(roomBlocks.releasedAt), opts.from ? gt(roomBlocks.endDate, opts.from) : undefined))
    .orderBy(asc(roomBlocks.startDate), asc(rooms.number));
}

/** Block a room (FR-04). The room leaves sellable inventory for those nights. */
export async function createBlock(db: Db, ctx: TenantContext, raw: unknown) {
  authorize(ctx, "property.manage");
  const d = blockInput.parse(raw);
  return db.transaction(async (tx) => {
    const [room] = await tx.select().from(rooms).where(and(eq(rooms.id, d.roomId), eq(rooms.propertyId, ctx.propertyId), eq(rooms.organizationId, ctx.organizationId))).limit(1);
    if (!room) throw new ValidationError("Choose a room of this property.", "roomId");
    if (!room.active) throw new ValidationError("This room is turned off.");
    const h = await horizon(tx, ctx);
    if (d.endDate <= h.from) throw new ValidationError("A block must end after the business date.");
    // Lock the type's nights first, then check for overlapping blocks on the same room.
    const [overlap] = await tx
      .select({ id: roomBlocks.id })
      .from(roomBlocks)
      .where(and(eq(roomBlocks.roomId, d.roomId), isNull(roomBlocks.releasedAt), sql`${roomBlocks.startDate} < ${d.endDate}`, sql`${roomBlocks.endDate} > ${d.startDate}`))
      .limit(1);
    if (overlap) throw new ConflictError("This room already has a block on some of those dates.");
    const [row] = await tx.insert(roomBlocks).values({ organizationId: ctx.organizationId, propertyId: ctx.propertyId, ...d }).returning();
    await recomputeSupply(tx, ctx, room.roomTypeId, d.startDate, d.endDate);
    await recordChange(tx, ctx, { entity: "room_block", entityId: row!.id, op: "insert", action: "room_block.create", after: row });
    return row!;
  });
}

export async function releaseBlock(db: Db, ctx: TenantContext, id: string) {
  authorize(ctx, "property.manage");
  return db.transaction(async (tx) => {
    const [before] = await tx.select().from(roomBlocks).where(and(eq(roomBlocks.id, id), eq(roomBlocks.propertyId, ctx.propertyId))).for("update");
    if (!before || before.releasedAt) throw new NotFoundError("Block not found.");
    const [room] = await tx.select().from(rooms).where(eq(rooms.id, before.roomId)).limit(1);
    const [after] = await tx.update(roomBlocks).set({ releasedAt: new Date() }).where(eq(roomBlocks.id, id)).returning();
    await recomputeSupply(tx, ctx, room!.roomTypeId, before.startDate, before.endDate);
    await recordChange(tx, ctx, { entity: "room_block", entityId: id, op: "update", action: "room_block.release", before, after });
    return after!;
  });
}

