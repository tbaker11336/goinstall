import "server-only";
import { channelsFor, eventDef, normaliseSettings, notificationText, type MessageData, type NotificationEventKey } from "@goinstall/core";
import { withService, type Tx } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { db } from "./db";
import { emailSender, fromAddress } from "./email";
import { env } from "./env";
import { pushToUsers } from "./push";
import { activeSms, sendSms } from "./sms";

/**
 * Notifications go out after the change that caused them has been saved,
 * from a service connection (staff can't write each other's notifications).
 * Every query names the company. A failure is logged, never thrown: a
 * notification must not undo the change it reports.
 */

type Internal = Extract<NotificationEventKey, "new_enquiry" | "survey_completed" | "proposal_viewed" | "proposal_accepted" | "payment_received" | "job_assigned" | "job_accepted" | "job_declined" | "kit_issue" | "job_completed" | "customer_reply" | "team_message">;
type External = Extract<NotificationEventKey, "survey_reminder" | "proposal_reminder" | "install_reminder" | "on_my_way">;

async function companyFor(tx: Tx, companyId: string) {
  const c = await tx.selectFrom("companies").select(["name", "email", "email_sender", "notification_settings"]).where("id", "=", companyId).executeTakeFirstOrThrow();
  return { ...c, settings: normaliseSettings(c.notification_settings), smsActive: Boolean(await activeSms(tx, companyId)) };
}

const defined = <T extends object>(o: T | undefined) => Object.fromEntries(Object.entries(o ?? {}).filter(([, v]) => v !== undefined)) as Partial<T>;

const absolute = (link: string | null) => (link ? `${env.siteUrl.replace(/\/$/, "")}${link}` : null);

/** Who hears about a project event: its owner, else the admins and office staff. */
async function projectRecipients(tx: Tx, companyId: string, projectId: string | null): Promise<string[]> {
  if (projectId) {
    const p = await tx
      .selectFrom("projects as p")
      .innerJoin("users as u", (j) => j.onRef("u.id", "=", "p.owner_id").onRef("u.company_id", "=", "p.company_id"))
      .select("u.id")
      .where("p.id", "=", projectId)
      .where("p.company_id", "=", companyId)
      .where("u.is_active", "=", true)
      .executeTakeFirst();
    if (p) return [p.id];
  }
  return (await tx.selectFrom("users").select("id").where("company_id", "=", companyId).where("is_active", "=", true).where("role", "in", ["admin", "office"]).execute()).map((u) => u.id);
}

/** The customer's name and the site, for the team's messages about a project. */
async function projectWords(tx: Tx, companyId: string, projectId: string | null): Promise<Partial<MessageData>> {
  if (!projectId) return {};
  const p = await tx
    .selectFrom("projects as p")
    .innerJoin("contacts as c", (j) => j.onRef("c.id", "=", "p.contact_id").onRef("c.company_id", "=", "p.company_id"))
    .select(["c.name", "p.site_address_line1", "p.site_town"])
    .where("p.id", "=", projectId)
    .where("p.company_id", "=", companyId)
    .executeTakeFirst();
  if (!p) return {};
  const site = [p.site_address_line1, p.site_town].filter(Boolean).join(", ");
  return { customerName: p.name, ...(site ? { site } : {}) };
}

/** Tell the team: in the app, by email and by text, as the company chose for this event. */
export async function notifyTeam(
  companyId: string,
  event: Internal,
  p: { projectId?: string | null; link?: string | null; data?: Partial<MessageData>; recipients?: string[]; exclude?: string | null },
): Promise<void> {
  try {
    await withService(db(), async (tx) => {
      const c = await companyFor(tx, companyId);
      const channels = channelsFor(c.settings, event, { smsActive: c.smsActive });
      if (!channels.length) return;
      const ids = (p.recipients ?? (await projectRecipients(tx, companyId, p.projectId ?? null))).filter((id) => id !== p.exclude);
      if (!ids.length) return;
      const users = await tx.selectFrom("users").select(["id", "email", "phone", "full_name"]).where("company_id", "=", companyId).where("id", "in", ids).where("is_active", "=", true).execute();
      const text = notificationText(event, { companyName: c.name, ...(await projectWords(tx, companyId, p.projectId ?? null)), ...defined(p.data) });
      const link = p.link ?? (p.projectId ? `/projects/${p.projectId}` : null);
      const pushes: Parameters<typeof pushToUsers>[2] = [];
      for (const u of users) {
        if (channels.includes("in_app")) {
          await tx.insertInto("notifications").values({ company_id: companyId, user_id: u.id, event, title: text.title, body: text.body, link, project_id: p.projectId ?? null, created_by: null }).execute();
          // In-app also means the phone, for anyone signed in to the installer app.
          pushes.push({ userId: u.id, title: text.title, body: text.body, data: { event, ...(p.projectId ? { projectId: p.projectId } : {}) } });
        }
        if (channels.includes("email") && u.email) {
          const url = absolute(link);
          const body = `${text.body}${url ? `\n\n${url}` : ""}`;
          await emailSender().send({ from: fromAddress(c.name, c.email_sender), to: u.email, subject: text.title, text: body, html: textToHtml(body), tags: { kind: `notify_${event}` } });
        }
        if (channels.includes("sms")) await sendSms(tx, { companyId, to: u.phone, body: text.sms });
      }
      await pushToUsers(tx, companyId, pushes);
    });
  } catch (err) {
    console.error(`notifyTeam ${event} failed`, err);
  }
}

