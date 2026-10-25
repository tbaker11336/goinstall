import "server-only";
import { installReminderDue, normaliseSettings, proposalRemindersDue, surveyReminderDue, SURVEY_KINDS, type SurveyKind } from "@goinstall/core";
import { withService } from "@goinstall/db";
import { db } from "./db";
import { notifyCustomer } from "./notify";
import { proposalToken, proposalUrl } from "./proposals";
import { surveyToken, surveyUrl } from "./survey";

/**
 * The daily reminders job (Vercel cron): survey, proposal and install
 * reminders for every company that has set its timings. Each reminder step
 * is logged, so a rerun or an overlapping run never sends it twice.
 */
export async function runReminders(now = new Date()): Promise<{ sent: number; companies: number }> {
  const companies = await withService(db(), (tx) => tx.selectFrom("companies").select(["id", "notification_settings"]).execute());
  let sent = 0;
  let active = 0;
  for (const c of companies) {
    const { reminders } = normaliseSettings(c.notification_settings);
    if (reminders.surveyDays === null && !reminders.proposalDays.length && reminders.installDaysBefore === null) continue;
    active++;
    try {
      sent += await withService(db(), async (tx) => {
        let n = 0;
        const count = (r: { sent: string[] }) => (n += r.sent.length ? 1 : 0);

        if (reminders.surveyDays !== null) {
          const surveys = await tx
            .selectFrom("surveys as s")
            .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "s.project_id").onRef("p.company_id", "=", "s.company_id"))
            .select(["s.id", "s.kind", "s.sent_at", "s.link_nonce", "s.token_expires_at", "p.id as project_id", "p.contact_id", "p.stage"])
            .where("s.company_id", "=", c.id)
            .where("s.online_status", "in", ["sent", "in_progress"])
            .where("s.sent_at", "is not", null)
            .where("s.link_nonce", "is not", null)
            .where("s.token_expires_at", ">", now)
            .execute();
          for (const s of surveys) {
            if (s.stage === "lost" || !surveyReminderDue(s.sent_at!, now, reminders.surveyDays)) continue;
            count(
              await notifyCustomer(tx, c.id, "survey_reminder", {
                contactId: s.contact_id,
                projectId: s.project_id,
                once: { entityId: s.id, step: 0 },
                data: { link: surveyUrl(surveyToken(s.id, s.link_nonce!)), detail: SURVEY_KINDS[s.kind as SurveyKind].label },
              }),
            );
          }
        }

        if (reminders.proposalDays.length) {
          const proposals = await tx
            .selectFrom("proposals as pr")
            .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "pr.project_id").onRef("p.company_id", "=", "pr.company_id"))
            .select(["pr.id", "pr.sent_at", "pr.link_nonce", "pr.token_expires_at", "p.id as project_id", "p.contact_id", "p.stage"])
            .where("pr.company_id", "=", c.id)
            .where("pr.status", "in", ["sent", "viewed"])
            .where("pr.sent_at", "is not", null)
            .where("pr.link_nonce", "is not", null)
            .execute();
          for (const pr of proposals) {
            if (pr.stage === "lost" || (pr.token_expires_at && pr.token_expires_at < now)) continue;
            const done = (await tx.selectFrom("notification_log").select("step").where("company_id", "=", c.id).where("event", "=", "proposal_reminder").where("entity_id", "=", pr.id).execute()).map((r) => r.step);
            const step = proposalRemindersDue(pr.sent_at!, now, reminders.proposalDays, done);
            if (step === null) continue;
            count(await notifyCustomer(tx, c.id, "proposal_reminder", { contactId: pr.contact_id, projectId: pr.project_id, once: { entityId: pr.id, step }, data: { link: proposalUrl(proposalToken(pr.id, pr.link_nonce!)) } }));
          }
        }

        if (reminders.installDaysBefore !== null) {
          const bookings = await tx
            .selectFrom("bookings as b")
            .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "b.project_id").onRef("p.company_id", "=", "b.company_id"))
            .select(["b.id", "b.starts_at", "p.id as project_id", "p.contact_id", "p.site_address_line1"])
            .where("b.company_id", "=", c.id)
            .where("b.type", "=", "install")
            .where("b.status", "in", ["tentative", "confirmed"])
            .where("b.starts_at", ">", now)
            .where("b.starts_at", "<", new Date(now.getTime() + 16 * 86_400_000))
            .execute();
          for (const b of bookings) {
            if (!installReminderDue(b.starts_at, now, reminders.installDaysBefore)) continue;
            const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "long", day: "numeric", month: "long" }).format(b.starts_at);
            // Keyed on the date too: a moved install gets a reminder for its new date.
            const step = Math.floor(b.starts_at.getTime() / 86_400_000) % 30_000;
            count(await notifyCustomer(tx, c.id, "install_reminder", { contactId: b.contact_id, projectId: b.project_id, once: { entityId: b.id, step }, data: { when, site: b.site_address_line1 ?? undefined } }));
          }
        }
        return n;
      });
    } catch (err) {
      console.error("Reminders failed for company", c.id, err);
    }
  }
  return { sent, companies: active };
}
