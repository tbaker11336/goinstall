import { readdir, readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import type { TestProject } from "vitest/node";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "../../../supabase/migrations");

// A superuser connection to any database on the server. Each run creates and
// drops its own database, so this can point at a shared local Postgres.
const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

export default async function setup(project: TestProject) {
  const dbName = `goinstall_test_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);

  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const db = new pg.Client({ connectionString: url.toString() });
  await db.connect();
  await db.query(await readFile(join(here, "supabase-shim.sql"), "utf8"));
  const migrations = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();
  for (const file of migrations) {
    try {
      await db.query(await readFile(join(migrationsDir, file), "utf8"));
    } catch (err) {
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  await db.end();

  project.provide("testDatabaseUrl", url.toString());

  return async () => {
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
  }
}
