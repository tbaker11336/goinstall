import "server-only";
import { createDb, type Db } from "@goinstall/db";
import { env } from "./env";

const globalForDb = globalThis as unknown as { goinstallDb?: Db };

/** Server-side database handle; reused across hot reloads in development. */
export function db(): Db {
  globalForDb.goinstallDb ??= createDb({ connectionString: env.databaseUrl });
  return globalForDb.goinstallDb;
}
