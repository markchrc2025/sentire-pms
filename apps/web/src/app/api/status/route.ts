import { connectionState } from "@/server/sync/status";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await connectionState(), { headers: { "cache-control": "no-store" } });
}
