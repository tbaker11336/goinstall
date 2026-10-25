import "server-only";
import { appendFile } from "node:fs/promises";
import { smsSegments, ukMobileE164, type SmsPlan } from "@goinstall/core";
import { sql, type Tx } from "@goinstall/db";
import { createRecordingSms, createStripeBilling, createTwilio, type PlatformBilling, type SmsNumbers, type SmsSender } from "@goinstall/integrations";
import { env } from "./env";

const g = globalThis as unknown as { goinstallSms?: (SmsSender & SmsNumbers) | null };
const fakeAllowed = () => process.env.NODE_ENV !== "production" && !process.env.VERCEL;

/**
 * Twilio when TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are set (GoInstall's
 * master account). In development and tests, SMS_OUTBOX_FILE records texts
 * instead of sending them. Otherwise SMS is unavailable.
 */
export function smsService(): (SmsSender & SmsNumbers) | null {
  if (g.goinstallSms !== undefined) return g.goinstallSms;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const outbox = process.env.SMS_OUTBOX_FILE;
  g.goinstallSms = sid && token ? createTwilio({ accountSid: sid, authToken: token }) : outbox && fakeAllowed() ? createRecordingSms((s) => appendFile(outbox, `${JSON.stringify(s)}\n`)) : null;
  return g.goinstallSms;
}

/**
 * The SMS add-on's price and allowance, set by GoInstall (environment), and
 * the Stripe price the subscription uses. Null until all are set: the add-on
 * then shows as not available yet.
 */
export function smsPlan(): (SmsPlan & { stripePriceId: string }) | null {
  const n = (k: string) => {
    const v = process.env[k];
    return v && /^\d+$/.test(v) ? Number(v) : null;
  };
  const monthlyPence = n("SMS_PLAN_MONTHLY_PENCE");
  const includedTexts = n("SMS_PLAN_INCLUDED_TEXTS");
  const extraTextPence = n("SMS_EXTRA_TEXT_PENCE");
  const stripePriceId = process.env.STRIPE_SMS_PRICE_ID;
  if (monthlyPence === null || includedTexts === null || extraTextPence === null || !stripePriceId) return null;
  return { monthlyPence, includedTexts, extraTextPence, stripePriceId };
}

/** GoInstall's own Stripe billing (add-ons); a local stand-in under PAYMENTS_FAKE. */
export function platformBilling(): PlatformBilling | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) return createStripeBilling({ secretKey: key });
  if (process.env.PAYMENTS_FAKE === "true" && fakeAllowed()) {
    return {
      name: "fake",
      async createSubscriptionCheckout(req) {
        const q = new URLSearchParams({ success: req.successUrl, cancel: req.cancelUrl, ...req.metadata });
        return { id: `cs_fake_sub_${req.idempotencyKey}`, url: `/api/dev/fake-subscription?${q}` };
      },
      async addInvoiceItem() {},
      async portal(req) {
        return { url: req.returnUrl };
      },
    };
  }
  return null;
}

/** The company's SMS add-on when it can send: paid up, with a number. */
export async function activeSms(tx: Tx, companyId: string) {
  const a = await tx
    .selectFrom("sms_accounts")
    .select(["id", "status", "phone_number", "twilio_subaccount_sid", "current_period_start", "current_period_end"])
    .where("company_id", "=", companyId)
    .executeTakeFirst();
  return a && a.status === "active" && a.phone_number && a.twilio_subaccount_sid && smsService() ? { ...a, phone_number: a.phone_number, twilio_subaccount_sid: a.twilio_subaccount_sid } : null;
}

/** Texts (billed parts) to customers since the start of the billing period; add the account's staff_texts_this_period. */
export async function smsUsed(tx: Tx, companyId: string, since: Date | null): Promise<number> {
  const r = await tx
    .selectFrom("messages")
    .select(sql<string>`coalesce(sum(sms_segments), 0)`.as("n"))
    .where("company_id", "=", companyId)
    .where("sms_segments", "is not", null)
    .where("direction", "=", "outbound")
    .where("created_at", ">=", since ?? new Date(Date.now() - 31 * 86_400_000))
    .executeTakeFirstOrThrow();
  return Number(r.n);
}

/**
 * Send a text from the company's number and record it in the thread (when
 * it's to a contact). Skips customers who opted out and non-UK-mobile
 * numbers. Runs as the service role: every query names the company.
 */
export async function sendSms(
  tx: Tx,
  p: { companyId: string; to: string | null; body: string; contactId?: string | null; projectId?: string | null; sentBy?: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const account = await activeSms(tx, p.companyId);
  if (!account) return { ok: false, error: "SMS isn't set up for this company" };
  const to = ukMobileE164(p.to);
  if (!to) return { ok: false, error: "No UK mobile number" };
  if (p.contactId) {
    const c = await tx.selectFrom("contacts").select("sms_opt_out_at").where("id", "=", p.contactId).where("company_id", "=", p.companyId).executeTakeFirst();
    if (c?.sms_opt_out_at) return { ok: false, error: "The customer has opted out of texts" };
  }
  const segments = smsSegments(p.body);
  const m = p.contactId
    ? await tx
        .insertInto("messages")
        .values({ company_id: p.companyId, contact_id: p.contactId, project_id: p.projectId ?? null, channel: "sms", direction: "outbound", body: p.body, to_address: to, sent_by: p.sentBy ?? null, delivery_status: "queued", sms_segments: segments, created_by: p.sentBy ?? null })
        .returning("id")
        .executeTakeFirstOrThrow()
    : null;
  const result = await smsService()!.send({ accountSid: account.twilio_subaccount_sid, from: account.phone_number, to, body: p.body, statusCallback: `${env.siteUrl.replace(/\/$/, "")}/api/webhooks/twilio/status` });
  if (m) await tx.updateTable("messages").set(result.ok ? { delivery_status: "sent", provider_message_id: result.providerId } : { delivery_status: "failed", delivery_error: result.error }).where("id", "=", m.id).execute();
  // Texts to staff aren't in a customer thread; they still count towards the allowance.
  if (!m && result.ok) await recordStaffText(tx, p.companyId, segments);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

/** Staff texts have no contact; count them on the account so the allowance includes them. */
async function recordStaffText(tx: Tx, companyId: string, segments: number) {
  await tx
    .updateTable("sms_accounts")
    .set((eb) => ({ staff_texts_this_period: eb("staff_texts_this_period", "+", segments) }))
    .where("company_id", "=", companyId)
    .execute();
}
