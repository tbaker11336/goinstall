"use server";

import { randomUUID } from "node:crypto";
import { allDaySpan, BOOKING_TYPE_LABELS, bookingDates, bookingTitle, firstName, needsScaffold, surveyKindsFor } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { emailConfigured, emailSender, fromAddress } from "@/lib/email";
import { notifyBooking } from "@/lib/notify";
import { calendarFeedUrl, newCalendarNonce } from "@/lib/schedule";
import { sendSms } from "@/lib/sms";
import { notifyChat, saveChatMessage } from "@/lib/team-chat";
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
    const project = await tx.selectFrom("projects").select(["id", "products"]).where("id", "=", projectId).executeTakeFirst();
    if (!project) return { error: "Project not found" };
    if ((d.type === "scaffold_up" || d.type === "scaffold_down") && !needsScaffold(project.products)) return { error: "Scaffold is only booked for solar projects." };
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

const rescheduleSchema = z.object({
  date: z.iso.date("Choose a date"),
  // Timed bookings (surveys) keep their length and move to this time.
  time: z.union([z.literal(""), z.iso.time()]).optional(),
  team_id: optionalId,
});

/** Calendar › event › Reschedule: a new date (and time, for timed bookings), and for installs the team. */
export async function rescheduleBookingAction(bookingId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(bookingId).success) return { error: "Booking not found" };
  const parsed = rescheduleSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const { date, time, team_id } = parsed.data;
  const done = await asUser(async (tx, session) => {
    const b = await tx.selectFrom("bookings").select(["id", "type", "starts_at", "ends_at", "all_day", "project_id"]).where("id", "=", bookingId).executeTakeFirst();
    if (!b) return { error: "Booking not found" };
    let startsAt: Date;
    let endsAt: Date;
    if (b.all_day) {
      // Same number of working days from the new first date.
      const days = bookingDates(b.starts_at, b.ends_at).filter((d) => ![0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())).length || 1;
      const span = allDaySpan(date, days);
      startsAt = new Date(span.startsAt);
      endsAt = new Date(span.endsAt);
    } else {
      const hhmm = time || new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false }).format(b.starts_at);
      startsAt = new Date(`${date}T${hhmm}:00${londonOffset(date)}`);
      endsAt = new Date(startsAt.getTime() + (b.ends_at.getTime() - b.starts_at.getTime()));
    }
    await tx.updateTable("bookings").set({ starts_at: startsAt, ends_at: endsAt, customer_confirmed_at: null }).where("id", "=", bookingId).execute();
    if (b.type === "install" && form.has("team_id")) await setAssignment(tx, bookingId, "team", { teamId: team_id });
    if (b.project_id) revalidatePath(`/projects/${b.project_id}`, "layout");
    revalidatePath("/schedule");
    return { companyId: session.companyId, actor: session.userId };
  });
  if ("error" in done) return { error: done.error };
  await notifyBooking(done.companyId, bookingId, done.actor);
  return { message: "Moved. Let the customer know with Notify customer." };
}

