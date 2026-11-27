import { getDb } from "@sentire-pms/db";
import { snapshotForHub } from "@/server/sync/cloud";
import { syncRoute } from "@/server/sync/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return syncRoute(req, async (hub) => snapshotForHub(getDb(), hub!));
}
