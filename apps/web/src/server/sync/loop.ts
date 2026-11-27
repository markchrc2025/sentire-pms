import { sql } from "drizzle-orm";
import { isHub } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { enrollThisHub, getSyncState, httpTransport, syncOnce } from "./hub";

const INTERVAL_MS = 15_000;
let started = false;

/**
 * The hub's sync loop: every 15 seconds, if enrolled and not backing off, run one sync round.
 * A Postgres advisory lock makes sure only one process on the hub syncs at a time.
 */
export function startSyncLoop() {
  if (started || !isHub() || !process.env.DATABASE_URL) return;
  started = true;
  const db = getDb();
  const tick = async () => {
    try {
      const st = await getSyncState(db);
      if (!st?.hubToken || !st.cloudUrl) {
        if (await autoEnroll()) setTimeout(tick, 500);
        return;
      }
      if (st.nextAttemptAt && st.nextAttemptAt > new Date()) return;
      const got = await db.execute(sql`select pg_try_advisory_lock(7281001) as ok`);
      if (!(got.rows[0] as { ok: boolean }).ok) return;
      try {
        const r = await syncOnce(db, httpTransport(st.cloudUrl));
        if (r.pushed || r.pulled || r.rejected || !r.ok) console.log(`[sync] pushed ${r.pushed}, pulled ${r.pulled}, rejected ${r.rejected}${r.error ? `, error: ${r.error}` : ""}`);
      } finally {
        await db.execute(sql`select pg_advisory_unlock(7281001)`);
      }
    } catch (e) {
      console.error("[sync] loop error", (e as Error).message);
    }
  };
  setInterval(tick, INTERVAL_MS).unref?.();
  setTimeout(tick, 3_000);
}

/** Staging convenience: enroll on boot when CLOUD_SYNC_URL and CLOUD_ENROLL_KEY are set. */
async function autoEnroll(): Promise<boolean> {
  const url = process.env.CLOUD_SYNC_URL;
  const key = process.env.CLOUD_ENROLL_KEY;
  if (!url || !key) return false;
  try {
    const db = getDb();
    const id = await enrollThisHub(db, httpTransport(url), { cloudUrl: url, enrollKey: key, hubName: process.env.HUB_NAME ?? "Hub", replace: true });
    console.log(`[sync] enrolled as hub ${id}`);
    return true;
  } catch (e) {
    console.error("[sync] auto-enroll failed:", (e as Error).message);
    return false;
  }
}
