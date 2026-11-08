import { timingSafeEqual } from "node:crypto";
import { withService } from "@goinstall/db";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { asUser, requireSession } from "@/lib/auth";
import { backfillCalendar, calendarAuth, storeCalendarTokens } from "@/lib/calendar-sync";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Back from Google: save this person's calendar connection, then add their upcoming bookings. */
export async function GET(request: Request) {
  const session = await requireSession(["admin", "office", "installer", "subcontractor"]);
  const url = new URL(request.url);
  const jar = await cookies();
  const saved = jar.get("gcal_oauth")?.value ?? "";
  jar.delete({ name: "gcal_oauth", path: "/api/integrations/google-calendar" });
  const [state, userId] = saved.split(".");
  if (url.searchParams.get("error")) redirect("/my-calendar?google=cancelled");
  if (!state || userId !== session.userId || !same(state, url.searchParams.get("state") ?? "")) redirect("/my-calendar?google=expired");
  const code = url.searchParams.get("code");
  if (!code) redirect("/my-calendar?google=expired");
  let ok = true;
  try {
    const tokens = await calendarAuth().exchangeCode(code);
    const id = await asUser(
      async (tx) => {
        const settings = JSON.stringify({ email: tokens.email });
        const existing = await tx.selectFrom("integrations").select("id").where("provider", "=", "google_calendar").where("user_id", "=", session.userId).executeTakeFirst();
        if (existing) {
          await tx.updateTable("integrations").set({ status: "connected", settings }).where("id", "=", existing.id).execute();
          return existing.id;
        }
        return (await tx.insertInto("integrations").values({ provider: "google_calendar", user_id: session.userId, status: "connected", settings }).returning("id").executeTakeFirstOrThrow()).id;
      },
      ["admin", "office", "installer", "subcontractor"],
    );
    await withService(db(), (tx) => storeCalendarTokens(tx, id, session.companyId, tokens));
    // Their upcoming jobs go in straight away (a few seconds at most).
    await backfillCalendar(session.companyId, session.userId).catch((e) => console.error("calendar backfill", e));
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    ok = false;
  }
  redirect(ok ? "/my-calendar?google=connected" : "/my-calendar?google=failed");
}
