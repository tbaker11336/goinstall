import "server-only";
import type { StripeEvent } from "@goinstall/integrations";
import { withService } from "@goinstall/db";
import { z } from "zod";
import { db } from "./db";
import { recordInvoicePayment } from "./deposits";

const meta = z.object({ invoice_id: z.uuid(), company_id: z.uuid() });

/**
 * A completed Checkout session pays the deposit invoice named in its
 * metadata. The session must belong to that company's connected account and
 * the amount must match; repeats are ignored (keyed on the session id).
 */
export async function handleStripeEvent(event: StripeEvent): Promise<{ status: string }> {
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return { status: "ignored" };
  const s = event.data.object;
  if (s.payment_status !== "paid") return { status: "not_paid" };
  const m = meta.safeParse(s.metadata);
  if (!m.success) return { status: "no_invoice" };
  return withService(db(), async (tx) => {
    const inv = await tx
      .selectFrom("invoices as i")
      .innerJoin("companies as c", "c.id", "i.company_id")
      .select(["i.id", "i.amount_pence", "i.status", "c.stripe_account_id"])
      .where("i.id", "=", m.data.invoice_id)
      .where("i.company_id", "=", m.data.company_id)
      .executeTakeFirst();
    if (!inv) return { status: "unknown_invoice" };
    if (!event.account || event.account !== inv.stripe_account_id) return { status: "wrong_account" };
    if (Number(s.amount_total) !== Number(inv.amount_pence)) return { status: "amount_mismatch" };
    if (inv.status === "paid") return { status: "already_paid" };
    const r = await recordInvoicePayment(tx, {
      companyId: m.data.company_id,
      invoiceId: inv.id,
      amountPence: Number(s.amount_total),
      method: "card",
      provider: "stripe",
      providerRef: s.id,
      actorId: null,
    });
    return { status: r.alreadyRecorded ? "duplicate" : "recorded" };
  });
}