/**
 * Tell the customer, by email and/or text as the company chose. With
 * `once`, the log makes sure each reminder step goes only once.
 */
export async function notifyCustomer(
  tx: Tx,
  companyId: string,
  event: External,
  p: { contactId: string; projectId: string | null; data: Partial<MessageData>; once?: { entityId: string; step: number }; sentBy?: string | null },
): Promise<{ sent: string[]; skipped?: string }> {
  const c = await companyFor(tx, companyId);
  const channels = channelsFor(c.settings, event, { smsActive: c.smsActive });
  if (!channels.length) return { sent: [], skipped: "No channels chosen" };
  if (p.once) {
    const claimed = await tx
      .insertInto("notification_log")
      .values({ company_id: companyId, event, entity_id: p.once.entityId, step: p.once.step, channels, project_id: p.projectId, created_by: null })
      .onConflict((oc) => oc.doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!claimed) return { sent: [], skipped: "Already sent" };
  }
  const contact = await tx.selectFrom("contacts").select(["name", "email", "phone"]).where("id", "=", p.contactId).where("company_id", "=", companyId).executeTakeFirstOrThrow();
  const text = notificationText(event, { companyName: c.name, customerFirstName: contact.name.split(/\s+/)[0], ...p.data });
  const sent: string[] = [];
  if (channels.includes("email") && contact.email) {
    const m = await tx
      .insertInto("messages")
      .values({ company_id: companyId, contact_id: p.contactId, project_id: p.projectId, channel: "email", direction: "outbound", subject: text.title, body: text.body, to_address: contact.email, sent_by: p.sentBy ?? null, delivery_status: "queued", created_by: p.sentBy ?? null })
      .returning("id")
      .executeTakeFirstOrThrow();
    const r = await emailSender().send({ from: fromAddress(c.name, c.email_sender), to: contact.email, replyTo: c.email ?? undefined, subject: text.title, text: text.body, html: textToHtml(text.body), idempotencyKey: m.id, tags: { kind: event } });
    await tx.updateTable("messages").set(r.ok ? { delivery_status: "sent", provider_message_id: r.providerId } : { delivery_status: "failed", delivery_error: r.error }).where("id", "=", m.id).execute();
    if (r.ok) sent.push("email");
  }
  if (channels.includes("sms")) {
    const r = await sendSms(tx, { companyId, to: contact.phone, body: text.sms, contactId: p.contactId, projectId: p.projectId, sentBy: p.sentBy });
    if (r.ok) sent.push("sms");
  }
  return { sent };
}

export const eventLabel = (key: string) => eventDef(key)?.label ?? key;

/** A job was booked, moved or reassigned: tell the people on it (named, or through their team). */
export async function notifyBooking(companyId: string, bookingId: string, actorId: string | null): Promise<void> {
  try {
    const info = await withService(db(), async (tx) => {
      const b = await tx
        .selectFrom("bookings as b")
        .leftJoin("projects as p", (j) => j.onRef("p.id", "=", "b.project_id").onRef("p.company_id", "=", "b.company_id"))
        .select(["b.id", "b.type", "b.starts_at", "b.status", "b.project_id", "p.site_address_line1", "p.site_town"])
        .where("b.id", "=", bookingId)
        .where("b.company_id", "=", companyId)
        .executeTakeFirst();
      if (!b || b.status === "cancelled") return null;
      const a = await tx.selectFrom("booking_assignments").select(["user_id", "team_id"]).where("booking_id", "=", bookingId).where("company_id", "=", companyId).execute();
      const teams = a.map((x) => x.team_id).filter((x): x is string => Boolean(x));
      const members = teams.length ? (await tx.selectFrom("users").select("id").where("company_id", "=", companyId).where("team_id", "in", teams).execute()).map((u) => u.id) : [];
      const recipients = [...new Set([...a.map((x) => x.user_id).filter((x): x is string => Boolean(x)), ...members])];
      return { b, recipients };
    });
    if (!info?.recipients.length) return;
    const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short", day: "numeric", month: "short" }).format(info.b.starts_at);
    await notifyTeam(companyId, "job_assigned", {
      projectId: info.b.project_id,
      recipients: info.recipients,
      exclude: actorId,
      link: info.b.project_id ? `/projects/${info.b.project_id}/install` : null,
      data: { site: [info.b.site_address_line1, info.b.site_town].filter(Boolean).join(", ") || undefined, when },
    });
  } catch (err) {
    console.error("notifyBooking failed", err);
  }
}
