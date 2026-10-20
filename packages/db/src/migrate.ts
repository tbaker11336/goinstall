import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
export const migrationsDir = join(here, "../../../supabase/migrations");
const shimPath = join(here, "../test/supabase-shim.sql");

/**
 * Apply the Supabase stand-in and every migration to an empty database.
 * For tests and local development without the Supabase CLI; hosted projects
 * are migrated with `supabase db push`.
 */
export async function applyMigrations(client: pg.Client, { shim = true } = {}): Promise<string[]> {
  if (shim) await client.query(await readFile(shimPath, "utf8"));
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await client.query(await readFile(join(migrationsDir, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return files;
}

/** Replace the database name in a Postgres connection string. */
export function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
