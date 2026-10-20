import pg from "pg";
import type { TestProject } from "vitest/node";
import { applyMigrations, withDatabase } from "../src/migrate";

// A superuser connection to any database on the server. Each run creates and
// drops its own database, so this can point at a shared local Postgres.
const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";

export default async function setup(project: TestProject) {
  const dbName = `goinstall_test_${process.pid}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`drop database if exists ${dbName}`);
  await admin.query(`create database ${dbName}`);

  const url = withDatabase(adminUrl, dbName);
  const db = new pg.Client({ connectionString: url });
  await db.connect();
  await applyMigrations(db);
  await db.end();

  project.provide("testDatabaseUrl", url);

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
