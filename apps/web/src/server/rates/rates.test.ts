import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { freshTestDb, TEST_DATABASE_URL } from "@sentire-pms/db/test";
import { makeProperty } from "@/test/fixtures";
import { createRoomRange, createRoomType } from "../inventory/rooms";
import { createTaxFee } from "../inventory/taxes";
import { ForbiddenError, ValidationError } from "../iam/errors";
import { createPolicy, setPolicyActive } from "./policies";
import { createRatePlan, setRatePlanActive } from "./plans";
import { applyBulk, deriveRate, nightlyRates, previewBulk, quote, rateMatrix, setDay } from "./pricing";

describe("deriveRate", () => {
  it("applies percent, fixed and package rules, never below zero", () => {
    const base = { adjustKind: "PERCENT" as const, adjustValue: 0n, packageAddCentavos: 0n };
    expect(deriveRate({ ...base, type: "DERIVED", adjustValue: -1000n }, 320000n)).toBe(288000n);
    expect(deriveRate({ ...base, type: "DERIVED", adjustValue: 1250n }, 333333n)).toBe(375000n); // +12.5%: 41,666.625 rounds to 41,667
    expect(deriveRate({ ...base, type: "DERIVED", adjustKind: "FIXED", adjustValue: -50000n }, 320000n)).toBe(270000n);
    expect(deriveRate({ ...base, type: "DERIVED", adjustKind: "FIXED", adjustValue: -500000n }, 320000n)).toBe(0n);
    expect(deriveRate({ ...base, type: "PACKAGE", packageAddCentavos: 60000n }, 320000n)).toBe(380000n);
  });
});

