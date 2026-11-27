import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { DEMO_PROPERTY_SLUG, DEMO_USERS, getDb, seedDemo } from "@sentire-pms/db";
import { properties, sessions, users } from "@sentire-pms/db/schema";
import { pmsMode } from "@sentire-pms/core";
import { APP_VERSION } from "@/lib/version";
import { hashToken, SESSION_COOKIE } from "../iam/auth";
import { resolveTenant } from "../iam/tenant";
import { OPERATIONS } from "./operations";
import { SCENARIOS } from "./scenarios";
import "./register-all";

/**
 * PMS Staging QA connector (P0.9). A minimal MCP server (JSON-RPC over HTTP) that lets a UAT
 * session drive STAGING through the app's own service functions. Enabled only when PMS_QA_KEY is
 * set and PMS_SEED_DEMO=1 (a demo deployment); never on production or a hotel hub.
 */
export function qaEnabled(): boolean {
  return Boolean(process.env.PMS_QA_KEY) && process.env.PMS_SEED_DEMO === "1";
}

export function qaKeyMatches(key: string): boolean {
  const want = process.env.PMS_QA_KEY ?? "";
  const a = createHash("sha256").update(key).digest();
  const b = createHash("sha256").update(want).digest();
  return want.length > 0 && timingSafeEqual(a, b);
}

const ROLES = ["OWNER", "ADMIN", "FRONT_DESK", "HOUSEKEEPING", "ACCOUNTANT"] as const;
type RoleName = (typeof ROLES)[number];

const TOOLS = [
  { name: "staging_status", description: "Build, mode, business date, record counts and the demo staff accounts (emails and roles). Call this first.", inputSchema: { type: "object", properties: {} } },
  {
    name: "reset_staging",
    description: "Wipe ALL staging data and re-seed the demo property, demo staff and demo data. Staging only.",
    inputSchema: { type: "object", properties: { confirm: { type: "string", description: "Must be RESET" } }, required: ["confirm"] },
  },
  {
    name: "seed_scenario",
    description: "Create the data for a named test scenario on the demo property. Call with name 'list' to see the scenarios.",
    inputSchema: { type: "object", properties: { name: { type: "string" }, tag: { type: "string", description: "UAT case ID to tag fake data with, e.g. PMS-P1-004" } }, required: ["name"] },
  },
  {
    name: "run_operation",
    description: "Call one of the app's service functions as a demo role. operation 'list' shows them. The app's own permission and validation checks apply; a refusal is the app's answer.",
    inputSchema: {
      type: "object",
      properties: { operation: { type: "string" }, as_role: { type: "string", enum: [...ROLES] }, args: { type: "object" } },
      required: ["operation", "as_role"],
    },
  },
  {
    name: "api_request",
    description: "GET or POST a path on this app (for example /api/health or /p/<slug>/rooms) signed in as a demo role. Returns status and the page text (HTML stripped).",
    inputSchema: {
      type: "object",
      properties: { method: { type: "string", enum: ["GET", "POST"] }, path: { type: "string" }, as_role: { type: "string", enum: [...ROLES, "ANONYMOUS"] }, body: { type: "object" } },
      required: ["path"],
    },
  },
];

