import { sql } from "drizzle-orm";
import { bigint, boolean, char, check, customType, date, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { id, timestamps, ulidRef } from "./_helpers";
import { organizations, properties } from "./tenancy";
import { rooms, roomTypes } from "./inventory";
import { ratePlans } from "./rates";
import { users } from "./iam";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });

export const resStatus = pgEnum("res_status", ["INQUIRY", "NOT_CONFIRMED", "CONFIRMED", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"]);
export const resSource = pgEnum("res_source", ["DIRECT_ENGINE", "WALK_IN", "PHONE", "EMAIL", "CORPORATE", "TRAVEL_AGENT", "OTA_AGODA", "OTA_BOOKING", "OTA_EXPEDIA", "OTHER"]);
export const discountType = pgEnum("discount_type", ["SENIOR_CITIZEN", "PWD", "PROMO", "MANUAL"]);

const scope = {
  organizationId: ulidRef("organization_id").notNull().references(() => organizations.id),
  propertyId: ulidRef("property_id").notNull().references(() => properties.id),
};

export const guests = pgTable(
  "guests",
  {
    id: id(),
    ...scope,
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    email: varchar("email", { length: 254 }),
    mobile: varchar("mobile", { length: 32 }),
    nationality: varchar("nationality", { length: 2 }),
    address: text("address"),
    birthDate: date("birth_date"),
    company: text("company"),
    notes: text("notes"),
    marketingConsent: boolean("marketing_consent").notNull().default(false),
    /** Identity document recorded at check-in (FR-21). The image is in stored_files. */
    idType: varchar("id_type", { length: 40 }),
    idNumber: varchar("id_number", { length: 60 }),
    idFileId: char("id_file_id", { length: 26 }),
    anonymizedAt: timestamp("anonymized_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index("guests_property_last_idx").on(t.propertyId, sql`lower(${t.lastName})`),
    index("guests_property_email_idx").on(t.propertyId, sql`lower(${t.email})`),
    index("guests_property_mobile_idx").on(t.propertyId, t.mobile),
  ],
);

export const reservations = pgTable(
  "reservations",
  {
    id: id(),
    ...scope,
    /** Short code people read out on the phone, unique per property. */
    code: varchar("code", { length: 12 }).notNull(),
    status: resStatus("status").notNull(),
    source: resSource("source").notNull(),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    mainGuestId: ulidRef("main_guest_id").notNull().references(() => guests.id),
    adults: integer("adults").notNull().default(1),
    children: integer("children").notNull().default(0),
    totalCentavos: bigint("total_centavos", { mode: "bigint" }).notNull().default(sql`0`),
    guaranteeCentavos: bigint("guarantee_centavos", { mode: "bigint" }).notNull().default(sql`0`),
    /** Penalty worked out by the policy when cancelled or marked no-show; posted to the folio in Phase 6. */
    penaltyCentavos: bigint("penalty_centavos", { mode: "bigint" }).notNull().default(sql`0`),
    notes: text("notes"),
    externalRef: varchar("external_ref", { length: 60 }),
    createdBusinessDate: date("created_business_date").notNull(),
    createdByUserId: ulidRef("created_by_user_id").references(() => users.id),
    holdUntil: timestamp("hold_until", { withTimezone: true }),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    checkedInAt: timestamp("checked_in_at", { withTimezone: true }),
    checkedOutAt: timestamp("checked_out_at", { withTimezone: true }),
    checkedOutBusinessDate: date("checked_out_business_date"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelledBusinessDate: date("cancelled_business_date"),
    cancelReason: text("cancel_reason"),
    noShowAt: timestamp("no_show_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("reservations_property_code_uq").on(t.propertyId, t.code),
    index("reservations_property_dates_idx").on(t.propertyId, t.checkIn, t.checkOut),
    index("reservations_guest_idx").on(t.mainGuestId),
    check("reservations_dates_ck", sql`${t.checkOut} > ${t.checkIn}`),
    check("reservations_people_ck", sql`${t.adults} >= 1 and ${t.children} >= 0`),
  ],
);

/** One booked room (or bed) of a reservation (Cloudbeds' "booking room"). */
export const reservationRooms = pgTable(
  "reservation_rooms",
  {
    id: id(),
    ...scope,
    reservationId: ulidRef("reservation_id").notNull().references(() => reservations.id),
    roomTypeId: ulidRef("room_type_id").notNull().references(() => roomTypes.id),
    ratePlanId: ulidRef("rate_plan_id").notNull().references(() => ratePlans.id),
    roomId: ulidRef("room_id").references(() => rooms.id),
    checkIn: date("check_in").notNull(),
    checkOut: date("check_out").notNull(),
    adults: integer("adults").notNull().default(1),
    children: integer("children").notNull().default(0),
    totalCentavos: bigint("total_centavos", { mode: "bigint" }).notNull().default(sql`0`),
    /** Holds inventory (false for inquiries and after cancellation). */
    active: boolean("active").notNull().default(true),
    /** Taken off the reservation (kept for history). */
    removedAt: timestamp("removed_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index("reservation_rooms_res_idx").on(t.reservationId), check("reservation_rooms_dates_ck", sql`${t.checkOut} > ${t.checkIn}`)],
);

/**
 * One night of one booked room. The unique index on (room_id, stay_date) for active nights makes
 * a double-booked room impossible (CLAUDE.md rule 5).
 */
export const roomNights = pgTable(
  "room_nights",
  {
    id: id(),
    ...scope,
    reservationId: ulidRef("reservation_id").notNull().references(() => reservations.id),
    reservationRoomId: ulidRef("reservation_room_id").notNull().references(() => reservationRooms.id),
    roomTypeId: ulidRef("room_type_id").notNull().references(() => roomTypes.id),
    roomId: ulidRef("room_id").references(() => rooms.id),
    stayDate: date("stay_date").notNull(),
    rateCentavos: bigint("rate_centavos", { mode: "bigint" }).notNull(),
    /** Set when night audit posts the night to the folio (Phase 8). */
    posted: boolean("posted").notNull().default(false),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("room_nights_room_date_active_uq").on(t.roomId, t.stayDate).where(sql`${t.active} and ${t.roomId} is not null`),
    index("room_nights_property_date_idx").on(t.propertyId, t.stayDate),
    index("room_nights_res_room_idx").on(t.reservationRoomId),
  ],
);

/** Senior citizen, PWD and other discounts claimed on a booked room (used by the folio in Phase 6). */
export const reservationDiscounts = pgTable("reservation_discounts", {
  id: id(),
  ...scope,
  reservationRoomId: ulidRef("reservation_room_id").notNull().references(() => reservationRooms.id),
  guestId: ulidRef("guest_id").references(() => guests.id),
  type: discountType("type").notNull(),
  idNumber: varchar("id_number", { length: 60 }),
  holderName: text("holder_name"),
  ...timestamps,
});

export const reservationNotes = pgTable(
  "reservation_notes",
  {
    id: id(),
    ...scope,
    reservationId: ulidRef("reservation_id").notNull().references(() => reservations.id),
    body: text("body").notNull(),
    authorUserId: ulidRef("author_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("reservation_notes_res_idx").on(t.reservationId)],
);

/**
 * Files kept on the hub (reservation documents, ID images). In the database so they are inside
 * the encrypted data folder and every backup. Not sent to the cloud by sync.
 */
export const storedFiles = pgTable(
  "stored_files",
  {
    id: id(),
    ...scope,
    kind: varchar("kind", { length: 20 }).notNull(),
    ownerId: char("owner_id", { length: 26 }).notNull(),
    fileName: text("file_name").notNull(),
    contentType: varchar("content_type", { length: 100 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: varchar("sha256", { length: 64 }).notNull(),
    data: bytea("data").notNull(),
    uploadedByUserId: ulidRef("uploaded_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("stored_files_owner_idx").on(t.ownerId), check("stored_files_size_ck", sql`${t.sizeBytes} <= 10485760`)],
);
