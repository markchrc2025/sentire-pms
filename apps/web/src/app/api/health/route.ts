import { pmsMode } from "@sentire-pms/core";
import { APP_VERSION } from "@/lib/version";

export const dynamic = "force-dynamic";

export async function GET() {
  let db: "ok" | "down" | "not-configured" = "not-configured";
  if (process.env.DATABASE_URL) {
    try {
      const { pingDb } = await import("@sentire-pms/db");
      db = (await pingDb()) ? "ok" : "down";
    } catch {
      db = "down";
    }
  }
  const ok = db !== "down";
  return Response.json(
    { ok, service: "sentire-pms", mode: pmsMode(), version: APP_VERSION, db, time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
}
