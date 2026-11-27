"use server";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getDb } from "@sentire-pms/db";
import { runAction, type ActionState } from "@/server/actions";
import { requireTenant } from "@/server/iam/request";
import { isDomainError } from "@/server/iam/errors";
import { attachIdImage, checkIn, checkOut } from "@/server/frontdesk";

export async function checkInAction(slug: string, id: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const ctx = await requireTenant(slug);
  const discounts = f.getAll("d-room").map((roomId, i) => ({ reservationRoomId: String(roomId), type: String(f.getAll("d-type")[i]), holderName: String(f.getAll("d-name")[i] ?? ""), idNumber: String(f.getAll("d-id")[i] ?? "") })).filter((d) => d.type);
  try {
    await checkIn(getDb(), ctx, id, {
      guest: {
        firstName: String(f.get("firstName") ?? ""),
        lastName: String(f.get("lastName") ?? ""),
        email: String(f.get("email") ?? ""),
        mobile: String(f.get("mobile") ?? ""),
        nationality: String(f.get("nationality") ?? ""),
        address: String(f.get("address") ?? ""),
        birthDate: String(f.get("birthDate") ?? ""),
        company: String(f.get("company") ?? ""),
        idType: (String(f.get("idType") ?? "") || null) as never,
        idNumber: String(f.get("idNumber") ?? ""),
      },
      discounts: discounts as never,
      allowDirtyRooms: f.get("allowDirty") === "on",
    });
  } catch (e) {
    if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Check the form." };
    if (isDomainError(e)) return { error: e.message };
    console.error(e);
    return { error: "Something went wrong. The guest was not checked in." };
  }
  redirect(`/p/${slug}/reservations/${id}/registration-card?printed=0`);
}

export async function idImageAction(slug: string, guestId: string, _p: ActionState, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) return "Choose a photo first.";
    await attachIdImage(db, ctx, guestId, file);
    return "ID image saved on the hub.";
  });
}

export async function checkOutAction(slug: string, id: string, _p: ActionState): Promise<ActionState> {
  const ctx = await requireTenant(slug);
  try {
    await checkOut(getDb(), ctx, id);
  } catch (e) {
    if (isDomainError(e)) return { error: e.message };
    throw e;
  }
  redirect(`/p/${slug}/reservations/${id}`);
}
