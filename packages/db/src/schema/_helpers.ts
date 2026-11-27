import { char, timestamp } from "drizzle-orm/pg-core";
import { newId } from "@sentire-pms/core";

/** ULID primary key, created where the record is born. */
export const id = () => char("id", { length: 26 }).primaryKey().$defaultFn(newId);
export const ulidRef = (name: string) => char(name, { length: 26 });

export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
};
