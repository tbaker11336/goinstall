"use server";

import { allDaySpan, BOOKING_TYPE_LABELS, bookingDates, firstName, surveyKindsFor } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { notifyBooking } from "@/lib/notify";
import { emailConfigured, emailSender, fromAddress } from "@/lib/email";
import { calendarFeedUrl, newCalendarNonce } from "@/lib/schedule";
import type { ActionResult } from "./crm";

const uuid = z.uuid();
const optionalId = z
  .union([z.literal(""), z.uuid()])
  .optional()
  .transform((v) => v || null);

const bookingSchema = z.object({
  type: z.enum(["survey", "install", "scaffold_up", "scaffold_down"]),
  start_date: z.iso.date("Choose a start date"),
  days: z.coerce.number().int().min(1, "At least one day").max(30),
  // Surveys have a time; other bookings are all day.
  start_time: z.union([z.literal(""), z.iso.time()]).optional(),
  team_id: optionalId,
  electrician_id: optionalId,
  scaffolder_id: optionalId,
  surveyor_id: optionalId,
  notes: z
    .string()
    .trim()
    .max(2000)
    .optional()
    .transform((v) => v || null),
});

async function setAssignment(tx: Tx, bookingId: string, role: "team" | "electrician" | "scaffolder" | "surveyor", target: { teamId?: string | null; userId?: string | null }) {
  await tx.deleteFrom("booking_assignments").where("booking_id", "=", bookingId).where("role", "=", role).execute();
  if (target.teamId || target.userId) {
    await tx.insertInto("booking_assignments").values({ booking_id: bookingId, role, team_id: target.teamId ?? null, user_id: target.userId ?? null }).execute();
  }
}

/** Create or update a booking for a project from the Install tab form (the keyboard alternative to dragging). */
export async function saveBookingAction(projectId: string, bookingId: string | null, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success || (bookingId && !uuid.safeParse(bookingId).success)) return { error: "Not found" };
  const parsed = bookingSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  const timed = d.type === "survey" && d.start_time;
  const span = timed
    ? { startsAt: new Date(`${d.start_date}T${d.start_time}:00${londonOffset(d.start_date)}`).toISOString(), endsAt: new Date(new Date(`${d.start_date}T${d.start_time}:00${londonOffset(d.start_date)}`).getTime() + 2 * 3_600_000).toISOString() }
    : allDaySpan(d.start_date, d.days);
  let saved: { companyId: string; bookingId: string; actor: string } | null = null;
  const result = await asUser(async (tx, session) => {
    const project = await tx.selectFrom("projects").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    let id = bookingId;
    if (id) {
      const b = await tx
        .updateTable("bookings")
        .set({ type: d.type, starts_at: new Date(span.startsAt), ends_at: new Date(span.endsAt), all_day: !timed, notes: d.notes })
        .where("id", "=", id)
        .where("project_id", "=", projectId)
        .returning("id")
        .executeTakeFirst();
      if (!b) return { error: "Booking not found" };
    } else {
      id = (
        await tx
          .insertInto("bookings")
          .values({ project_id: projectId, type: d.type, starts_at: new Date(span.startsAt), ends_at: new Date(span.endsAt), all_day: !timed, notes: d.notes })
          .returning("id")
          .executeTakeFirstOrThrow()
      ).id;
    }
    if (d.type === "install") {
      await setAssignment(tx, id, "team", { teamId: d.team_id });
      await setAssignment(tx, id, "electrician", { userId: d.electrician_id });
    } else if (d.type === "survey") {
      await setAssignment(tx, id, "surveyor", { userId: d.surveyor_id });
      // The installer app fills in each survey the project needs, so make sure they exist.
      const p = await tx.selectFrom("projects").select("products").where("id", "=", projectId).executeTakeFirstOrThrow();
      await tx
        .insertInto("surveys")
        .values(surveyKindsFor(p.products).map((kind) => ({ project_id: projectId, kind, site_visit_status: "booked" as const, site_visit_at: new Date(span.startsAt), surveyor_id: d.surveyor_id })))
        .onConflict((oc) => oc.columns(["company_id", "project_id", "kind"]).doUpdateSet({ site_visit_status: "booked", site_visit_at: new Date(span.startsAt), surveyor_id: d.surveyor_id }))
        .execute();
    } else {
      await setAssignment(tx, id, "scaffolder", { userId: d.scaffolder_id });
    }
    saved = { companyId: session.companyId, bookingId: id, actor: session.userId };
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/schedule");
    return { message: `${BOOKING_TYPE_LABELS[d.type]} booked ${bookingDates(span.startsAt, span.endsAt).length > 1 ? `for ${bookingDates(span.startsAt, span.endsAt).length} days` : ""}`.trim() + "." };
  });
  const sv = saved as { companyId: string; bookingId: string; actor: string } | null;
  if (sv) await notifyBooking(sv.companyId, sv.bookingId, sv.actor);
  return result;
}

