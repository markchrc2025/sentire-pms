import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "../schema";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

/** A second test database next to TEST_DATABASE_URL (created when missing), e.g. the cloud side of sync tests. */
export async function siblingTestDbUrl(suffix: string): Promise<string> {
  const u = new URL(TEST_DATABASE_URL!);
  const name = `${u.pathname.slice(1)}_${suffix}`;
  const admin = new Pool({ connectionString: TEST_DATABASE_URL, max: 1 });
  const r = await admin.query("select 1 from pg_database where datname = $1", [name]);
  if (!r.rowCount) await admin.query(`create database "${name}"`);
  await admin.end();
  u.pathname = `/${name}`;
  return u.toString();
}

/** Fresh schema in the test database: drop everything, then apply all migrations. */
export async function freshTestDb(url = TEST_DATABASE_URL) {
  const pool = new Pool({ connectionString: url, max: 5 });
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle") });
  return { pool, db };
}

/** Assert that a query fails with a database error whose message (or cause) matches. */
export async function expectDbError(p: Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await p;
  } catch (err) {
    const e = err as { message?: string; cause?: { message?: string } };
    const text = `${e.message ?? ""} ${e.cause?.message ?? ""}`;
    if (!pattern.test(text)) throw new Error(`Expected database error matching ${pattern}, got: ${text}`);
    return;
  }
  throw new Error(`Expected database error matching ${pattern}, but the query succeeded`);
}
