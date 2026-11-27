import { boolean, date, index, pgEnum, pgTable, text, time, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { id, timestamps, ulidRef } from "./_helpers";

export const orgStatus = pgEnum("org_status", ["ACTIVE", "SUSPENDED", "CLOSED"]);
export const role = pgEnum("role", ["OWNER", "ADMIN", "FRONT_DESK", "HOUSEKEEPING", "ACCOUNTANT"]);

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  status: orgStatus("status").notNull().default("ACTIVE"),
  ...timestamps,
});

export const properties = pgTable(
  "properties",
  {
    id: id(),
    organizationId: ulidRef("organization_id").notNull().references(() => organizations.id),
    slug: varchar("slug", { length: 64 }).notNull(),
    name: text("name").notNull(),
    registeredName: text("registered_name"),
    tin: varchar("tin", { length: 20 }),
    branchCode: varchar("branch_code", { length: 10 }),
    address: text("address"),
    timezone: text("timezone").notNull().default("Asia/Manila"),
    currency: varchar("currency", { length: 3 }).notNull().default("PHP"),
    businessDate: date("business_date").notNull(),
    checkInTime: time("check_in_time").notNull().default("14:00"),
    checkOutTime: time("check_out_time").notNull().default("12:00"),
    active: boolean("active").notNull().default(true),
    ...timestamps,
  },
  (t) => [uniqueIndex("properties_slug_uq").on(t.slug), index("properties_org_idx").on(t.organizationId)],
);
