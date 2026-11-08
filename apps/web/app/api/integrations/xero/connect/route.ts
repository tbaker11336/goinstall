import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { tokenKeyConfigured } from "@/lib/token-crypto";
import { xeroAuth, xeroConfigured } from "@/lib/xero";

export const dynamic = "force-dynamic";

/** Admins start connecting Xero: off to Xero's sign-in with a one-time state. */
export async function GET() {
  const session = await requireSession(["admin"]);
  if (!xeroConfigured() || !tokenKeyConfigured()) redirect("/settings/integrations?xero=not-configured");
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("xero_oauth", `${state}.${session.companyId}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/integrations/xero" });
  redirect(xeroAuth().authorizeUrl(state));
}
