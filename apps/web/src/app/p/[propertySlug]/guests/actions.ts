"use server";
import { redirect } from "next/navigation";
import { formObject, runAction, type ActionState } from "@/server/actions";
import { requireTenant } from "@/server/iam/request";
import { createGuest, updateGuest } from "@/server/guests";

export async function saveGuestAction(slug: string, id: string, _p: ActionState, f: FormData) {
  return runAction(slug, async (db, ctx) => void (await updateGuest(db, ctx, id, formObject(f))));
}

export async function newGuestAction(slug: string, _p: ActionState, f: FormData): Promise<ActionState> {
  const r = await runAction(slug, async (db, ctx) => {
    const g = await createGuest(db, ctx, formObject(f));
    return g.id;
  });
  if (r?.ok && r.ok !== "Saved.") {
    await requireTenant(slug);
    redirect(`/p/${slug}/guests/${r.ok}`);
  }
  return r;
}
