"use server";

import { withService } from "@goinstall/db";
import { textToHtml } from "@goinstall/integrations";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { emailSender, fromAddress } from "@/lib/email";
import { env } from "@/lib/env";
import { requirePlatformAdmin } from "@/lib/platform";
import { smsService } from "@/lib/sms";
import type { ActionResult } from "./crm";

/** Available UK mobile numbers to choose from. */
export async function findNumbersAction(contains: string): Promise<{ numbers?: { phoneNumber: string; locality: string | null }[]; error?: string }> {
  await requirePlatformAdmin();
  const sms = smsService();
  if (!sms) return { error: "Twilio isn't configured (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)." };
  try {
    return { numbers: await sms.availableNumbers({ contains: /^\d{1,8}$/.test(contains) ? contains : undefined, limit: 10 }) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Search failed" };
  }
}

const attachSchema = z.object({
  phoneNumber: z.string().regex(/^\+447\d{9}$/, "Choose a UK mobile number"),
  bundleSid: z.string().regex(/^BU[0-9a-f]{32}$/, "Paste the approved regulatory bundle SID (BU…)"),
  addressSid: z.union([z.literal(""), z.string().regex(/^AD[0-9a-f]{32}$/, "Address SIDs start AD…")]),
});

/**
 * Give a company its number once its regulatory bundle is approved: a
 * subaccount (first time), the number bought into it with replies routed
 * to GoInstall, then the add-on is live and the company is told.
 */
export async function attachNumberAction(companyId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  await requirePlatformAdmin();
  if (!z.uuid().safeParse(companyId).success) return { error: "Company not found" };
  const fake = smsService()?.name === "recording";
  const parsed = attachSchema.safeParse({ phoneNumber: String(form.get("phoneNumber") ?? ""), bundleSid: fake ? "BU" + "0".repeat(32) : String(form.get("bundleSid") ?? "").trim(), addressSid: String(form.get("addressSid") ?? "").trim() });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const sms = smsService();
  if (!sms) return { error: "Twilio isn't configured." };
  const base = env.siteUrl.replace(/\/$/, "");
  try {
    const result = await withService(db(), async (tx) => {
      const a = await tx
        .selectFrom("sms_accounts as s")
        .innerJoin("companies as c", "c.id", "s.company_id")
        .select(["s.status", "s.twilio_subaccount_sid", "s.phone_number", "s.business_details", "c.name", "c.email", "c.email_sender"])
        .where("s.company_id", "=", companyId)
        .executeTakeFirst();
      if (!a) return { error: "This company hasn't subscribed to SMS." };
      if (a.phone_number) return { error: `It already has ${a.phone_number}.` };
      const subaccountSid = a.twilio_subaccount_sid ?? (await sms.createSubaccount(`GoInstall · ${a.name}`)).sid;
      await tx.updateTable("sms_accounts").set({ twilio_subaccount_sid: subaccountSid }).where("company_id", "=", companyId).execute();
      const bought = await sms.buyNumber({ subaccountSid, phoneNumber: parsed.data.phoneNumber, bundleSid: parsed.data.bundleSid, addressSid: parsed.data.addressSid || undefined, smsUrl: `${base}/api/webhooks/twilio/sms` });
      const live = a.status === "pending_number" || a.status === "active";
      await tx
        .updateTable("sms_accounts")
        .set({ phone_number: bought.phoneNumber, phone_number_sid: bought.sid, status: live ? "active" : a.status, activated_at: new Date() })
        .where("company_id", "=", companyId)
        .execute();
      const to = (a.business_details as { contactEmail?: string }).contactEmail ?? a.email;
      if (to) {
        const body = `Your SMS number ${bought.phoneNumber.replace(/^\+44(\d{4})(\d{6})$/, "0$1 $2")} is ready.\n\nChoose which notifications go by text in Settings › Notifications: ${base}/settings/notifications\n\nGoInstall`;
        await emailSender().send({ from: fromAddress("GoInstall"), to, subject: "Your GoInstall SMS number is ready", text: body, html: textToHtml(body), tags: { kind: "sms_number_ready" } });
      }
      return { message: `${bought.phoneNumber} attached to ${a.name}${live ? " and live" : ""}.` };
    });
    revalidatePath("/platform/sms");
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't attach the number" };
  }
}
