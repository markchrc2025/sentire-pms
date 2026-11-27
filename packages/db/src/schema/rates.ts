import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { id, timestamps, ulidRef } from "./_helpers";
import { organizations, properties } from "./tenancy";
import { roomTypes } from "./inventory";

export const chargeKind = pgEnum("charge_kind", ["NONE", "FIRST_NIGHT", "PERCENT", "FULL_STAY"]);
export const ratePlanType = pgEnum("rate_plan_type", ["STANDARD", "DERIVED", "PACKAGE"]);
export const adjustKind = pgEnum("adjust_kind", ["PERCENT", "FIXED"]);

const scope = {
  organizationId: ulidRef("organization_id").notNull().references(() => organizations.id),
  propertyId: ulidRef("property_id").notNull().references(() => properties.id),
};

/**
 * Deposit and cancellation policy (FR-09). Values are basis points for PERCENT. A null
 * free_cancel_hours means the rate is non-refundable.
 */
export const policies = pgTable(
  "policies",
  {
    id: id(),
    ...scope,
    name: text("name").notNull(),
    guarantee: chargeKind("guarantee").notNull().default("NONE"),
    guaranteeValue: bigint("guarantee_value", { mode: "bigint" }).notNull().default(sql`0`),
    freeCancelHours: integer("free_cancel_hours"),
    lateCancelPenalty: chargeKind("late_cancel_penalty").notNull().default("NONE"),
    lateCancelValue: bigint("late_cancel_value", { mode: "bigint" }).notNull().default(sql`0`),
    noShowPenalty: chargeKind("no_show_penalty").notNull().default("FIRST_NIGHT"),
    noShowValue: bigint("no_show_value", { mode: "bigint" }).notNull().default(sql`0`),
    /** Hours a Not confirmed booking is held before it may be released (0 = no automatic release). */
    holdHours: integer("hold_hours").notNull().default(0),
    description: text("description"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("policies_property_name_uq").on(t.propertyId, t.name),
    check("policies_values_ck", sql`${t.guaranteeValue} between 0 and 10000 and ${t.lateCancelValue} between 0 and 10000 and ${t.noShowValue} between 0 and 10000`),
    check("policies_hours_ck", sql`(${t.freeCancelHours} is null or ${t.freeCancelHours} between 0 and 8760) and ${t.holdHours} between 0 and 720`),
  ],
);

/**
 * Rate plans (FR-06). STANDARD plans have their own daily rates (room type base rate when a day
 * has none). DERIVED plans follow a parent plus or minus adjust_value (basis points for PERCENT,
 * centavos for FIXED; negative means cheaper). PACKAGE plans follow a parent plus
 * package_add_centavos per night for the included items.
 */
export const ratePlans = pgTable(
  "rate_plans",
  {
    id: id(),
    ...scope,
    code: varchar("code", { length: 12 }).notNull(),
    name: text("name").notNull(),
    type: ratePlanType("type").notNull(),
    parentId: ulidRef("parent_id"),
    adjustKind: adjustKind("adjust_kind").notNull().default("PERCENT"),
    adjustValue: bigint("adjust_value", { mode: "bigint" }).notNull().default(sql`0`),
    packageAddCentavos: bigint("package_add_centavos", { mode: "bigint" }).notNull().default(sql`0`),
    inclusions: text("inclusions"),
    policyId: ulidRef("policy_id").notNull().references(() => policies.id),
    sellOnline: boolean("sell_online").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("rate_plans_property_code_uq").on(t.propertyId, t.code),
    check("rate_plans_parent_ck", sql`(${t.type} = 'STANDARD' and ${t.parentId} is null) or (${t.type} <> 'STANDARD' and ${t.parentId} is not null)`),
    check("rate_plans_package_ck", sql`${t.packageAddCentavos} >= 0`),
  ],
);

/** Rate and restrictions for one standard plan, room type and night (FR-07). */
export const dailyRates = pgTable(
  "daily_rates",
  {
    id: id(),
    ...scope,
    ratePlanId: ulidRef("rate_plan_id").notNull().references(() => ratePlans.id),
    roomTypeId: ulidRef("room_type_id").notNull().references(() => roomTypes.id),
    stayDate: date("stay_date").notNull(),
    /** Null keeps the room type's base rate. */
    rateCentavos: bigint("rate_centavos", { mode: "bigint" }),
    minStay: integer("min_stay").notNull().default(1),
    maxStay: integer("max_stay"),
    closed: boolean("closed").notNull().default(false),
    closedToArrival: boolean("closed_to_arrival").notNull().default(false),
    closedToDeparture: boolean("closed_to_departure").notNull().default(false),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("daily_rates_plan_type_date_uq").on(t.ratePlanId, t.roomTypeId, t.stayDate),
    index("daily_rates_property_date_idx").on(t.propertyId, t.stayDate),
    check("daily_rates_ck", sql`(${t.rateCentavos} is null or ${t.rateCentavos} >= 0) and ${t.minStay} between 1 and 365 and (${t.maxStay} is null or ${t.maxStay} between ${t.minStay} and 365)`),
  ],
);
