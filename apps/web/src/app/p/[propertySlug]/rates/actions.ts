"use server";
import { formatDate, formatPeso, parsePeso } from "@sentire-pms/core";
import { formObject, runAction, type ActionState } from "@/server/actions";
import { ValidationError } from "@/server/iam/errors";
import { createPolicy, setPolicyActive, updatePolicy } from "@/server/rates/policies";
import { createRatePlan, setRatePlanActive, updateRatePlan } from "@/server/rates/plans";
import { applyBulk, previewBulk, setDay } from "@/server/rates/pricing";

type S = ActionState;

export async function savePolicyAction(slug: string, id: string | null, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    if (id) await updatePolicy(db, ctx, id, formObject(f));
    else await createPolicy(db, ctx, formObject(f));
  });
}
export async function policyActiveAction(slug: string, id: string, active: boolean, _p: S) {
  return runAction(slug, async (db, ctx) => void (await setPolicyActive(db, ctx, id, active)));
}
export async function savePlanAction(slug: string, id: string | null, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    if (id) await updateRatePlan(db, ctx, id, formObject(f));
    else await createRatePlan(db, ctx, formObject(f));
  });
}
export async function planActiveAction(slug: string, id: string, active: boolean, _p: S) {
  return runAction(slug, async (db, ctx) => void (await setRatePlanActive(db, ctx, id, active)));
}

export async function saveDayAction(slug: string, ratePlanId: string, roomTypeId: string, date: string, _p: S, f: FormData) {
  return runAction(slug, async (db, ctx) => {
    const rate = String(f.get("rate") ?? "").trim();
    const max = String(f.get("maxStay") ?? "").trim();
    let rateCentavos: bigint | null = null;
    if (rate) {
      try {
        rateCentavos = parsePeso(rate);
      } catch {
        throw new ValidationError("Enter a rate like 3200 or 3,200.00, or leave it empty for the base rate.");
      }
    }
    await setDay(db, ctx, {
      ratePlanId,
      roomTypeId,
      date,
      patch: {
        rateCentavos,
        minStay: Number(f.get("minStay") || 1),
        maxStay: max ? Number(max) : null,
        closed: f.get("closed") === "on",
        closedToArrival: f.get("closedToArrival") === "on",
        closedToDeparture: f.get("closedToDeparture") === "on",
      },
    });
    return `Saved ${formatDate(date)}.`;
  });
}

function bulkObject(f: FormData) {
  return { ...formObject(f), days: f.getAll("days").map(String), roomTypeIds: f.getAll("roomTypeIds").map(String) };
}

export async function bulkAction(slug: string, _p: S, f: FormData) {
  const apply = f.get("intent") === "apply";
  return runAction(slug, async (db, ctx) => {
    if (apply) {
      const n = await applyBulk(db, ctx, bulkObject(f));
      return `Applied: ${n} nights changed.`;
    }
    const changes = await previewBulk(db, ctx, bulkObject(f));
    if (!changes.length) return "Preview: nothing would change.";
    const sample = changes.slice(0, 6).map((c) => `${c.roomTypeCode} ${formatDate(c.date)}: ${formatPeso(c.before.rateCentavos)} to ${formatPeso(c.after.rateCentavos)}`);
    return `Preview: ${changes.length} nights would change. ${sample.join("; ")}${changes.length > 6 ? "; and more" : ""}. Press Apply to save them all at once.`;
  }, apply);
}
