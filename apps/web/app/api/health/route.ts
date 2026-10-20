import { sql } from "@goinstall/db";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Deployment health check: can the server reach the database? Reports only
 * an error code and class, never connection details.
 */
export async function GET() {
  const checks: Record<string, string> = {
    database_url: process.env.DATABASE_URL ? "set" : "missing",
    service_role_key: process.env.SUPABASE_SERVICE_ROLE_KEY ? "set" : "missing",
  };
  try {
    await sql`select 1`.execute(db());
    checks.database = "ok";
  } catch (err) {
    const e = err as { code?: string; name?: string };
    // e.g. 28P01 bad password, ENOTFOUND bad host, ECONNREFUSED/ETIMEDOUT unreachable, ERR_INVALID_URL malformed URL.
    checks.database = `error ${e.code ?? e.name ?? "unknown"}`;
  }
  return NextResponse.json(checks, { status: checks.database === "ok" ? 200 : 503 });
}
