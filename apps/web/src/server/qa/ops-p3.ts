import { z } from "zod";
import { createPolicy, listPolicies, setPolicyActive, updatePolicy } from "../rates/policies";
import { createRatePlan, listRatePlans, setRatePlanActive } from "../rates/plans";
import { applyBulk, previewBulk, quote, rateMatrix, setDay } from "../rates/pricing";
import { registerOperations } from "./operations";

const any = z.record(z.string(), z.unknown());
const idActive = z.object({ id: z.string(), active: z.boolean() });
const big = (v: unknown) => (v === null || v === undefined || v === "" ? v : BigInt(String(v)));

registerOperations({
  "policy.list": { description: "Policies. Values in basis points; freeCancelHours null = non-refundable.", input: z.object({}), run: (db, ctx) => listPolicies(db, ctx) },
  "policy.create": { description: "Create a policy: name, guarantee, guaranteeValue (%), refundable (bool), freeCancelHours, lateCancelPenalty, lateCancelValue, noShowPenalty, noShowValue, holdHours.", input: any, run: (db, ctx, a) => createPolicy(db, ctx, a) },
  "policy.update": { description: "Update a policy: id plus the create fields.", input: any, run: (db, ctx, a) => updatePolicy(db, ctx, String((a as { id: string }).id), a) },
  "policy.set_active": { description: "Turn a policy on or off: id, active.", input: idActive, run: (db, ctx, a) => setPolicyActive(db, ctx, (a as z.infer<typeof idActive>).id, (a as z.infer<typeof idActive>).active) },
  "rate_plan.list": { description: "Rate plans with policy names (with inactive).", input: z.object({}), run: (db, ctx) => listRatePlans(db, ctx, { includeInactive: true }) },
  "rate_plan.create": { description: "Create a rate plan: code, name, type (STANDARD|DERIVED|PACKAGE), parentId, adjustKind, adjustValue ('-10'), packageAdd ('600'), inclusions, policyId, sellOnline.", input: any, run: (db, ctx, a) => createRatePlan(db, ctx, a) },
  "rate_plan.set_active": { description: "Turn a rate plan on or off: id, active.", input: idActive, run: (db, ctx, a) => setRatePlanActive(db, ctx, (a as z.infer<typeof idActive>).id, (a as z.infer<typeof idActive>).active) },
  "rates.matrix": { description: "Rates and restrictions of a plan for all room types: ratePlanId, from, to (exclusive). Centavos.", input: z.object({ ratePlanId: z.string(), from: z.string(), to: z.string() }), run: (db, ctx, a) => { const x = a as { ratePlanId: string; from: string; to: string }; return rateMatrix(db, ctx, x.ratePlanId, x.from, x.to); } },
  "rates.set_day": { description: "Set one night on a standard plan: ratePlanId, roomTypeId, date, patch {rateCentavos (string or null), minStay, maxStay, closed, closedToArrival, closedToDeparture}.", input: z.object({ ratePlanId: z.string(), roomTypeId: z.string(), date: z.string(), patch: z.record(z.string(), z.unknown()) }), run: (db, ctx, a) => { const x = a as { ratePlanId: string; roomTypeId: string; date: string; patch: Record<string, unknown> }; return setDay(db, ctx, { ...x, patch: { ...x.patch, ...("rateCentavos" in x.patch ? { rateCentavos: big(x.patch.rateCentavos) } : {}) } as never }); } },
  "rates.bulk_preview": { description: "Preview a bulk update: ratePlanId, from, to (inclusive), days ['0'..'6'], roomTypeIds [], rateAction (''|SET|INCREASE|DECREASE), rateMode (AMOUNT|PERCENT), rateValue, minStay, maxStay, closed/closedToArrival/closedToDeparture (''|on|off).", input: any, run: (db, ctx, a) => previewBulk(db, ctx, a) },
  "rates.bulk_apply": { description: "Apply a bulk update (same input as preview), all nights in one transaction.", input: any, run: (db, ctx, a) => applyBulk(db, ctx, a) },
  "rates.quote": { description: "Price a stay: ratePlanId, roomTypeId, checkIn, checkOut, adults, children. Centavos; VAT included.", input: any, run: (db, ctx, a) => quote(db, ctx, a as never) },
});
