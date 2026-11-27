import { isCloud } from "@sentire-pms/core";
import { getDb } from "@sentire-pms/db";
import { authenticateHub, SyncAuthError, SyncRequestError } from "./cloud";

/** Wrap a cloud sync route: cloud mode only, hub token checked, errors as JSON. */
export async function syncRoute(req: Request, fn: (hub: Awaited<ReturnType<typeof authenticateHub>> | null) => Promise<unknown>, opts: { auth?: boolean } = { auth: true }) {
  if (!isCloud()) return Response.json({ error: "Not found" }, { status: 404 });
  try {
    const hub = opts.auth === false ? null : await authenticateHub(getDb(), req.headers.get("authorization"));
    return Response.json(await fn(hub), { headers: { "cache-control": "no-store" } });
  } catch (e) {
    if (e instanceof SyncAuthError || e instanceof SyncRequestError) return Response.json({ error: e.message }, { status: e.status });
    console.error("[sync api]", e);
    return Response.json({ error: "Sync failed on the cloud. It will retry." }, { status: 500 });
  }
}