/** "+01:00" in British Summer Time, "Z" otherwise, for a local date. */
function londonOffset(date: string) {
  const noon = new Date(`${date}T12:00:00Z`);
  const local = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(noon);
  return local === "13" ? "+01:00" : "Z";
}

/** Drag on the calendar: move a booking to a new first day (same length) and, for installs, a team row. */
export async function moveBookingAction(bookingId: string, firstDate: string, teamId: string | null): Promise<ActionResult> {
  if (!uuid.safeParse(bookingId).success || !z.iso.date().safeParse(firstDate).success || (teamId && !uuid.safeParse(teamId).success)) return { error: "Not found" };
  const moved = await asUser(async (tx, session) => {
    const b = await tx.selectFrom("bookings").select(["id", "type", "starts_at", "ends_at", "all_day", "project_id"]).where("id", "=", bookingId).executeTakeFirst();
    if (!b) return { error: "Booking not found" };
    const shift = Date.parse(`${firstDate}T00:00:00Z`) - Date.parse(`${b.starts_at.toISOString().slice(0, 10)}T00:00:00Z`);
    await tx
      .updateTable("bookings")
      .set({ starts_at: new Date(b.starts_at.getTime() + shift), ends_at: new Date(b.ends_at.getTime() + shift), customer_confirmed_at: null })
      .where("id", "=", bookingId)
      .execute();
    if (teamId && b.type === "install") await setAssignment(tx, bookingId, "team", { teamId });
    if (b.project_id) revalidatePath(`/projects/${b.project_id}`, "layout");
    revalidatePath("/schedule");
    return { companyId: session.companyId, actor: session.userId };
  });
  if ("companyId" in moved && moved.companyId) await notifyBooking(moved.companyId, bookingId, moved.actor ?? null);
  return "error" in moved ? { error: moved.error } : {};
}

export async function cancelBookingAction(bookingId: string): Promise<ActionResult> {
  if (!uuid.safeParse(bookingId).success) return { error: "Not found" };
  return asUser(async (tx) => {
    const b = await tx.updateTable("bookings").set({ status: "cancelled" }).where("id", "=", bookingId).returning("project_id").executeTakeFirst();
    if (!b) return { error: "Booking not found" };
    if (b.project_id) revalidatePath(`/projects/${b.project_id}`, "layout");
    revalidatePath("/schedule");
    return { message: "Booking cancelled." };
  });
}

/** The customer said yes to the dates (by phone, email or message). */
export async function markCustomerConfirmedAction(projectId: string, confirmed: boolean): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Not found" };
  return asUser(async (tx) => {
    await tx
      .updateTable("bookings")
      .set({ customer_confirmed_at: confirmed ? sql<Date>`now()` : null })
      .where("project_id", "=", projectId)
      .where("status", "!=", "cancelled")
      .where("type", "in", ["install", "scaffold_up", "scaffold_down"])
      .execute();
    revalidatePath(`/projects/${projectId}`, "layout");
    return {};
  });
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" });

/**
 * "Confirm and notify customer": bookings become confirmed (so they show in
 * team calendar feeds as confirmed), the customer is emailed the dates, and
 * the project moves to Scheduled.
 */
