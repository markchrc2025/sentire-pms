/**
 * Background worker entry (pnpm worker:hub). Runs the sync loop outside the web process; set
 * PMS_SYNC_IN_PROCESS=0 on the web process when this runs. Night audit, backups and emails join
 * this worker in later phases.
 */
import { startSyncLoop } from "./server/sync/loop";

startSyncLoop();
console.log("[worker] sync loop running");
setInterval(() => {}, 1 << 30);
