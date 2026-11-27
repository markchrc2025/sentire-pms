import { count, isNull } from "drizzle-orm";
import { pmsMode } from "@sentire-pms/core";

export interface ConnectionState {
  mode: "hub" | "cloud";
  sync: "online" | "offline" | "not-configured";
  lastSyncAt: string | null;
  pending: number | null;
}

/** Connection state for the status bar (FR-53), shared by /api/status and the first page render. */
export async function connectionState(): Promise<ConnectionState> {
  const mode = pmsMode();
  let pending: number | null = null;
  let lastSyncAt: string | null = null;
  let online = false;
  let enrolled = false;
  if (mode === "hub" && process.env.DATABASE_URL) {
    try {
      const { getDb } = await import("@sentire-pms/db");
      const { outboxEvents, syncState } = await import("@sentire-pms/db/schema");
      const db = getDb();
      const [r] = await db.select({ n: count() }).from(outboxEvents).where(isNull(outboxEvents.ackedAt));
      pending = r?.n ?? 0;
      const [st] = await db.select().from(syncState).limit(1);
      enrolled = Boolean(st?.hubToken);
      if (st?.lastSuccessAt) {
        lastSyncAt = st.lastSuccessAt.toISOString();
        online = Date.now() - st.lastSuccessAt.getTime() < 2 * 60_000;
      }
    } catch {
      pending = null;
    }
  }
  // Not connected to Sentire Cloud yet (no enrollment) reads as local only, not as an outage.
  const sync = mode === "cloud" ? "online" : !enrolled ? "not-configured" : online ? "online" : "offline";
  return { mode, sync, lastSyncAt, pending };
}