describe.skipIf(!TEST_DATABASE_URL)("rates and policies (integration, Postgres)", () => {
  let c: Awaited<ReturnType<typeof freshTestDb>>;
  let p: Awaited<ReturnType<typeof makeProperty>>;
  let q: Awaited<ReturnType<typeof makeProperty>>;
  const ids = {} as Record<string, string>;
  beforeAll(async () => {
    c = await freshTestDb();
    p = await makeProperty(c.db);
    q = await makeProperty(c.db);
    const t = await createRoomType(c.db, p.ctx.ADMIN, { code: "DLX", name: "Deluxe", kind: "PRIVATE", maxGuests: 2, baseRate: "3200" });
    const t2 = await createRoomType(c.db, p.ctx.ADMIN, { code: "FAM", name: "Family", kind: "PRIVATE", maxGuests: 4, baseRate: "5500" });
    await createRoomRange(c.db, p.ctx.ADMIN, { roomTypeId: t.id, from: 101, to: 103 });
    ids.dlx = t.id;
    ids.fam = t2.id;
  });
  afterAll(async () => {
    await c?.pool.end();
  });

  it("creates policies and plans with the right permissions and links", async () => {
    await expect(createPolicy(c.db, p.ctx.FRONT_DESK, { name: "Flexible", guarantee: "FIRST_NIGHT", refundable: "on", freeCancelHours: 48, lateCancelPenalty: "FIRST_NIGHT", noShowPenalty: "FIRST_NIGHT" })).rejects.toBeInstanceOf(ForbiddenError);
    const flex = await createPolicy(c.db, p.ctx.ADMIN, { name: "Flexible", guarantee: "FIRST_NIGHT", refundable: "on", freeCancelHours: 48, lateCancelPenalty: "FIRST_NIGHT", noShowPenalty: "FIRST_NIGHT" });
    const nr = await createPolicy(c.db, p.ctx.ADMIN, { name: "Non-refundable", guarantee: "PERCENT", guaranteeValue: "100", lateCancelPenalty: "FULL_STAY", noShowPenalty: "FULL_STAY" });
    expect(flex.freeCancelHours).toBe(48);
    expect(nr.freeCancelHours).toBeNull();
    expect(nr.guaranteeValue).toBe(10000n);
    const bar = await createRatePlan(c.db, p.ctx.ADMIN, { code: "bar", name: "Best available", type: "STANDARD", policyId: flex.id, sellOnline: "on" });
    const nrp = await createRatePlan(c.db, p.ctx.ADMIN, { code: "NR", name: "Non-refundable 10% off", type: "DERIVED", parentId: bar.id, adjustKind: "PERCENT", adjustValue: "-10", policyId: nr.id });
    const bb = await createRatePlan(c.db, p.ctx.ADMIN, { code: "BB", name: "Bed and breakfast", type: "PACKAGE", parentId: bar.id, packageAdd: "600", inclusions: "Breakfast for two", policyId: flex.id });
    await expect(createRatePlan(c.db, p.ctx.ADMIN, { code: "X", name: "Chain", type: "DERIVED", parentId: nrp.id, adjustValue: "-5", policyId: flex.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(createRatePlan(c.db, q.ctx.ADMIN, { code: "BAR", name: "Steal", type: "STANDARD", policyId: flex.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(setPolicyActive(c.db, p.ctx.ADMIN, flex.id, false)).rejects.toBeInstanceOf(ValidationError);
    await expect(setRatePlanActive(c.db, p.ctx.ADMIN, bar.id, false)).rejects.toBeInstanceOf(ValidationError);
    Object.assign(ids, { bar: bar.id, nr: nrp.id, bb: bb.id, flex: flex.id });
  });

  it("nightly rates fall back to the base rate and follow the parent", async () => {
    await setDay(c.db, p.ctx.ADMIN, { ratePlanId: ids.bar!, roomTypeId: ids.dlx!, date: "2026-12-11", patch: { rateCentavos: 360000n } });
    const bar = await nightlyRates(c.db, p.ctx.ADMIN, ids.bar!, ids.dlx!, "2026-12-10", "2026-12-12");
    expect(bar.map((n) => n.rateCentavos)).toEqual([320000n, 360000n]);
    const nr = await nightlyRates(c.db, p.ctx.ADMIN, ids.nr!, ids.dlx!, "2026-12-10", "2026-12-12");
    expect(nr.map((n) => n.rateCentavos)).toEqual([288000n, 324000n]);
    const bb = await nightlyRates(c.db, p.ctx.ADMIN, ids.bb!, ids.dlx!, "2026-12-10", "2026-12-12");
    expect(bb.map((n) => n.rateCentavos)).toEqual([380000n, 420000n]);
    await expect(setDay(c.db, p.ctx.ADMIN, { ratePlanId: ids.nr!, roomTypeId: ids.dlx!, date: "2026-12-11", patch: { rateCentavos: 1n } })).rejects.toBeInstanceOf(ValidationError);
    await expect(setDay(c.db, p.ctx.FRONT_DESK, { ratePlanId: ids.bar!, roomTypeId: ids.dlx!, date: "2026-12-11", patch: { closed: true } })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("quotes a stay with VAT inside, added fees and the guarantee", async () => {
    await createTaxFee(c.db, p.ctx.ADMIN, { code: "ENV", name: "Environmental fee", kind: "FEE", calc: "FIXED", basis: "PER_GUEST_PER_NIGHT", value: "50", glCode: "4200" });
    const qd = await quote(c.db, p.ctx.FRONT_DESK, { ratePlanId: ids.bar!, roomTypeId: ids.dlx!, checkIn: "2026-12-10", checkOut: "2026-12-13", adults: 2 });
    // Nights: 3,200 + 3,600 + 3,200 = 10,000.00
    expect(qd.roomTotalCentavos).toBe(1000000n);
    // VAT per night: round(320000*12/112)=34286, round(360000*12/112)=38571, 34286 -> 107143
    expect(qd.vatIncludedCentavos).toBe(107143n);
    // Fee: ₱50 x 2 guests x 3 nights = ₱300
    expect(qd.addedFees).toEqual([{ code: "ENV", name: "Environmental fee", kind: "FEE", amountCentavos: 30000n, glCode: "4200" }]);
    expect(qd.totalCentavos).toBe(1030000n);
    expect(qd.guaranteeCentavos).toBe(320000n);
    expect(qd.violations).toEqual([]);
    const tooMany = await quote(c.db, p.ctx.FRONT_DESK, { ratePlanId: ids.bar!, roomTypeId: ids.dlx!, checkIn: "2026-12-10", checkOut: "2026-12-11", adults: 3 });
    expect(tooMany.violations.map((v) => v.code)).toEqual(["MAX_GUESTS"]);
    await expect(quote(c.db, p.ctx.FRONT_DESK, { ratePlanId: ids.bar!, roomTypeId: ids.dlx!, checkIn: "2026-12-10", checkOut: "2026-12-10" })).rejects.toBeInstanceOf(ZodError);
  });

  it("restrictions: closed, closed to arrival and departure, min and max stay", async () => {
    await setDay(c.db, p.ctx.ADMIN, { ratePlanId: ids.bar!, roomTypeId: ids.fam!, date: "2026-12-20", patch: { closedToArrival: true, minStay: 2 } });
    await setDay(c.db, p.ctx.ADMIN, { ratePlanId: ids.bar!, roomTypeId: ids.fam!, date: "2026-12-22", patch: { closedToDeparture: true, closed: true } });
    const v = async (ci: string, co: string) => (await quote(c.db, p.ctx.ADMIN, { ratePlanId: ids.nr!, roomTypeId: ids.fam!, checkIn: ci, checkOut: co })).violations.map((x) => x.code);
    expect(await v("2026-12-20", "2026-12-21")).toEqual(["CTA", "MIN_STAY"]);
    expect(await v("2026-12-21", "2026-12-22")).toEqual(["CTD"]);
    expect(await v("2026-12-21", "2026-12-23")).toEqual(["CLOSED"]);
    await setDay(c.db, p.ctx.ADMIN, { ratePlanId: ids.bar!, roomTypeId: ids.fam!, date: "2026-12-25", patch: { maxStay: 2 } });
    expect(await v("2026-12-25", "2026-12-28")).toEqual(["MAX_STAY"]);
    await expect(setDay(c.db, p.ctx.ADMIN, { ratePlanId: ids.bar!, roomTypeId: ids.fam!, date: "2026-12-25", patch: { minStay: 3 } })).rejects.toBeInstanceOf(ValidationError);
  });

  it("bulk update previews, then applies in one transaction to chosen days and types only", async () => {
    const input = { ratePlanId: ids.bar!, from: "2027-01-01", to: "2027-01-14", days: ["5", "6"], roomTypeIds: [ids.dlx!], rateAction: "INCREASE", rateMode: "PERCENT", rateValue: "15", closed: "", closedToArrival: "", closedToDeparture: "" };
    const preview = await previewBulk(c.db, p.ctx.ADMIN, input);
    // Fridays and Saturdays between 1 and 14 Jan 2027: 1, 2, 8, 9 Jan.
    expect(preview.map((x) => x.date)).toEqual(["2027-01-01", "2027-01-02", "2027-01-08", "2027-01-09"]);
    expect(preview[0]!.after.rateCentavos).toBe(368000n);
    expect((await nightlyRates(c.db, p.ctx.ADMIN, ids.bar!, ids.dlx!, "2027-01-01", "2027-01-02"))[0]!.rateCentavos).toBe(320000n);
    expect(await applyBulk(c.db, p.ctx.ADMIN, input)).toBe(4);
    const after = await nightlyRates(c.db, p.ctx.ADMIN, ids.bar!, ids.dlx!, "2027-01-01", "2027-01-04");
    expect(after.map((n) => n.rateCentavos)).toEqual([368000n, 368000n, 320000n]);
    expect((await nightlyRates(c.db, p.ctx.ADMIN, ids.bar!, ids.fam!, "2027-01-01", "2027-01-02"))[0]!.rateCentavos).toBe(550000n);
    // Set and restrictions together; nothing written when one night breaks a rule.
    await expect(applyBulk(c.db, p.ctx.ADMIN, { ...input, rateAction: "", minStay: "5", maxStay: "2" })).rejects.toBeInstanceOf(ValidationError);
    expect((await nightlyRates(c.db, p.ctx.ADMIN, ids.bar!, ids.dlx!, "2027-01-01", "2027-01-02"))[0]!.minStay).toBe(1);
    await expect(applyBulk(c.db, p.ctx.FRONT_DESK, input)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(previewBulk(c.db, p.ctx.ADMIN, { ...input, rateAction: "", closed: "" })).rejects.toBeInstanceOf(ValidationError);
    await expect(previewBulk(c.db, q.ctx.ADMIN, input)).rejects.toThrow();
  });

  it("matrix lists every active type", async () => {
    const m = await rateMatrix(c.db, p.ctx.FRONT_DESK, ids.bar!, "2026-12-10", "2026-12-12");
    expect(m.map((r) => r.code)).toEqual(["DLX", "FAM"]);
    expect(m[0]!.nights[1]!.rateCentavos).toBe(360000n);
  });
});
