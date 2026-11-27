import { handleRpc, qaEnabled, qaKeyMatches } from "@/server/qa/mcp";

export const dynamic = "force-dynamic";

const notFound = () => new Response("Not found", { status: 404 });

export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!qaEnabled() || !qaKeyMatches(key)) return notFound();
  const body = await req.json().catch(() => null);
  if (!body) return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handleRpc))).filter(Boolean);
    return out.length ? Response.json(out) : new Response(null, { status: 202 });
  }
  const r = await handleRpc(body);
  return r ? Response.json(r) : new Response(null, { status: 202 });
}

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!qaEnabled() || !qaKeyMatches(key)) return notFound();
  return new Response("Method not allowed", { status: 405, headers: { allow: "POST" } });
}