async function demoCtx(role: RoleName) {
  const db = getDb();
  const du = DEMO_USERS.find((u) => u.role === role)!;
  const [u] = await db.select().from(users).where(eq(users.email, du.email)).limit(1);
  if (!u) throw new Error(`Demo user for ${role} not found; call reset_staging.`);
  return { db, user: u, ctx: await resolveTenant(db, { userId: u.id, propertySlug: DEMO_PROPERTY_SLUG }) };
}

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  const db = getDb();
  switch (name) {
    case "staging_status": {
      const [p] = await db.select().from(properties).where(eq(properties.slug, DEMO_PROPERTY_SLUG)).limit(1);
      const counts = (await db.execute(sql`select relname as table, n_live_tup::int as rows from pg_stat_user_tables where schemaname = 'public' order by relname`)).rows;
      return { build: APP_VERSION, mode: pmsMode(), property: p ? { slug: p.slug, name: p.name, businessDate: p.businessDate } : null, demoStaff: DEMO_USERS.map((u) => ({ email: u.email, role: u.role })), passwordNote: "Demo staff password is PMS_DEMO_PASSWORD in Dokploy (not shown here).", approximateRowCounts: counts };
    }
    case "reset_staging": {
      if (args.confirm !== "RESET") throw new Error("confirm must be RESET");
      const tables = (await db.execute(sql`select tablename from pg_tables where schemaname = 'public'`)).rows.map((r) => `"${(r as { tablename: string }).tablename}"`);
      if (tables.length) await db.execute(sql.raw(`TRUNCATE ${tables.join(", ")} RESTART IDENTITY CASCADE`));
      await seedDemo(db);
      return { reset: true, tables: tables.length };
    }
    case "seed_scenario": {
      const n = String(args.name ?? "");
      if (n === "list") return Object.entries(SCENARIOS).map(([k, v]) => ({ name: k, description: v.description }));
      const s = SCENARIOS[n];
      if (!s) throw new Error(`Unknown scenario ${n}. Use name 'list'.`);
      const { ctx } = await demoCtx("OWNER");
      return s.run(db, ctx, String(args.tag ?? "QA"));
    }
    case "run_operation": {
      const op = String(args.operation ?? "");
      if (op === "list") return Object.entries(OPERATIONS).map(([k, v]) => ({ operation: k, description: v.description }));
      const o = OPERATIONS[op];
      if (!o) throw new Error(`Unknown operation ${op}. Use operation 'list'.`);
      const role = String(args.as_role) as RoleName;
      if (!ROLES.includes(role)) throw new Error("as_role must be a demo role");
      const parsed = o.input.safeParse(args.args ?? {});
      if (!parsed.success) return { refused: true, reason: "validation", issues: parsed.error.issues };
      const { ctx } = await demoCtx(role);
      try {
        return { ok: true, result: await o.run(db, ctx, parsed.data) };
      } catch (e) {
        return { refused: true, reason: (e as Error).name, message: (e as Error).message };
      }
    }
    case "api_request": {
      const path = String(args.path ?? "/");
      if (!path.startsWith("/") || path.startsWith("//")) throw new Error("path must start with /");
      const role = String(args.as_role ?? "ANONYMOUS");
      const headers: Record<string, string> = { accept: "text/html,application/json" };
      let sessionId: string | undefined;
      if (role !== "ANONYMOUS") {
        const { user } = await demoCtx(role as RoleName);
        const token = randomBytes(32).toString("base64url");
        const [s] = await db.insert(sessions).values({ userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 5 * 60_000), userAgent: "qa-connector" }).returning();
        sessionId = s!.id;
        headers.cookie = `${SESSION_COOKIE}=${token}`;
      }
      try {
        const method = String(args.method ?? "GET");
        if (args.body) headers["content-type"] = "application/json";
        const r = await fetch(`http://127.0.0.1:${process.env.PORT ?? 3000}${path}`, { method, headers, body: args.body ? JSON.stringify(args.body) : undefined, redirect: "manual" });
        const raw = await r.text();
        const text = raw.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
        return { status: r.status, location: r.headers.get("location"), text: text.slice(0, 20000) };
      } finally {
        if (sessionId) await db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId)));
      }
    }
  }
  throw new Error(`Unknown tool ${name}`);
}

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function handleRpc(msg: Rpc): Promise<object | null> {
  const reply = (result: unknown) => ({ jsonrpc: "2.0", id: msg.id ?? null, result });
  switch (msg.method) {
    case "initialize":
      return reply({ protocolVersion: (msg.params?.protocolVersion as string) ?? "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "pms-staging-qa", version: APP_VERSION }, instructions: "Sentire PMS QA connector: drives the STAGING hub (demo property) through the app's own service functions. Never production. Call staging_status first. A refusal is the app's own validation or permission check: report it, do not work around it. Money is in centavos." });
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      try {
        const out = await callTool(name, (msg.params?.arguments as Record<string, unknown>) ?? {});
        return reply({ content: [{ type: "text", text: JSON.stringify(out, (_k, v) => (typeof v === "bigint" ? v.toString() : v), 2) }] });
      } catch (e) {
        return reply({ isError: true, content: [{ type: "text", text: (e as Error).message }] });
      }
    }
    case "ping":
      return reply({});
    default:
      if (msg.id === undefined) return null;
      return { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } };
  }
}
