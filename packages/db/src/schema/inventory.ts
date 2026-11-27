import { sql } from "drizzle-orm";
import { bigint, boolean, check, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { id, timestamps, ulidRef } from "./_helpers";
import { organizations, properties } from "./tenancy";
import { users } from "./iam";

export const roomKind = pgEnum("room_kind", ["PRIVATE", "DORM_BED", "VIRTUAL"]);
export const hkCondition = pgEnum("hk_condition", ["DIRTY", "CLEAN", "INSPECTED"]);
export const blockType = pgEnum("block_type", ["OUT_OF_SERVICE", "OWNER_STAY", "COURTESY_HOLD"]);

const scope = {
  organizationId: ulidRef("organization_id").notNull().references(() => organizations.id),
  propertyId: ulidRef("property_id").notNull().references(() => properties.id),
};

export const roomTypes = pgTable(
  "room_types",
  {
    id: id(),
    ...scope,
    code: varchar("code", { length: 12 }).notNull(),
    name: text("name").notNull(),
    kind: roomKind("kind").notNull().default("PRIVATE"),
    maxGuests: integer("max_guests").notNull().default(2),
    baseRateCentavos: bigint("base_rate_centavos", { mode: "bigint" }).notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("room_types_property_code_uq").on(t.propertyId, t.code),
    check("room_types_max_guests_ck", sql`${t.maxGuests} between 1 and 50`),
    check("room_types_base_rate_ck", sql`${t.baseRateCentavos} >= 0`),
  ],
);

export const rooms = pgTable(
  "rooms",
  {
    id: id(),
    ...scope,
    roomTypeId: ulidRef("room_type_id").notNull().references(() => roomTypes.id),
    number: varchar("number", { length: 20 }).notNull(),
    condition: hkCondition("condition").notNull().default("CLEAN"),
    housekeeperUserId: ulidRef("housekeeper_user_id").references(() => users.id),
    conditionChangedAt: timestamp("condition_changed_at", { withTimezone: true }),
    notes: text("notes"),
    sortOrder: integer("sort_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("rooms_property_number_uq").on(t.propertyId, t.number), index("rooms_type_idx").on(t.roomTypeId)],
);

/** A room taken out of sale. end_date is exclusive (the first night the room is sellable again). */
export const roomBlocks = pgTable(
  "room_blocks",
  {
    id: id(),
    ...scope,
    roomId: ulidRef("room_id").notNull().references(() => rooms.id),
    startDate: date("start_date").notNull(),
    endDate: date("end_date").notNull(),
    type: blockType("type").notNull(),
    reason: text("reason").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("room_blocks_room_idx").on(t.roomId, t.startDate), check("room_blocks_dates_ck", sql`${t.endDate} > ${t.startDate}`)],
);

export const taxKind = pgEnum("tax_kind", ["TAX", "FEE", "DISCOUNT"]);
export const calcType = pgEnum("calc_type", ["PERCENT", "FIXED"]);
export const calcBasis = pgEnum("calc_basis", ["PER_NIGHT", "PER_STAY", "PER_GUEST_PER_NIGHT", "PER_RESERVATION"]);

/**
 * Taxes, fees and discounts (FR-05). value is basis points for PERCENT (1200 = 12%) and centavos
 * for FIXED. inclusive means the amount is already inside the rate (VAT by default).
 */
export const taxFees = pgTable(
  "tax_fees",
  {
    id: id(),
    ...scope,
    code: varchar("code", { length: 20 }).notNull(),
    name: text("name").notNull(),
    kind: taxKind("kind").notNull(),
    calc: calcType("calc").notNull(),
    basis: calcBasis("basis").notNull().default("PER_NIGHT"),
    value: bigint("value", { mode: "bigint" }).notNull(),
    inclusive: boolean("inclusive").notNull().default(false),
    glCode: varchar("gl_code", { length: 30 }).notNull(),
    system: boolean("system").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("tax_fees_property_code_uq").on(t.propertyId, t.code), check("tax_fees_value_ck", sql`${t.value} >= 0`)],
);

/**
 * Sellable units per room type and night (FR-10, NFR-02). Every write that changes availability
 * locks these rows with SELECT ... FOR UPDATE in the same transaction (CLAUDE.md rule 4).
 */
export const inventoryDays = pgTable(
  "inventory_days",
  {
    id: id(),
    ...scope,
    roomTypeId: ulidRef("room_type_id").notNull().references(() => roomTypes.id),
    stayDate: date("stay_date").notNull(),
    totalUnits: integer("total_units").notNull(),
    blockedUnits: integer("blocked_units").notNull().default(0),
    soldUnits: integer("sold_units").notNull().default(0),
    overbookedUnits: integer("overbooked_units").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("inventory_days_type_date_uq").on(t.roomTypeId, t.stayDate),
    index("inventory_days_property_date_idx").on(t.propertyId, t.stayDate),
    check("inventory_days_nonneg_ck", sql`${t.totalUnits} >= 0 and ${t.blockedUnits} >= 0 and ${t.soldUnits} >= 0 and ${t.overbookedUnits} >= 0`),
    check("inventory_days_not_oversold_ck", sql`${t.soldUnits} + ${t.blockedUnits} <= ${t.totalUnits} + ${t.overbookedUnits}`),
  ],
);
