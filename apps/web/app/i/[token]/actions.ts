"use server";

import { withService } from "@goinstall/db";
import { redirect } from "next/navigation";
import { hashPayToken } from "@/lib/completion";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { payments } from "@/lib/payments";

/** "Pay by card" on the balance invoice page: Stripe Checkout on the installer's connected account. */
export async function payInvoiceByCardAction(token: string): Promise<{ error?: string }> {
  const provider = payments();
  if (!provider) return { error: "Card payments aren't available. Please pay by bank transfer." };
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { error: "This link isn't working." };
  const base = env.siteUrl.replace(/\/$/, "");
  const r = await withService(db(), async (tx) => {
    const inv = await tx
      .selectFrom("invoices as i")
      .innerJoin("companies as c", "c.id", "i.company_id")
      .innerJoin("projects as p", (j) => j.onRef("p.id", "=", "i.project_id").onRef("p.company_id", "=", "i.company_id"))
      .innerJoin("contacts as ct", "ct.id", "p.contact_id")
      .select(["i.id", "i.company_id", "i.number", "i.amount_pence", "i.status", "c.name", "c.stripe_account_id", "ct.email"])
      .where("i.pay_token_hash", "=", hashPayToken(token))
      .executeTakeFirst();
    if (!inv || inv.status === "void") return { error: "This link isn't working." };
    if (inv.status === "paid") return { error: "This invoice has already been paid. Thank you." };
    if (!inv.stripe_account_id) return { error: "Card payments aren't available. Please pay by bank transfer." };
    const session = await provider.createCheckout({
      amountPence: Number(inv.amount_pence),
      description: `Balance for ${inv.name} (${inv.number})`,
      customerEmail: inv.email,
      successUrl: `${base}/i/${token}?paid=1`,
      cancelUrl: `${base}/i/${token}`,
      metadata: { invoice_id: inv.id, company_id: inv.company_id },
      connectedAccountId: inv.stripe_account_id,
      idempotencyKey: `balance-${inv.id}-${Math.floor(Date.now() / 600_000)}`,
    });
    return { url: session.url };
  }).catch(() => ({ error: "Card payment couldn't be started. Please try again or pay by bank transfer." }));
  if ("url" in r && r.url) redirect(r.url);
  return r as { error?: string };
}
