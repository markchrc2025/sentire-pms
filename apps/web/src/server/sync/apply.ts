import { sql } from "drizzle-orm";
import type { Db } from "@sentire-pms/db";
import { inboxEvents } from "@sentire-pms/db/schema";
import type { Tx } from "../data/write";
import { NEVER_SYNCED_COLUMNS, type SyncedEntity } from "./registry";

type Q = Db | Tx;

const columnCache = new Map<string, Set<string>>();

async function columnsOf(q: Q, table: string): Promise<Set<string>> {
  const hit = columnCache.get(table);
  if (hit) return hit;
  const r = await q.execute(sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = ${table}`);
  const cols = new Set(r.rows.map((x) => (x as { column_name: string }).column_name));
  if (!cols.size) throw new Error(`Unknown table ${table}`);
  columnCache.set(table, cols);
  return cols;
}

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/**
 * Insert or update one row from a sync payload. Postgres casts each JSON value to the column type
 * (jsonb_populate_record). Only the keys present in the payload are updated, so partial "after"
 * images update just those columns. Secret columns are never written.
 */
export async function upsertRow(q: Q, e: SyncedEntity, row: Record<string, unknown>): Promise<void> {
  const cols = await columnsOf(q, e.table);
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    const c = snake(k);
    if (cols.has(c) && !NEVER_SYNCED_COLUMNS.has(c)) data[c] = v;
  }
  if (typeof data.id !== "string") throw new Error(`${e.entity} payload has no id`);
  const keys = Object.keys(data);
  const t = sql.identifier(e.table);
  const colList = sql.join(keys.map((k) => sql.identifier(k)), sql`, `);
  const rec = sql`jsonb_populate_record(null::${t}, ${JSON.stringify(data)}::jsonb)`;
  const updates = keys.filter((k) => k !== "id");
  if (!e.appendOnly && updates.length) {
    // Update first: a partial "after" image only carries the changed columns.
    const set = sql.join(updates.map((k) => sql`${sql.identifier(k)} = r.${sql.identifier(k)}`), sql`, `);
    const u = await q.execute(sql`update ${t} set ${set} from ${rec} r where ${t}.id = r.id`);
    if ((u.rowCount ?? 0) > 0) return;
  }
  await q.execute(sql`insert into ${t} (${colList}) select ${colList} from ${rec} on conflict (id) do nothing`);
}

/**
 * Apply an inbound event at most once (CLAUDE.md rule 15): the inbox row and the change are
 * written in the same transaction, so a duplicate delivery finds the inbox row and does nothing.
 */
export async function applyOnce(tx: Tx, event: { eventId: string; payload: unknown }, source: string, apply: () => Promise<void>): Promise<"applied" | "duplicate"> {
  const inserted = await tx.insert(inboxEvents).values({ eventId: event.eventId, source, payload: event.payload as object }).onConflictDoNothing().returning({ id: inboxEvents.eventId });
  if (!inserted.length) return "duplicate";
  await apply();
  return "applied";
}
