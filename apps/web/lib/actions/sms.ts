"use server";

import { withService } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { asUser, requireAdmin } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { platformBilling, sendSms, smsPlan } from "@/lib/sms";
import type { ActionResult } from "./crm";

const base = () => env.siteUrl.replace(/\/$/, "");

/** "Add SMS": Stripe Checkout for the monthly add-on on GoInstall's account. */
export async function startSmsSubscriptionAction(): Promise<ActionResult> {
  const session = await requireAdmin();
  const plan = smsPlan();
  const billing = platformBilling();
  if (!plan || !billing) return { error: "The SMS add-on isn't available yet." };
  const existing = await withService(db(), (tx) => tx.selectFrom("sms_accounts").select(["status", "stripe_customer_id"]).where("company_id", "=", session.companyId).executeTakeFirst());
  if (existing && existing.status !== "cancelled" && existing.status !== "checkout") return { error: "SMS is already set up." };
  await withService(db(), (tx) =>
    tx.insertInto("sms_accounts").values({ company_id: session.companyId, status: "checkout", created_by: session.userId }).onConflict((oc) => oc.column("company_id").doUpdateSet({ status: "checkout" })).execute(),
  );
  const s = await billing.createSubscriptionCheckout({
    priceId: plan.stripePriceId,
    customerEmail: session.email,
    customerId: existing?.stripe_customer_id ?? null,
    successUrl: `${base()}/settings/sms?subscribed=1`,
    cancelUrl: `${base()}/settings/sms`,
    metadata: { company_id: session.companyId, kind: "sms_addon" },
    idempotencyKey: `sms-${session.companyId}-${Math.floor(Date.now() / 600_000)}`,
  });
  redirect(s.url);
}

/** Stripe's billing page: card, invoices, cancel. */
export async function smsBillingPortalAction(): Promise<ActionResult> {
  const session = await requireAdmin();
  const billing = platformBilling();
  const a = await withService(db(), (tx) => tx.selectFrom("sms_accounts").select("stripe_customer_id").where("company_id", "=", session.companyId).executeTakeFirst());
  if (!billing || !a?.stripe_customer_id) return { error: "No SMS billing to manage yet." };
  const p = await billing.portal({ customerId: a.stripe_customer_id, returnUrl: `${base()}/settings/sms` });
  redirect(p.url);
}

const detailsSchema = z.object({
  legalName: z.string().trim().min(2, "Enter the registered business name").max(160),
  companyNumber: z.string().trim().max(20),
  address: z.string().trim().min(5, "Enter the registered address").max(300),
  contactName: z.string().trim().min(2, "Enter a contact name").max(120),
  contactEmail: z.email("Enter a contact email"),
  contactPhone: z.string().trim().max(30),
});

/** Business details for the UK number's regulatory check. */
export async function saveSmsBusinessDetailsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = detailsSchema.safeParse(Object.fromEntries(["legalName", "companyNumber", "address", "contactName", "contactEmail", "contactPhone"].map((k) => [k, String(form.get(k) ?? "")])));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  return asUser(async (tx) => {
    const r = await tx.updateTable("sms_accounts").set({ business_details: JSON.stringify({ ...parsed.data, submittedAt: new Date().toISOString() }) }).executeTakeFirst();
    if (!Number(r.numUpdatedRows)) return { error: "Add SMS first." };
    revalidatePath("/settings/sms");
    return { message: "Details saved. We'll set up your number and email you when it's ready." };
  }, ["admin"]);
}

/** Contact page: send a text from the company's number (two-way: replies come back to the thread). */
export async function sendContactSmsAction(contactId: string, _: ActionResult, form: FormData): Promise<ActionResult> {
  if (!z.uuid().safeParse(contactId).success) return { error: "Contact not found" };
  const body = String(form.get("body") ?? "").trim();
  const projectId = String(form.get("project_id") ?? "") || null;
  if (!body) return { error: "Write a message first." };
  if (body.length > 640) return { error: "Keep texts under 640 characters." };
  const ctx = await asUser(async (tx, session) => {
    const c = await tx.selectFrom("contacts").select(["id", "phone"]).where("id", "=", contactId).executeTakeFirst();
    return c ? { phone: c.phone, companyId: session.companyId, userId: session.userId } : null;
  });
  if (!ctx) return { error: "Contact not found" };
  const r = await withService(db(), (tx) => sendSms(tx, { companyId: ctx.companyId, to: ctx.phone, body, contactId, projectId: projectId && z.uuid().safeParse(projectId).success ? projectId : null, sentBy: ctx.userId }));
  revalidatePath(`/contacts/${contactId}`);
  return r.ok ? { message: "Text sent." } : { error: r.error };
}
