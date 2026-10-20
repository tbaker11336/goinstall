import { Kysely, PostgresDialect, sql, type Transaction } from "kysely";
import pg from "pg";
import { parse as parseArray } from "postgres-array";
import type { DB } from "./schema";

export type * from "./schema";
export type { DB } from "./schema";
export { sql };

export type Db = Kysely<DB>;
export type Tx = Transaction<DB>;

// node-postgres only parses arrays of built-in types; arrays of our enums
// (e.g. projects.products) would otherwise arrive as "{solar,ev}".
const ENUM_ARRAY_TYPES = ["_app_role", "_product_type", "_contact_stage", "_project_stage", "_message_channel", "_message_direction"];

async function registerEnumArrayParsers(pool: pg.Pool) {
  const { rows } = await pool.query<{ oid: number }>(
    "select t.oid from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = any($1)",
    [ENUM_ARRAY_TYPES],
  );
  for (const { oid } of rows) pg.types.setTypeParser(oid, (v: string) => parseArray(v));
}

export interface CreateDbOptions {
  connectionString: string;
  max?: number;
}

/**
 * Create a Kysely instance over a pg pool. Server-side only: the connection
 * role can bypass RLS, so every request on behalf of a user must go through
 * withUser().
 */
export function createDb({ connectionString, max = 10 }: CreateDbOptions): Db {
  const pool = new pg.Pool({ connectionString, max });
  const ready = registerEnumArrayParsers(pool);
  const dialect = new PostgresDialect({
    pool: async () => {
      await ready;
      return pool;
    },
  });
  return new Kysely<DB>({ dialect });
}

/**
 * Run fn in a transaction as the given Supabase user, the same way PostgREST
 * does: role `authenticated` with the JWT claims set, so RLS policies and
 * auth.uid() apply. Works through Supavisor in transaction mode because the
 * settings are transaction-local.
 */
export async function withUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(async (tx) => {
    await sql`select set_config('role', 'authenticated', true),
                     set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role: "authenticated" })}, true)`.execute(tx);
    return fn(tx);
  });
}

/**
 * Run fn in a transaction with full access (service role). Only for trusted
 * server code that has done its own checks: onboarding, webhooks, public
 * token routes, imports.
 */
export async function withService<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().execute(fn);
}

/** Postgres error code from a thrown error, if any. */
export function pgErrorCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && "code" in err ? String((err as { code: unknown }).code) : undefined;
}
