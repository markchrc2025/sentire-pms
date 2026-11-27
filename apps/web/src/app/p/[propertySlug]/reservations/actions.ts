"use server";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { formatDate, formatPeso, nightsBetween, type ResStatus } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { formObject, runAction, type ActionState } from "@/server/actions";
import { requireTenant } from "@/server/iam/request";
import { isDomainError } from "@/server/iam/errors";
import { availability } from "@/server/inventory/engine";
import { listRatePlans } from "@/server/rates/plans";
import { quote } from "@/server/rates/pricing";
import { listRoomTypes } from "@/server/inventory/rooms";
import { duplicateSuggestions, searchGuests } from "@/server/guests";
import { addBookedRoom, addNote, assignRoom, cancellationPreview, changeBookedRoom, changeDates, createReservation, removeBookedRoom, transition, updateReservationInfo, type CreateReservationInput } from "@/server/reservations";
import { uploadFile } from "@/server/files";

type S = ActionState;

export interface AvailabilityOption {
  roomTypeId: string;
  code: string;
  name: string;
  maxGuests: number;
  available: number;
  plans: { ratePlanId: string; code: string; name: string; total: string; totalCentavos: string; perNight: string; guarantee: string; policyName: string; problems: string[] }[];
}

/** Live availability and prices for the new reservation screen (FR-11). */
export async function searchAvailabilityAction(slug: string, input: { checkIn: string; checkOut: string; adults: number; children: number }): Promise<{ options?: AvailabilityOption[]; error?: string }> {
  const ctx = await requireTenant(slug);
  const db = getDb();
  try {
    if (!(input.checkOut > input.checkIn)) return { error: "Departure must be after arrival." };
    const [types, plans, avail] = await Promise.all([listRoomTypes(db, ctx), listRatePlans(db, ctx), availability(db, ctx, input.checkIn, input.checkOut)]);
    const n = nightsBetween(input.checkIn, input.checkOut).length;
    const options: AvailabilityOption[] = [];
    for (const t of types) {
      const a = avail.find((x) => x.roomTypeId === t.id);
      const row: AvailabilityOption = { roomTypeId: t.id, code: t.code, name: t.name, maxGuests: t.maxGuests, available: Math.min(...(a?.days.map((d) => d.available) ?? [0])), plans: [] };
      for (const { plan } of plans) {
        const q = await quote(db, ctx, { ratePlanId: plan.id, roomTypeId: t.id, checkIn: input.checkIn, checkOut: input.checkOut, adults: Math.max(1, input.adults), children: input.children });
        row.plans.push({ ratePlanId: plan.id, code: plan.code, name: plan.name, total: formatPeso(q.roomTotalCentavos), totalCentavos: q.roomTotalCentavos.toString(), perNight: formatPeso(q.roomTotalCentavos / BigInt(n)), guarantee: formatPeso(q.guaranteeCentavos), policyName: q.policyName, problems: q.violations.map((v) => v.message) });
      }
      options.push(row);
    }
    return { options };
  } catch (e) {
    if (e instanceof ZodError) return { error: e.issues[0]?.message };
    if (isDomainError(e)) return { error: e.message };
    throw e;
  }
}

export async function findGuestsAction(slug: string, q: string) {
  const ctx = await requireTenant(slug);
  const rows = await searchGuests(getDb(), ctx, q, 8);
  return rows.map((g) => ({ id: g.id, name: `${g.firstName} ${g.lastName}`, email: g.email, mobile: g.mobile }));
}

export async function duplicatesAction(slug: string, g: { firstName?: string; lastName?: string; email?: string; mobile?: string }) {
  const ctx = await requireTenant(slug);
  const rows = await duplicateSuggestions(getDb(), ctx, g);
  return rows.map((x) => ({ id: x.id, name: `${x.firstName} ${x.lastName}`, email: x.email, mobile: x.mobile }));
}

export async function createReservationAction(slug: string, input: CreateReservationInput): Promise<{ error?: string }> {
  const ctx = await requireTenant(slug);
  let id: string;
  try {
    id = (await createReservation(getDb(), ctx, input)).id;
  } catch (e) {
    if (e instanceof ZodError) return { error: e.issues[0]?.message ?? "Check the form." };
    if (isDomainError(e)) return { error: e.message };
    console.error(e);
    return { error: "Something went wrong. Nothing was saved." };
  }
  redirect(`/p/${slug}/reservations/${id}`);
}

const LABEL: Partial<Record<ResStatus, string>> = { CONFIRMED: "Confirmed.", NOT_CONFIRMED: "Booked as not confirmed.", CHECKED_IN: "Checked in.", CHECKED_OUT: "Checked out.", CANCELLED: "Cancelled.", NO_SHOW: "Marked as no-show." };

export async function transitionAction(slug: string, id: string, to: ResStatus, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    const r = await transition(db, ctx, id, to, { reason: String(f.get("reason") ?? "") || undefined, allowDirtyRooms: f.get("allowDirty") === "on" });
    return `${LABEL[to] ?? "Saved."}${r.penaltyCentavos > 0n && (to === "CANCELLED" || to === "NO_SHOW") ? ` Penalty under the policy: ${formatPeso(r.penaltyCentavos)} (posted to the folio from Phase 6).` : ""}`;
  });
}

export async function cancelPreviewAction(slug: string, id: string) {
  const ctx = await requireTenant(slug);
  const p = await cancellationPreview(getDb(), ctx, id);
  return formatPeso(p.penaltyCentavos);
}

export async function assignAction(slug: string, reservationRoomId: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    const roomId = String(f.get("roomId") ?? "");
    await assignRoom(db, ctx, reservationRoomId, roomId || null);
    return roomId ? "Room assigned." : "Room unassigned.";
  });
}

export async function changeDatesAction(slug: string, id: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    const r = await changeDates(db, ctx, id, { checkIn: String(f.get("checkIn")), checkOut: String(f.get("checkOut")), overbook: f.get("overbook") === "on", ignoreRestrictions: f.get("ignoreRestrictions") === "on" });
    return `Dates changed to ${formatDate(r.reservation.checkIn)} to ${formatDate(r.reservation.checkOut)}. New total ${formatPeso(r.reservation.totalCentavos)}.${r.unassigned.length ? " A room was taken on the new dates, so it was unassigned." : ""}`;
  });
}

export async function changeRoomAction(slug: string, reservationRoomId: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await changeBookedRoom(db, ctx, reservationRoomId, formObject(f) as never, { overbook: f.get("overbook") === "on" });
    return "Room changed and re-priced.";
  });
}

export async function addRoomAction(slug: string, id: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await addBookedRoom(db, ctx, id, formObject(f) as never, { overbook: f.get("overbook") === "on" });
    return "Room added.";
  });
}

export async function removeRoomAction(slug: string, reservationRoomId: string, _p: S) {
  return runAction(slug, async (db, ctx) => {
    await removeBookedRoom(db, ctx, reservationRoomId);
    return "Room removed.";
  });
}

export async function infoAction(slug: string, id: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await updateReservationInfo(db, ctx, id, { source: String(f.get("source")), externalRef: String(f.get("externalRef") ?? "") || null, notes: String(f.get("notes") ?? "") || null });
    return "Saved.";
  });
}

export async function noteAction(slug: string, id: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await addNote(db, ctx, id, String(f.get("body") ?? ""));
    return "Note added.";
  });
}

export async function uploadAction(slug: string, id: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    const file = f.get("file");
    if (!(file instanceof File) || file.size === 0) return "Choose a file first.";
    await uploadFile(db, ctx, { kind: "reservation_doc", ownerId: id, file });
    return "File saved on the hub.";
  });
}
