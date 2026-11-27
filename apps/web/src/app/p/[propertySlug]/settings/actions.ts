"use server";
import { formObject, runAction, type ActionState } from "@/server/actions";
import { updatePropertyDetails } from "@/server/property";
import { createBlock, createRoom, createRoomRange, createRoomType, releaseBlock, setRoomActive, setRoomTypeActive, updateRoom, updateRoomType } from "@/server/inventory/rooms";
import { createTaxFee, setTaxFeeActive, updateTaxFee } from "@/server/inventory/taxes";
import { addStaff, changeStaffRole, resetStaffPassword, setStaffActive } from "@/server/iam/staff";

type S = ActionState;

export async function savePropertyAction(slug: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => void (await updatePropertyDetails(db, ctx, formObject(f))));
}

export async function saveRoomTypeAction(slug: string, id: string | null, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    if (id) await updateRoomType(db, ctx, id, formObject(f));
    else await createRoomType(db, ctx, formObject(f));
    return id ? "Room type saved." : "Room type added.";
  });
}

export async function roomTypeActiveAction(slug: string, id: string, active: boolean, _p: S) {
  return runAction(slug, async (db, ctx) => void (await setRoomTypeActive(db, ctx, id, active)));
}

export async function saveRoomAction(slug: string, id: string | null, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    if (id) await updateRoom(db, ctx, id, formObject(f));
    else await createRoom(db, ctx, formObject(f));
    return id ? "Room saved." : "Room added.";
  });
}

export async function addRoomRangeAction(slug: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => `${(await createRoomRange(db, ctx, formObject(f))).length} rooms added.`);
}

export async function roomActiveAction(slug: string, id: string, active: boolean, _p: S) {
  return runAction(slug, async (db, ctx) => void (await setRoomActive(db, ctx, id, active)));
}

export async function addBlockAction(slug: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await createBlock(db, ctx, formObject(f));
    return "Room blocked.";
  });
}

export async function releaseBlockAction(slug: string, id: string, _p: S) {
  return runAction(slug, async (db, ctx) => void (await releaseBlock(db, ctx, id)));
}

export async function saveTaxAction(slug: string, id: string | null, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    if (id) await updateTaxFee(db, ctx, id, formObject(f));
    else await createTaxFee(db, ctx, formObject(f));
  });
}

export async function taxActiveAction(slug: string, id: string, active: boolean, _p: S) {
  return runAction(slug, async (db, ctx) => void (await setTaxFeeActive(db, ctx, id, active)));
}

export async function addStaffAction(slug: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await addStaff(db, ctx, formObject(f));
    return "Staff member added. Give them the temporary password in person.";
  });
}

export async function staffRoleAction(slug: string, userId: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => void (await changeStaffRole(db, ctx, userId, String(f.get("role")))));
}

export async function staffActiveAction(slug: string, userId: string, active: boolean, _p: S) {
  return runAction(slug, async (db, ctx) => void (await setStaffActive(db, ctx, userId, active)));
}

export async function staffPasswordAction(slug: string, userId: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    await resetStaffPassword(db, ctx, userId, String(f.get("password") ?? ""));
    return "Password reset. They are signed out everywhere.";
  });
}
