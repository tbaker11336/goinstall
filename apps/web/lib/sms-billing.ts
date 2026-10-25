import "server-only";
import { formatPence, smsUsage } from "@goinstall/core";
import { withService } from "@goinstall/db";
import type { StripeEvent } from "@goinstall/integrations";
import { z } from "zod";
import { db } from "./db";
import { platformBilling, smsPlan, smsUsed } from "./sms";

/**
 * The SMS add-on's billing events on GoInstall's own Stripe account:
 * checkout finished, the subscription changing, and each monthly invoice
 * (texts over the allowance are added to it before Stripe finalises it).
 */
const meta = z.object({ company_id: z.uuid(), kind: z.literal("sms_addon") });

type Sub = { id: string; customer: string; status: string; metadata?: Record<string, string>; current_period_start?: number; current_period_end?: number; items?: { data?: { current_period_start?: number; current_period_end?: number }[] } };

const periodOf = (s: Sub) => {
  // Newer API versions keep the period on the subscription item.
  const item = s.items?.data?.[0];
  const start = s.current_period_start ?? item?.current_period_start;
  const end = s.current_period_end ?? item?.current_period_end;
  return { start: start ? new Date(start * 1000) : null, end: end ? new Date(end * 1000) : null };
};

export async function handleBillingEvent(event: StripeEvent): Promise<{ status: string }> {
  const o = event.data.object as Record<string, unknown> & { id: string; metadata?: Record<string, string> };

  if (event.type === "checkout.session.completed" && (o as { mode?: string }).mode === "subscription") {
    const m = meta.safeParse(o.metadata);
    if (!m.success) return { status: "not_sms" };
    await withService(db(), async (tx) => {
      const a = await tx.selectFrom("sms_accounts").select(["phone_number"]).where("company_id", "=", m.data.company_id).executeTakeFirst();
      await tx
        .insertInto("sms_accounts")
        .values({ company_id: m.data.company_id, status: "pending_number", stripe_customer_id: String(o.customer), stripe_subscription_id: String(o.subscription), created_by: null })
        .onConflict((oc) =>
          oc.column("company_id").doUpdateSet({ status: a?.phone_number ? "active" : "pending_number", stripe_customer_id: String(o.customer), stripe_subscription_id: String(o.subscription) }),
        )
        .execute();
    });
    return { status: "subscribed" };
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const s = o as unknown as Sub;
    const m = meta.safeParse(s.metadata);
    if (!m.success) return { status: "not_sms" };
    const { start, end } = periodOf(s);
    await withService(db(), async (tx) => {
      const a = await tx.selectFrom("sms_accounts").select(["phone_number", "current_period_start"]).where("company_id", "=", m.data.company_id).executeTakeFirst();
      if (!a) return;
      const status =
        event.type === "customer.subscription.deleted" || s.status === "canceled" || s.status === "incomplete_expired"
          ? "cancelled"
          : s.status === "past_due" || s.status === "unpaid"
            ? "past_due"
            : a.phone_number
              ? "active"
              : "pending_number";
      const newPeriod = start && (!a.current_period_start || a.current_period_start.getTime() !== start.getTime());
      await tx
        .updateTable("sms_accounts")
        .set({ status, stripe_subscription_id: s.id, current_period_start: start, current_period_end: end, ...(newPeriod ? { staff_texts_this_period: 0 } : {}) })
        .where("company_id", "=", m.data.company_id)
        .execute();
    });
    return { status: "updated" };
  }

  // A renewal invoice is created as a draft about an hour before it's charged:
  // add the period just ended's texts over the allowance.
  if (event.type === "invoice.created") {
    const inv = o as unknown as { id: string; customer: string; subscription?: string; billing_reason?: string; status?: string; period_start?: number; period_end?: number; parent?: { subscription_details?: { subscription?: string } } };
    const subId = inv.subscription ?? inv.parent?.subscription_details?.subscription;
    if (inv.billing_reason !== "subscription_cycle" || inv.status !== "draft" || !subId) return { status: "ignored" };
    const plan = smsPlan();
    const billing = platformBilling();
    if (!plan || !billing) return { status: "not_configured" };
    return withService(db(), async (tx) => {
      const a = await tx.selectFrom("sms_accounts").select(["company_id", "staff_texts_this_period"]).where("stripe_subscription_id", "=", subId).executeTakeFirst();
      if (!a) return { status: "unknown_subscription" };
      const since = inv.period_start ? new Date(inv.period_start * 1000) : null;
      const used = (await smsUsed(tx, a.company_id, since)) + a.staff_texts_this_period;
      const u = smsUsage(plan, used);
      if (!u.extra) return { status: "within_allowance" };
      await billing.addInvoiceItem({
        customerId: String(inv.customer),
        invoiceId: inv.id,
        amountPence: u.extraPence,
        description: `${u.extra} texts over the ${u.included} included (${formatPence(plan.extraTextPence)} each)`,
        idempotencyKey: `sms-overage-${inv.id}`,
      });
      return { status: "overage_added" };
    });
  }

  return { status: "ignored" };
}
