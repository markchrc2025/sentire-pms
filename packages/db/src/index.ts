import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;

let pool: Pool | undefined;
let db: Db | undefined;

/** Shared connection for this process. */
export function getDb(url = process.env.DATABASE_URL): Db {
  if (!url) throw new Error("DATABASE_URL is not set");
  if (!db) {
    pool = new Pool({ connectionString: url, max: 10 });
    db = drizzle(pool, { schema });
  }
  return db;
}

export async function pingDb(): Promise<boolean> {
  if (!pool) getDb();
  const r = await pool!.query("select 1 as ok");
  return r.rows[0]?.ok === 1;
}

/** Folder holding the SQL migrations, resolved from this package. */
export function migrationsFolder(): string {
  return process.env.PMS_MIGRATIONS_DIR ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../drizzle");
}

export async function runMigrations(): Promise<void> {
  await migrate(getDb(), { migrationsFolder: migrationsFolder() });
}

export { schema };
export { seedDemo, DEMO_PROPERTY_SLUG } from "./seed-demo";
