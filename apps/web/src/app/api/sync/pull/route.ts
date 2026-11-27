import { getDb } from "@sentire-pms/db";
import { eventsForHub } from "@/server/sync/cloud";
import { syncRoute } from "@/server/sync/http";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return syncRoute(req, async (hub) => eventsForHub(getDb(), hub!, new URL(req.url).searchParams.get("after") ?? "0"));
}