export async function confirmAndNotifyAction(projectId: string): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Not found" };
  return asUser(async (tx, session) => {
    const p = await tx
      .selectFrom("projects as p")
      .innerJoin("contacts as c", "c.id", "p.contact_id")
      .innerJoin("companies as co", "co.id", "p.company_id")
      .select(["p.id", "p.stage", "p.site_address_line1", "c.id as contact_id", "c.name", "c.email", "co.name as company_name", "co.email as company_email", "co.email_sender"])
      .where("p.id", "=", projectId)
      .executeTakeFirst();
    if (!p) return { error: "Project not found" };
    const bookings = await tx
      .selectFrom("bookings")
      .select(["id", "type", "starts_at", "ends_at"])
      .where("project_id", "=", projectId)
      .where("status", "in", ["tentative", "confirmed"])
      .where("type", "in", ["install", "scaffold_up", "scaffold_down"])
      .orderBy("starts_at")
      .execute();
    const install = bookings.find((b) => b.type === "install");
    if (!install) return { error: "Book the install first." };
    const team = await tx.selectFrom("booking_assignments").select("team_id").where("booking_id", "=", install.id).where("role", "=", "team").executeTakeFirst();
    if (!team?.team_id) return { error: "Choose the install team first." };
    if (!p.email) return { error: `${p.name} has no email address. Add one on the contact page.` };

    const lines = bookings.map((b) => {
      const days = bookingDates(b.starts_at, b.ends_at);
      const when = days.length > 1 ? `${fmtDay(days[0]!)} to ${fmtDay(days.at(-1)!)}` : fmtDay(days[0]!);
      return `${b.type === "install" ? "Installation" : BOOKING_TYPE_LABELS[b.type]}: ${when}`;
    });
    const subject = `Your installation dates with ${p.company_name}`;
    const body = `Hi ${firstName(p.name)},\n\nWe're booked in at ${p.site_address_line1 ?? "your home"}:\n\n${lines.join("\n")}\n\nThe team usually arrives between 8 and 9am. If these dates no longer work, just reply to this email.\n\n${session.fullName}\n${p.company_name}`;
    await tx.updateTable("bookings").set({ status: "confirmed", customer_notified_at: sql<Date>`now()` }).where("id", "in", bookings.map((b) => b.id)).execute();
    if (["accepted", "deposit_paid", "kit_ordered"].includes(p.stage)) await tx.updateTable("projects").set({ stage: "scheduled" }).where("id", "=", projectId).execute();
    const m = await tx
      .insertInto("messages")
      .values({ contact_id: p.contact_id, project_id: projectId, channel: "email", direction: "outbound", subject, body, sent_by: session.userId, to_address: p.email, delivery_status: "queued" })
      .returning("id")
      .executeTakeFirstOrThrow();
    const r = await emailSender().send({ from: fromAddress(p.company_name, p.email_sender), to: p.email, replyTo: session.email || p.company_email || undefined, subject, text: body, html: textToHtml(body), idempotencyKey: m.id, tags: { kind: "booking_confirmation" } });
    await tx
      .updateTable("messages")
      .set(r.ok ? { delivery_status: "sent", provider_message_id: r.providerId } : { delivery_status: "failed", delivery_error: r.error })
      .where("id", "=", m.id)
      .execute();
    await tx.insertInto("activity_log").values({ project_id: projectId, contact_id: p.contact_id, actor_id: session.userId, event: "booking_confirmed", payload: { bookings: bookings.length } }).execute();
    revalidatePath(`/projects/${projectId}`, "layout");
    revalidatePath("/schedule");
    if (!r.ok) return { error: `Bookings confirmed, but the email wasn't sent: ${r.error}` };
    return { message: `Bookings confirmed. ${emailConfigured() ? `Dates emailed to ${p.email}.` : "Email recorded (sending isn't set up here)."} Team calendars update from their feed links.` };
  });
}

/** The team's private calendar feed link (created on first use; "new link" revokes the old one). */
export async function teamCalendarLinkAction(teamId: string, rotate = false): Promise<{ url?: string; error?: string }> {
  if (!uuid.safeParse(teamId).success) return { error: "Team not found" };
  return asUser(async (tx) => {
    const t = await tx.selectFrom("teams").select(["id", "calendar_nonce"]).where("id", "=", teamId).executeTakeFirst();
    if (!t) return { error: "Team not found" };
    let nonce = t.calendar_nonce;
    if (!nonce || rotate) {
      nonce = newCalendarNonce();
      await tx.updateTable("teams").set({ calendar_nonce: nonce }).where("id", "=", teamId).execute();
    }
    revalidatePath("/schedule");
    return { url: calendarFeedUrl(teamId, nonce) };
  }, ["admin"]);
}
