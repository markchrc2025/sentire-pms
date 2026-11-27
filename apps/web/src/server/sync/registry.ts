/**
 * Entities that sync between hub and cloud, in dependency order (parents first). Each maps an
 * outbox entity name to its table. Later phases add their entities here.
 */
export interface SyncedEntity {
  entity: string;
  table: string;
  /** How the row is tied to a tenant, for the cloud's ownership check. */
  scope: "organization-row" | "property-row" | "organization" | "property";
  /** Rows of append-only tables are inserted once and never updated. */
  appendOnly?: boolean;
}

export const SYNCED: SyncedEntity[] = [
  { entity: "organization", table: "organizations", scope: "organization-row" },
  { entity: "property", table: "properties", scope: "property-row" },
  { entity: "user", table: "users", scope: "organization" },
  { entity: "property_role", table: "property_roles", scope: "property" },
  { entity: "room_type", table: "room_types", scope: "property" },
  { entity: "room", table: "rooms", scope: "property" },
  { entity: "room_block", table: "room_blocks", scope: "property" },
  { entity: "tax_fee", table: "tax_fees", scope: "property" },
  { entity: "policy", table: "policies", scope: "property" },
  { entity: "rate_plan", table: "rate_plans", scope: "property" },
  { entity: "daily_rate", table: "daily_rates", scope: "property" },
];

export function registerSynced(...e: SyncedEntity[]) {
  for (const x of e) if (!SYNCED.some((s) => s.entity === x.entity)) SYNCED.push(x);
}

export function syncedEntity(entity: string): SyncedEntity | undefined {
  return SYNCED.find((s) => s.entity === entity);
}

/** Columns never written from a sync payload (secrets stay where they were made). */
export const NEVER_SYNCED_COLUMNS = new Set(["password_hash", "pin_hash", "offline_credential_hash", "failed_sign_ins", "locked_until", "token_hash", "hub_token"]);
