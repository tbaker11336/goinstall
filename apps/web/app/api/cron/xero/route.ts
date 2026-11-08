import { timingSafeEqual } from "node:crypto";
import { withService } from "@goinstall/db";
import { db } from "@/lib/db";
import { pullXeroPayments } from "@/lib/xero";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Daily (vercel.json): payments made in Xero come back as paid invoices here. */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return Response.json({ error: "CRON_SECRET isn't set" }, { status: 503 });
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return Response.json({ error: "Unauthorised" }, { status: 401 });
  const companies = await withService(db(), (tx) => tx.selectFrom("integrations").select("company_id").where("provider", "=", "xero").where("user_id", "is", null).where("status", "=", "connected").execute());
  const results: Record<string, unknown> = {};
  for (const c of companies) results[c.company_id] = await pullXeroPayments(c.company_id).catch((e) => ({ error: String(e) }));
  return Response.json({ companies: companies.length, results });
}