/** Calendar › event › Notify customer: email (and text, with the SMS add-on) the date of this one booking. */
export async function notifyBookingCustomerAction(bookingId: string): Promise<ActionResult> {
  if (!uuid.safeParse(bookingId).success) return { error: "Booking not found" };
  return asUser(async (tx, session) => {
    const b = await tx
      .selectFrom("bookings as b")
      .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "b.project_id").onRef("p.company_id", "=", "b.company_id"))
      .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
      .innerJoin("companies as co", "co.id", "b.company_id")
      .select(["b.id", "b.type", "b.starts_at", "b.ends_at", "b.all_day", "b.title", "p.id as project_id", "p.products", "p.site_address_line1", "c.id as contact_id", "c.name", "c.email", "c.phone", "co.id as company_id", "co.name as company_name", "co.email as company_email", "co.email_sender"])
      .where("b.id", "=", bookingId)
      .executeTakeFirst();
    if (!b) return { error: "This booking isn't for a customer's project." };
    const days = bookingDates(b.starts_at, b.ends_at);
    const time = b.all_day ? null : new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true }).format(b.starts_at).replace(" ", "");
    const when = days.length > 1 ? `${fmtDay(days[0]!)} to ${fmtDay(days.at(-1)!)}` : `${fmtDay(days[0]!)}${time ? ` at ${time}` : ""}`;
    const what = bookingTitle(b.type, b.products ?? [], b.title);
    // "your solar installation", "your EV charger installation".
    const thing = what.startsWith("EV") ? what : `${what[0]!.toLowerCase()}${what.slice(1)}`;
    const subject = `${what}: ${when}`;
    const arrival = b.type === "survey" ? "" : b.all_day ? " The team usually arrives between 8 and 9am." : "";
    const body = `Hi ${firstName(b.name)},\n\nYour ${thing} at ${b.site_address_line1 ?? "your home"} is booked for ${when}.${arrival} If that no longer works, just reply to this email.\n\n${session.fullName}\n${b.company_name}`;
    const sent: string[] = [];
    if (b.email) {
      const m = await tx
        .insertInto("messages")
        .values({ contact_id: b.contact_id, project_id: b.project_id, channel: "email", direction: "outbound", subject, body, sent_by: session.userId, to_address: b.email, delivery_status: "queued" })
        .returning("id")
        .executeTakeFirstOrThrow();
      const r = await emailSender().send({ from: fromAddress(b.company_name, b.email_sender), to: b.email, replyTo: session.email || b.company_email || undefined, subject, text: body, html: textToHtml(body), idempotencyKey: m.id, tags: { kind: "booking_notice" } });
      await tx.updateTable("messages").set(r.ok ? { delivery_status: "sent", provider_message_id: r.providerId } : { delivery_status: "failed", delivery_error: r.error }).where("id", "=", m.id).execute();
      if (r.ok) sent.push(emailConfigured() ? `emailed ${b.email}` : "email recorded (sending isn't set up here)");
    }
    const text = await sendSms(tx, { companyId: b.company_id, to: b.phone, body: `${b.company_name}: your ${thing} is booked for ${when}. Reply to this number if that doesn't work.`, contactId: b.contact_id, projectId: b.project_id, sentBy: session.userId });
    if (text.ok) sent.push("texted");
    if (!sent.length) return { error: `${b.name} has no email address${b.phone ? "" : " or mobile number"}. Add one on the contact page.` };
    await tx.updateTable("bookings").set({ customer_notified_at: sql<Date>`now()` }).where("id", "=", bookingId).execute();
    await tx.insertInto("activity_log").values({ project_id: b.project_id, contact_id: b.contact_id, actor_id: session.userId, event: "booking_notified", payload: { booking: bookingId, type: b.type } }).execute();
    revalidatePath("/schedule");
    revalidatePath(`/projects/${b.project_id}`, "layout");
    return { message: `${b.name} ${sent.join(" and ")}.` };
  });
}

/** Install tab › Messages with the team: the office writes to the people on the job. */
export async function sendTeamMessageAction(projectId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!uuid.safeParse(projectId).success) return { error: "Project not found" };
  const body = z.string().trim().min(1, "Write a message").max(2000, "Keep it under 2,000 characters").safeParse(form.get("body") ?? "");
  if (!body.success) return { error: body.error.issues[0]?.message };
  const sent = await asUser(async (tx, session) => {
    const p = await tx.selectFrom("projects").select("id").where("id", "=", projectId).executeTakeFirst();
    if (!p) return null;
    await saveChatMessage(tx, { id: randomUUID(), projectId, authorId: session.userId, body: body.data, sentAt: new Date() });
    return { companyId: session.companyId, author: { id: session.userId, name: session.fullName, staff: true } };
  });
  if (!sent) return { error: "Project not found" };
  await notifyChat(sent.companyId, projectId, sent.author, body.data);
  revalidatePath(`/projects/${projectId}/install`);
  return { message: "Sent." };
}
