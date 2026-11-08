"use server";

import { withService } from "@goinstall/db";
import { sql } from "@goinstall/db";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { asUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { pullXeroPayments, syncInvoiceToXero, xeroAuth, xeroConnection, type XeroSettings } from "@/lib/xero";
import type { ActionResult } from "./crm";

const settingsSchema = z.object({
  tenant_id: z.string().min(1),
  sales_account: z
    .string()
    .trim()
    .max(20)
    .transform((v) => v || null),
  payment_account: z
    .string()
    .trim()
    .max(64)
    .transform((v) => v || null),
  card_account: z
    .string()
    .trim()
    .max(64)
    .transform((v) => v || null),
  invoice_status: z.enum(["AUTHORISED", "DRAFT"]),
});

/** Which Xero accounts and tax rates GoInstall's invoices use. */
export async function saveXeroSettingsAction(_: ActionResult, form: FormData): Promise<ActionResult> {
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const taxTypes: Record<string, string> = {};
  for (const [k, v] of form.entries()) {
    const m = k.match(/^tax_(\d+(?:\.\d+)?)$/);
    if (m && typeof v === "string" && v.trim()) taxTypes[String(Number(m[1]))] = v.trim().slice(0, 40);
  }
  return asUser(
    async (tx) => {
      const row = await tx.selectFrom("integrations").select(["id", "settings"]).where("provider", "=", "xero").where("user_id", "is", null).where("status", "=", "connected").executeTakeFirst();
      if (!row) return { error: "Connect Xero first." };
      const prev = row.settings as unknown as XeroSettings;
      const tenant = prev.tenants.find((t) => t.tenantId === parsed.data.tenant_id) ?? prev.tenants.find((t) => t.tenantId === prev.tenantId)!;
      const changedOrg = tenant.tenantId !== prev.tenantId;
      const next: XeroSettings = {
        ...prev,
        tenantId: tenant.tenantId,
        tenantName: tenant.tenantName,
        connectionId: tenant.connectionId,
        salesAccountCode: changedOrg ? null : parsed.data.sales_account,
        taxTypes: changedOrg ? {} : taxTypes,
        paymentAccountId: changedOrg ? null : parsed.data.payment_account,
        cardAccountId: changedOrg ? null : parsed.data.card_account,
        invoiceStatus: parsed.data.invoice_status,
      };
      await tx.updateTable("integrations").set({ settings: JSON.stringify(next) }).where("id", "=", row.id).execute();
      revalidatePath("/settings/integrations");
      return { message: changedOrg ? `Switched to ${tenant.tenantName}: choose its accounts and tax rates.` : "Xero settings saved." };
    },
    ["admin"],
  );
}

export async function disconnectXeroAction(): Promise<ActionResult> {
  const r = await asUser(
    async (tx, session) => {
      const row = await tx.selectFrom("integrations").select(["id", "settings"]).where("provider", "=", "xero").where("user_id", "is", null).executeTakeFirst();
      if (!row) return { error: "Xero isn't connected." };
      return { id: row.id, companyId: session.companyId, connectionId: (row.settings as unknown as XeroSettings).connectionId };
    },
    ["admin"],
  );
  if ("error" in r) return { error: r.error };
  // Tell Xero (best effort), then forget the tokens.
  const conn = await xeroConnection(r.companyId).catch(() => null);
  if (conn) await xeroAuth().disconnect(conn.accessToken, r.connectionId).catch(() => undefined);
  await withService(db(), async (tx) => {
    await sql`delete from private.integration_secrets where integration_id = ${r.id}`.execute(tx);
    await tx.updateTable("integrations").set({ status: "disconnected" }).where("id", "=", r.id).where("company_id", "=", r.companyId).execute();
  });
  revalidatePath("/settings/integrations");
  return { message: "Xero disconnected. Invoices already sent stay in Xero." };
}

/** Send (or resend) one invoice to Xero: the Invoices tab's Retry. */
export async function syncInvoiceAction(invoiceId: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(invoiceId).success) return { error: "Invoice not found" };
  const inv = await asUser((tx, s) => tx.selectFrom("invoices").select(["id", "project_id"]).where("id", "=", invoiceId).executeTakeFirst().then((i) => (i ? { ...i, companyId: s.companyId } : null)));
  if (!inv) return { error: "Invoice not found" };
  const r = await syncInvoiceToXero(inv.companyId, inv.id);
  revalidatePath(`/projects/${inv.project_id}/invoices`);
  if (!r.ok) return { error: r.error };
  return { message: r.skipped ?? "Sent to Xero." };
}

/** Send every invoice not yet in Xero (or that failed), e.g. after connecting. */
export async function syncAllToXeroAction(): Promise<ActionResult> {
  const r = await asUser(
    async (tx, s) => ({
      companyId: s.companyId,
      ids: (
        await tx
          .selectFrom("invoices")
          .select("id")
          .where("status", "in", ["open", "paid"])
          .where((eb) => eb.or([eb("xero_invoice_id", "is", null), eb("xero_error", "is not", null)]))
          .orderBy("issued_at")
          .limit(200)
          .execute()
      ).map((i) => i.id),
    }),
    ["admin"],
  );
  let sent = 0;
  let failed = 0;
  for (const id of r.ids) {
    const x = await syncInvoiceToXero(r.companyId, id);
    if (x.ok && !x.skipped) sent++;
    else if (!x.ok) failed++;
  }
  revalidatePath("/", "layout");
  if (!r.ids.length) return { message: "Every invoice is already in Xero." };
  return failed ? { error: `${sent} sent to Xero; ${failed} couldn't be sent (see the Invoices tab for why).` } : { message: `${sent} invoice${sent === 1 ? "" : "s"} sent to Xero.` };
}

/** Read payments made in Xero now, rather than waiting for the daily check. */
export async function checkXeroPaymentsAction(): Promise<ActionResult> {
  const companyId = await asUser(async (_, s) => s.companyId, ["admin", "office"]);
  const r = await pullXeroPayments(companyId);
  revalidatePath("/", "layout");
  if (r.error) return { error: `Couldn't check Xero: ${r.error}` };
  return { message: r.updated ? `${r.updated} invoice${r.updated === 1 ? "" : "s"} marked paid from Xero.` : "No new payments in Xero." };
}
