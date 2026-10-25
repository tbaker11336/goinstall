import { ukMobileE164 } from "@goinstall/core";
import { sql, withService } from "@goinstall/db";
import { db } from "@/lib/db";
import { notifyTeam } from "@/lib/notify";
import { twilioParams, twiml } from "@/lib/twilio-webhooks";

const STOP = /^\s*(stop|stopall|unsubscribe|cancel|end|quit)\s*$/i;
const START = /^\s*(start|unstop|yes)\s*$/i;

/**
 * A customer texted a company's number: the reply joins that contact's
 * thread (matched on the mobile number) and the owner is told. STOP opts
 * them out of texts (Twilio also blocks further sends); START opts back in.
 */
export async function POST(request: Request) {
  const p = await twilioParams(request, "/api/webhooks/twilio/sms");
  if (!p) return new Response("Invalid signature", { status: 403 });
  const to = ukMobileE164(p.To) ?? p.To ?? "";
  const from = ukMobileE164(p.From);
  const body = (p.Body ?? "").slice(0, 1600);
  const found = await withService(db(), async (tx) => {
    const account = await tx.selectFrom("sms_accounts").select("company_id").where("phone_number", "=", to).executeTakeFirst();
    if (!account || !from) return null;
    const last10 = from.slice(-10);
    const contact = await tx
      .selectFrom("contacts")
      .select(["id", "name"])
      .where("company_id", "=", account.company_id)
      .where(sql<string>`right(regexp_replace(coalesce(phone, ''), '\\D', '', 'g'), 10)`, "=", last10)
      .orderBy("updated_at", "desc")
      .executeTakeFirst();
    if (!contact) return { companyId: account.company_id, contact: null, projectId: null };
    const project = await tx.selectFrom("projects").select("id").where("company_id", "=", account.company_id).where("contact_id", "=", contact.id).orderBy("updated_at", "desc").executeTakeFirst();
    if (p.MessageSid) {
      const dup = await tx.selectFrom("messages").select("id").where("company_id", "=", account.company_id).where("provider_message_id", "=", p.MessageSid).executeTakeFirst();
      if (dup) return { companyId: account.company_id, contact, projectId: project?.id ?? null, duplicate: true };
    }
    await tx
      .insertInto("messages")
      .values({ company_id: account.company_id, contact_id: contact.id, project_id: project?.id ?? null, channel: "sms", direction: "inbound", body, to_address: to, provider_message_id: p.MessageSid ?? null, delivery_status: null, created_by: null })
      .execute();
    if (STOP.test(body)) await tx.updateTable("contacts").set({ sms_opt_out_at: sql<Date>`now()` }).where("id", "=", contact.id).where("company_id", "=", account.company_id).execute();
    else if (START.test(body)) await tx.updateTable("contacts").set({ sms_opt_out_at: null }).where("id", "=", contact.id).where("company_id", "=", account.company_id).execute();
    await tx.updateTable("contacts").set({ last_activity_at: sql<Date>`now()` }).where("id", "=", contact.id).where("company_id", "=", account.company_id).execute();
    return { companyId: account.company_id, contact, projectId: project?.id ?? null };
  });
  if (found?.contact && !("duplicate" in found)) {
    await notifyTeam(found.companyId, "customer_reply", { projectId: found.projectId, link: `/contacts/${found.contact.id}`, data: { detail: `${found.contact.name}: ${body.slice(0, 200)}` } });
  } else if (found && !found.contact) {
    // No contact with this number: not stored (messages belong to a contact). Logged for now.
    console.info(`Unmatched text to ${to}`);
  }
  return twiml();
}
