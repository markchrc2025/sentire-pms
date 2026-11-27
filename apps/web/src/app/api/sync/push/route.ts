import { getDb } from "@sentire-pms/db";
import { receivePush } from "@/server/sync/cloud";
import { syncRoute } from "@/server/sync/http";

export async function POST(req: Request) {
  return syncRoute(req, async (hub) => receivePush(getDb(), hub!, await req.json()));
}
