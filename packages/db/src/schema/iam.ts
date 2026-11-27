import { boolean, index, pgTable, text, timestamp, uniqueIndex, varchar } from "drizzle-orm/pg-core";
import { id, timestamps, ulidRef } from "./_helpers";
import { organizations, properties, role } from "./tenancy";

export const users = pgTable(
  "users",
  {
    id: id(),
    organizationId: ulidRef("organization_id").notNull().references(() => organizations.id),
    sentireAccountId: text("sentire_account_id"),
    email: varchar("email", { length: 254 }).notNull(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    /** Hashed copy of the user's credential for offline sign-in on the hub (scrypt). Never the raw secret. */
    offlineCredentialHash: text("offline_credential_hash"),
    /** Hashed quick-switch PIN for shared front desk stations (scrypt). */
    pinHash: text("pin_hash"),
    lastSignInAt: timestamp("last_sign_in_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("users_email_uq").on(t.email),
    uniqueIndex("users_sentire_account_uq").on(t.sentireAccountId),
    index("users_org_idx").on(t.organizationId),
  ],
);

export const propertyRoles = pgTable(
  "property_roles",
  {
    id: id(),
    organizationId: ulidRef("organization_id").notNull().references(() => organizations.id),
    propertyId: ulidRef("property_id").notNull().references(() => properties.id),
    userId: ulidRef("user_id").notNull().references(() => users.id),
    role: role("role").notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("property_roles_user_property_uq").on(t.userId, t.propertyId), index("property_roles_property_idx").on(t.propertyId)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: ulidRef("user_id").notNull().references(() => users.id),
    /** SHA-256 of the session token; the token itself is only in the cookie. */
    tokenHash: varchar("token_hash", { length: 64 }).notNull(),
    deviceId: ulidRef("device_id"),
    ip: varchar("ip", { length: 64 }),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("sessions_token_uq").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);
