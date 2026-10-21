import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { checkGoogle } from "@/lib/google-check";

export const dynamic = "force-dynamic";

/** Admins: the Google key check as JSON (the same check as Settings › Design rules). */
export async function GET() {
  await requireAdmin();
  const c = await checkGoogle();
  return NextResponse.json(c, { status: c.key === "set" && c.results.every((r) => r.ok) ? 200 : 502 });
}
