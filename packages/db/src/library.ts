// Load the shared product library (data/library-panels.json.gz, built by
// scripts/build-library.ts) into product_library. Idempotent: rows are
// matched on (source, make, model) and updated in place.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import type pg from "pg";

interface LibraryFile {
  source: string;
  version: string | null;
  products: { category: string; make: string; model: string; name: string; specs: Record<string, unknown> }[];
}

export function readLibraryFile(): LibraryFile {
  return JSON.parse(gunzipSync(readFileSync(new URL("../data/library-panels.json.gz", import.meta.url))).toString("utf8")) as LibraryFile;
}

/** Upsert statements in batches, as SQL text (for running through an API that takes plain SQL). */
export function librarySql(file: LibraryFile = readLibraryFile(), batch = 1500): string[] {
  const out: string[] = [];
  for (let i = 0; i < file.products.length; i += batch) {
    const rows = file.products.slice(i, i + batch).map((p) => ({ ...p, source: file.source, source_version: file.version }));
    const json = JSON.stringify(rows).replaceAll("'", "''");
    out.push(`insert into public.product_library (category, source, source_version, make, model, name, specs)
select category::public.product_category, source, source_version, make, model, name, specs
from jsonb_to_recordset('${json}'::jsonb) as r(category text, source text, source_version text, make text, model text, name text, specs jsonb)
on conflict (source, make, model) do update set name = excluded.name, specs = excluded.specs, source_version = excluded.source_version`);
  }
  return out;
}

export async function loadProductLibrary(client: pg.Client): Promise<number> {
  const file = readLibraryFile();
  for (const stmt of librarySql(file)) await client.query(stmt);
  return file.products.length;
}
