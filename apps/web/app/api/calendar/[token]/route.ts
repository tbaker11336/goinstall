import { BOOKING_TYPE_LABELS, icalFeed } from "@goinstall/core";
import { withService } from "@goinstall/db";
import { z } from "zod";
import { db } from "@/lib/db";
import { verifyCalendarToken } from "@/lib/schedule";

/**
 * A team's private iCal feed (Google, Outlook and Apple calendars subscribe
 * to the link). Signed per team; a new link from Settings revokes the old.
 */
export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const token = (await params).token.replace(/\.ics$/, "");
  const teamId = token.split(".")[0] ?? "";
  if (!z.uuid().safeParse(teamId).success) return new Response("Not found", { status: 404 });
  const result = await withService(db(), async (tx) => {
    const team = await tx.selectFrom("teams as t").innerJoin("companies as c", "c.id", "t.company_id").select(["t.id", "t.name", "t.company_id", "t.calendar_nonce", "c.name as company_name"]).where("t.id", "=", teamId).executeTakeFirst();
    if (!team || !verifyCalendarToken(token, () => team.calendar_nonce)) return null;
    const since = new Date(Date.now() - 60 * 86_400_000);
    const rows = await tx
      .selectFrom("bookings as b")
      .innerJoin("booking_assignments as a", (j) => j.onRef("a.booking_id", "=", "b.id").onRef("a.company_id", "=", "b.company_id"))
      .leftJoin("projects as p", (j) => j.onRef("p.id", "=", "b.project_id").onRef("p.company_id", "=", "b.company_id"))
      .leftJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
      .select(["b.id", "b.type", "b.status", "b.title", "b.starts_at", "b.ends_at", "b.all_day", "b.notes", "b.updated_at", "p.site_address_line1", "p.site_town", "p.site_postcode", "p.products", "c.name as contact_name", "c.phone"])
      .where("b.company_id", "=", team.company_id)
      .where("a.team_id", "=", team.id)
      .where("b.ends_at", ">", since)
      .execute();
    return icalFeed(`${team.company_name} · ${team.name}`, rows.map((r) => ({
      uid: `${r.id}@goinstall`,
      title: `${r.status === "tentative" ? "[Pencilled] " : ""}${r.type === "task" ? (r.title ?? "Task") : BOOKING_TYPE_LABELS[r.type]}${r.site_address_line1 ? ` · ${r.site_address_line1}` : ""}`,
      location: [r.site_address_line1, r.site_town, r.site_postcode].filter(Boolean).join(", ") || undefined,
      description: [r.contact_name, r.phone, r.products?.join(", "), r.notes].filter(Boolean).join("\n") || undefined,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      allDay: r.all_day,
      updatedAt: r.updated_at,
      cancelled: r.status === "cancelled",
    })));
  });
  if (!result) return new Response("Not found", { status: 404 });
  return new Response(result, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
}
