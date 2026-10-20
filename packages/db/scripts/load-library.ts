// Load or refresh the shared product library in a database.
// Usage: DATABASE_URL=… pnpm --filter @goinstall/db load-library
import pg from "pg";
import { loadProductLibrary } from "../src/library";

const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/goinstall_dev" });
await db.connect();
console.log(`${await loadProductLibrary(db)} library products loaded.`);
await db.end();
