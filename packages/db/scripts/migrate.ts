// Apply the migrations a hosted database doesn't have yet, in order, each in
// its own transaction, recorded in supabase_migrations.schema_migrations
// (the same table the Supabase CLI uses, so staging and production agree).
// Runs in the production build: `DATABASE_URL` is the project's own. An
// empty product library is loaded too.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { loadProductLibrary } from "../src/library";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("migrate: DATABASE_URL is not set");
  process.exit(1);
}
const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../supabase/migrations");
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  await client.query("create schema if not exists supabase_migrations; create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text)");
  const done = new Set((await client.query<{ version: string }>("select version from supabase_migrations.schema_migrations")).rows.map((r) => r.version));
  const files = (await readdir(dir)).filter((f) => /^\d{14}_.+\.sql$/.test(f)).sort();
  let applied = 0;
  for (const f of files) {
    const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
    if (done.has(version!)) continue;
    const sql = await readFile(path.join(dir, f), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)", [version, rest.join("_")]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      console.error(`migrate: ${f} failed`);
      throw err;
    }
    applied++;
    console.log(`migrate: applied ${f}`);
  }
  console.log(`migrate: ${applied} applied, ${files.length - applied} already there`);
  // A new database also needs the shared product library (refresh it with load-library).
  const { rows } = await client.query<{ n: string }>("select count(*) as n from public.product_library");
  if (Number(rows[0]!.n) === 0) console.log(`migrate: ${await loadProductLibrary(client)} library products loaded`);
} finally {
  await client.end();
}
