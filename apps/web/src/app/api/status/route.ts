import { isNull, count } from "drizzle-orm";
import { pmsMode } from "@sentire-pms/core";

export const dynamic = "force-dynamic";

/** Connection state for the status bar (FR-53). Sync itself arrives in Phase 2. */
export async function GET() {
  const mode = pmsMode();
  let pending: number | null = null;
  if (mode === "hub" && process.env.DATABASE_URL) {
    try {
      const { getDb } = await import("@sentire-pms/db");
      const { outboxEvents } = await import("@sentire-pms/db/schema");
      const [r] = await getDb().select({ n: count() }).from(outboxEvents).where(isNull(outboxEvents.ackedAt));
      pending = r?.n ?? 0;
    } catch {
      pending = null;
    }
  }
  const sync = mode === "cloud" ? "online" : process.env.CLOUD_SYNC_URL ? "offline" : "not-configured";
  return Response.json({ mode, sync, lastSyncAt: null, pending }, { headers: { "cache-control": "no-store" } });
}
