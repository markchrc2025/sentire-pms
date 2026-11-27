/** Fields that never leave the hub or enter the audit log. */
export const SECRET_KEYS = new Set(["passwordHash", "pinHash", "offlineCredentialHash", "tokenHash", "hubToken", "failedSignIns", "lockedUntil"]);

/** Make a value safe for jsonb: bigint becomes a string, Date an ISO string, secrets are dropped. */
export function toJson(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(toJson);
  if (typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !SECRET_KEYS.has(k)).map(([k, x]) => [k, toJson(x)]));
  return v;
}
