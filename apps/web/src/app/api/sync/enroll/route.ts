import { getDb } from "@sentire-pms/db";
import { enrollHub } from "@/server/sync/cloud";
import { syncRoute } from "@/server/sync/http";

export async function POST(req: Request) {
  return syncRoute(req, async () => enrollHub(getDb(), await req.json()), { auth: false });
}
