"use server";

import { PRODUCT_CATEGORIES, parsePence } from "@goinstall/core";
import { sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { asUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { payments } from "@/lib/payments";
import type { ActionResult } from "./crm";

function optionalNumber(raw: FormDataEntryValue | null, label: string, min: number, max: number): number | null | { error: string } {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) return { error: `${label} must be between ${min} and ${max}.` };
  return n;
}

/** Quote and invoice settings. A blank VAT rate stays blank: proposals then say it's needed. */
export async function saveInvoiceSettingsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const vat: Record<string, number> = {};
  for (const c of PRODUCT_CATEGORIES) {
    const r = optionalNumber(form.get(`vat_${c}`), "VAT rates", 0, 100);
    if (r && typeof r === "object") return r;
    if (r !== null) vat[c] = r;
  }
  const deposit = optionalNumber(form.get("default_deposit_pct"), "Deposit", 0, 100);
  if (deposit && typeof deposit === "object") return deposit;
  const valid = optionalNumber(form.get("proposal_valid_days"), "Days a proposal is valid", 1, 365);
  if (valid && typeof valid === "object") return valid;
  if (valid !== null && !Number.isInteger(valid)) return { error: "Days a proposal is valid must be a whole number." };
  const discountRaw = String(form.get("shared_visit_discount") ?? "").trim();
  const discount = discountRaw ? parsePence(discountRaw) : null;
  if (discountRaw && (discount === null || Number.isNaN(discount) || discount < 0)) return { error: "Enter the shared-visit discount as an amount, e.g. 150." };
  const sortCode = String(form.get("bank_sort_code") ?? "").trim() || null;
  if (sortCode && !/^\d{2}-?\d{2}-?\d{2}$/.test(sortCode)) return { error: "Sort codes look like 12-34-56." };
  const account = String(form.get("bank_account_number") ?? "").replace(/\s/g, "") || null;
  if (account && !/^\d{8}$/.test(account)) return { error: "Account numbers are 8 digits." };
  const text = (k: string, max = 200) => String(form.get(k) ?? "").trim().slice(0, max) || null;
  return asUser(async (tx, session) => {
    await tx
      .updateTable("companies")
      .set({
        vat_rates: sql`${JSON.stringify(vat)}::jsonb`,
        default_deposit_pct: deposit === null ? null : String(deposit),
        proposal_valid_days: valid,
        shared_visit_discount_pence: discount,
        document_prefix: text("document_prefix", 10),
        bank_account_name: text("bank_account_name"),
        bank_sort_code: sortCode,
        bank_account_number: account,
        payment_terms: text("payment_terms", 2000),
      })
      .where("id", "=", session.companyId)
      .execute();
    revalidatePath("/settings/invoices");
    return { message: "Invoice and quote settings saved." };
  }, ["admin"]);
}

/** Connect (or finish connecting) the company's own Stripe account. */
export async function connectStripeAction() {
  const provider = payments();
  if (!provider) redirect("/settings/invoices?stripe=unavailable");
  const base = env.siteUrl.replace(/\/$/, "");
  const url = await asUser(async (tx, session) => {
    const c = await tx.selectFrom("companies").select(["name", "email", "stripe_account_id"]).where("id", "=", session.companyId).executeTakeFirstOrThrow();
    const r = await provider.startOnboarding({
      email: c.email,
      companyName: c.name,
      existingAccountId: c.stripe_account_id,
      refreshUrl: `${base}/settings/invoices?stripe=retry`,
      returnUrl: `${base}/settings/invoices?stripe=done`,
    });
    if (r.accountId !== c.stripe_account_id) await tx.updateTable("companies").set({ stripe_account_id: r.accountId }).where("id", "=", session.companyId).execute();
    return r.url;
  }, ["admin"]);
  redirect(url);
}
