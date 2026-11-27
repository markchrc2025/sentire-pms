import { z } from "zod";
import { syncNow, syncOverview } from "../sync/admin";
import { createPairingCode, listDevices, revokeDevice } from "../iam/devices";
import { registerOperations } from "./operations";

registerOperations({
  "sync.overview": { description: "Sync state: enrolled, last success, pending changes, open sync issues.", input: z.object({}), run: (db, ctx) => syncOverview(db, ctx) },
  "sync.now": { description: "Run one sync round with Sentire Cloud now.", input: z.object({}), run: (db, ctx) => syncNow(db, ctx) },
  "device.pairing_code": { description: "Make a one-time 6-digit pairing code (10 minutes).", input: z.object({}), run: (db, ctx) => createPairingCode(db, ctx) },
  "device.list": { description: "Paired devices.", input: z.object({}), run: (db, ctx) => listDevices(db, ctx) },
  "device.revoke": { description: "Remove a paired device: id.", input: z.object({ id: z.string() }), run: (db, ctx, a) => revokeDevice(db, ctx, (a as { id: string }).id) },
});
