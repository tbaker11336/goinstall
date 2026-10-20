// Recreate the local development database: Supabase stand-in, migrations and
// demo data. Usage: pnpm --filter @goinstall/db reset-dev [database-name]
import pg from "pg";
import { loadProductLibrary } from "../src/library";
import { applyMigrations, withDatabase } from "../src/migrate";
import { seed } from "../src/seed";

const adminUrl = process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/postgres";
const dbName = process.argv[2] ?? "goinstall_dev";

if (!/^[a-z_][a-z0-9_]*$/.test(dbName)) throw new Error(`Invalid database name: ${dbName}`);

const admin = new pg.Client({ connectionString: adminUrl });
await admin.connect();
await admin.query(`drop database if exists ${dbName} with (force)`);
await admin.query(`create database ${dbName}`);
await admin.end();

const url = withDatabase(adminUrl, dbName);
const db = new pg.Client({ connectionString: url });
await db.connect();
const files = await applyMigrations(db);
await seed(db);
const library = await loadProductLibrary(db);
await db.end();

console.log(`Reset ${dbName}: ${files.length} migrations applied, demo data seeded, ${library} library products.`);
console.log(`DATABASE_URL=${url}`);
