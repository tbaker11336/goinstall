import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { calendarAuth, calendarConfigured } from "@/lib/calendar-sync";
import { tokenKeyConfigured } from "@/lib/token-crypto";

export const dynamic = "force-dynamic";

/** Anyone signed in connects their own Google Calendar. */
export async function GET() {
  const session = await requireSession(["admin", "office", "installer", "subcontractor"]);
  if (!calendarConfigured() || !tokenKeyConfigured()) redirect("/my-calendar?google=not-configured");
  const state = randomBytes(24).toString("base64url");
  (await cookies()).set("gcal_oauth", `${state}.${session.userId}`, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: 600, path: "/api/integrations/google-calendar" });
  redirect(calendarAuth().authorizeUrl(state));
}
