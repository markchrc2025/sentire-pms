import { getDb } from "@sentire-pms/db";
import { requireTenant } from "@/server/iam/request";
import { readFile } from "@/server/files";
import { isDomainError } from "@/server/iam/errors";

export async function GET(_req: Request, { params }: { params: Promise<{ propertySlug: string; id: string }> }) {
  const { propertySlug, id } = await params;
  const ctx = await requireTenant(propertySlug);
  try {
    const f = await readFile(getDb(), ctx, id);
    return new Response(new Uint8Array(f.data), {
      headers: { "content-type": f.contentType, "content-disposition": `inline; filename="${encodeURIComponent(f.fileName)}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
    });
  } catch (e) {
    if (isDomainError(e)) return new Response("Not found", { status: 404 });
    throw e;
  }
}
