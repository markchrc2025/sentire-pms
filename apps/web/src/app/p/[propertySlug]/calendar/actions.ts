"use server";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getDb } from "@sentire-pms/db";
import { requireTenant } from "@/server/iam/request";
import { isDomainError } from "@/server/iam/errors";
import { assignRoom } from "@/server/reservations";

/** Drag and drop on the calendar: move a booked room to another room (FR-13). */
export async function moveBarAction(slug: string, reservationRoomId: string, roomId: string): Promise<{ error?: string }> {
  const ctx = await requireTenant(slug);
  try {
    await assignRoom(getDb(), ctx, reservationRoomId, roomId);
  } catch (e) {
    if (e instanceof ZodError) return { error: e.issues[0]?.message };
    if (isDomainError(e)) return { error: e.message };
    throw e;
  }
  revalidatePath(`/p/${slug}/calendar`);
  return {};
}
