import "server-only";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { formatPence, vatLines } from "@goinstall/core";
import { sql, withService, type Tx } from "@goinstall/db";
import { createFakeXero, createXeroAuth, createXeroClient, XeroError, type FakeXeroState, type XeroAuth, type XeroClient, type XeroTokens } from "@goinstall/integrations";
import { after } from "next/server";
import { db } from "./db";
import { recordInvoicePayment, writeSystemNote } from "./deposits";
import { env } from "./env";
import { invoiceDoc, kindLabel } from "./invoices";
import { openTokens, sealTokens } from "./token-crypto";

/**
 * Xero, connected per company in Settings › Integrations. Invoices, payments
 * and voids are pushed when they happen in GoInstall; payments made in Xero
 * are read back by the daily job (or "Check Xero now").
 */

export interface XeroSettings {
  tenantId: string;
  tenantName: string;
  connectionId: string | null;
  tenants: { tenantId: string; tenantName: string; connectionId: string }[];
  salesAccountCode: string | null;
  /** VAT rate ("20", "5", "0") → Xero tax type. */
  taxTypes: Record<string, string>;
  /** Where bank transfers recorded in GoInstall go. */
  paymentAccountId: string | null;
  /** Where card (Stripe) payments go; the payment account when unset. */
  cardAccountId: string | null;
  invoiceStatus: "AUTHORISED" | "DRAFT";
  lastCheckedAt?: string;
}

export const xeroFake = () => process.env.XERO_FAKE === "true" && !process.env.VERCEL;
export const xeroConfigured = () => xeroFake() || Boolean(process.env.XERO_CLIENT_ID && process.env.XERO_CLIENT_SECRET);
export const xeroRedirectUri = () => `${env.siteUrl.replace(/\/$/, "")}/api/integrations/xero/callback`;

const fakeFile = () => process.env.XERO_FAKE_FILE ?? path.join(process.cwd(), ".data", "xero-fake.json");
function fakeClient(): XeroClient {
  return createFakeXero({
    load: () => {
      try {
        return JSON.parse(readFileSync(fakeFile(), "utf8")) as FakeXeroState;
      } catch {
        return { invoices: {} };
      }
    },
    save: (s) => {
      mkdirSync(path.dirname(fakeFile()), { recursive: true });
      writeFileSync(fakeFile(), JSON.stringify(s, null, 1));
    },
  });
}

export function xeroAuth(): XeroAuth {
  if (xeroFake()) {
    const tokens = (): XeroTokens => ({ accessToken: "fake-access", refreshToken: "fake-refresh", expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() });
    return {
      authorizeUrl: (state) => `${env.siteUrl.replace(/\/$/, "")}/api/dev/fake-xero?state=${encodeURIComponent(state)}`,
      exchangeCode: async () => tokens(),
      refresh: async () => tokens(),
      tenants: async () => [{ tenantId: "fake-tenant", tenantName: "Demo Company (UK)", connectionId: "fake-connection" }],
      disconnect: async () => undefined,
    };
  }
  return createXeroAuth({ clientId: process.env.XERO_CLIENT_ID!, clientSecret: process.env.XERO_CLIENT_SECRET!, redirectUri: xeroRedirectUri(), scopes: process.env.XERO_SCOPES || undefined });
}

/** The company's Xero connection (service role), with a fresh access token. */
export async function xeroConnection(companyId: string): Promise<{ integrationId: string; settings: XeroSettings; client: XeroClient; accessToken: string } | null> {
  return withService(db(), async (tx) => {
    const row = (
      await sql<{ id: string; settings: unknown; ciphertext: string }>`
        select i.id, i.settings, s.ciphertext
        from public.integrations i
        join private.integration_secrets s on s.integration_id = i.id
        where i.company_id = ${companyId} and i.provider = 'xero' and i.user_id is null and i.status = 'connected'
      `.execute(tx)
    ).rows[0];
    if (!row) return null;
    let tokens = openTokens<XeroTokens>(row.ciphertext);
    if (new Date(tokens.expiresAt).getTime() < Date.now()) {
      tokens = await xeroAuth().refresh(tokens.refreshToken);
      await storeXeroTokens(tx, row.id, companyId, tokens);
    }
    const settings = row.settings as unknown as XeroSettings;
    const client = xeroFake() ? fakeClient() : createXeroClient({ accessToken: tokens.accessToken, tenantId: settings.tenantId });
    return { integrationId: row.id, settings, client, accessToken: tokens.accessToken };
  });
}

export async function storeXeroTokens(tx: Tx, integrationId: string, companyId: string, tokens: XeroTokens) {
  await sql`
    insert into private.integration_secrets (integration_id, company_id, ciphertext, updated_at)
    values (${integrationId}, ${companyId}, ${sealTokens(tokens)}, now())
    on conflict (integration_id) do update set ciphertext = excluded.ciphertext, updated_at = now()
  `.execute(tx);
}

const message = (e: unknown) => (e instanceof XeroError ? e.message : e instanceof Error ? e.message : "Xero didn't respond").slice(0, 900);
const ymd = (d: Date | string) => (typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10));

/**
 * Push one invoice to Xero: create or update it (a line per VAT rate), void
 * it if it's been voided here, and send any payments recorded here. Errors
 * are kept on the invoice (shown on the Invoices tab) rather than thrown.
 */
export async function syncInvoiceToXero(companyId: string, invoiceId: string): Promise<{ ok: true; skipped?: string } | { ok: false; error: string }> {
  const conn = await xeroConnection(companyId).catch((e) => ({ error: message(e) }) as const);
  if (!conn) return { ok: true, skipped: "Xero isn't connected" };
  if ("error" in conn) return fail(companyId, invoiceId, `Couldn't reach Xero: ${conn.error}`);
  const s = conn.settings;
  return withService(db(), async (tx) => {
    const inv = await tx.selectFrom("invoices").select(["id", "status", "kind", "proposal_id", "xero_invoice_id", "amount_pence", "vat_pence", "issued_at", "due_date"]).where("id", "=", invoiceId).where("company_id", "=", companyId).executeTakeFirst();
    if (!inv) return { ok: false as const, error: "Invoice not found" };
    try {
      if (inv.status === "void") {
        if (inv.xero_invoice_id) await conn.client.voidInvoice(inv.xero_invoice_id, s.invoiceStatus === "DRAFT");
        await mark(tx, invoiceId, inv.xero_invoice_id, null);
        return { ok: true as const };
      }
      if (inv.status === "draft") return { ok: true as const, skipped: "Draft" };
      if (!s.salesAccountCode) return failIn(tx, invoiceId, "Choose the sales account in Settings › Integrations, then sync again.");
      const doc = await invoiceDoc(tx, companyId, invoiceId);
      if (!doc) return { ok: false as const, error: "Invoice not found" };
      // The quote's mix of VAT rates, for invoices against it.
      const netByRate =
        inv.kind !== "extra" && inv.proposal_id
          ? (
              await tx
                .selectFrom("proposal_lines")
                .select(["vat_rate", sql<string>`sum(line_total_pence)`.as("net")])
                .where("proposal_id", "=", inv.proposal_id)
                .where("company_id", "=", companyId)
                .groupBy("vat_rate")
                .execute()
            ).map((r) => ({ rate: Number(r.vat_rate), netPence: Number(r.net) }))
          : null;
      const lines = vatLines({ amountPence: Number(inv.amount_pence), vatPence: Number(inv.vat_pence) }, netByRate);
      const missing = lines.map((l) => String(l.rate)).filter((r) => !s.taxTypes[r]);
      if (missing.length) return failIn(tx, invoiceId, `Choose the Xero tax rate for ${missing.map((r) => `${r}% VAT`).join(" and ")} in Settings › Integrations, then sync again.`);
      const { invoiceId: xeroId } = await conn.client.upsertInvoice(
        {
          number: doc.number,
          reference: doc.quoteRef ? `Quote ${doc.quoteRef}` : null,
          contact: { name: doc.customer.company ?? doc.customer.name, email: doc.contactEmail },
          date: ymd(inv.issued_at),
          dueDate: ymd(inv.due_date ?? inv.issued_at),
          status: s.invoiceStatus,
          lines: lines.map((l) => ({ description: lines.length > 1 ? `${doc.title} (${l.rate}% VAT)` : doc.title, netPence: l.netPence, vatPence: l.vatPence, accountCode: s.salesAccountCode!, taxType: s.taxTypes[String(l.rate)]! })),
        },
        inv.xero_invoice_id,
        `invoice-${inv.id}-${inv.xero_invoice_id ? "update" : "create"}`,
      );
      // Payments recorded here (not ones that came from Xero) go across once the invoice is approved there.
      let note: string | null = null;
      if (s.invoiceStatus === "AUTHORISED") {
        const pays = await tx.selectFrom("payments").select(["id", "amount_pence", "method", "paid_at", "created_at"]).where("invoice_id", "=", inv.id).where("status", "=", "succeeded").where("xero_payment_id", "is", null).where((eb) => eb.or([eb("provider", "is", null), eb("provider", "!=", "xero")])).execute();
        for (const p of pays) {
          const account = p.method === "card" ? (s.cardAccountId ?? s.paymentAccountId) : s.paymentAccountId;
          if (!account) {
            note = "Payments weren't sent: choose the payment account in Settings › Integrations.";
            continue;
          }
          const { paymentId } = await conn.client.createPayment({ invoiceId: xeroId, accountId: account, amountPence: Number(p.amount_pence), date: ymd(p.paid_at ?? p.created_at), reference: `${doc.number} ${p.method === "card" ? "card" : "bank transfer"}` }, `payment-${p.id}`);
          await tx.updateTable("payments").set({ xero_payment_id: paymentId }).where("id", "=", p.id).execute();
        }
      }
      await mark(tx, invoiceId, xeroId, note);
      return { ok: true as const };
    } catch (e) {
      return failIn(tx, invoiceId, `Xero: ${message(e)}`);
    }
  });
}

async function mark(tx: Tx, invoiceId: string, xeroId: string | null, error: string | null) {
  await tx.updateTable("invoices").set({ xero_invoice_id: xeroId, xero_synced_at: sql<Date>`now()`, xero_error: error }).where("id", "=", invoiceId).execute();
}
async function failIn(tx: Tx, invoiceId: string, error: string) {
  await tx.updateTable("invoices").set({ xero_error: error }).where("id", "=", invoiceId).execute();
  return { ok: false as const, error };
}
async function fail(companyId: string, invoiceId: string, error: string) {
  await withService(db(), (tx) => tx.updateTable("invoices").set({ xero_error: error }).where("id", "=", invoiceId).where("company_id", "=", companyId).execute());
  return { ok: false as const, error };
}

/**
 * Payments made in Xero (e.g. reconciled from the bank feed) come back as
 * paid here. Returns how many invoices changed.
 */
export async function pullXeroPayments(companyId: string): Promise<{ updated: number; error?: string }> {
  const conn = await xeroConnection(companyId).catch((e) => ({ error: message(e) }) as const);
  if (!conn) return { updated: 0 };
  if ("error" in conn) return { updated: 0, error: conn.error };
  const open = await withService(db(), (tx) => tx.selectFrom("invoices").select(["id", "xero_invoice_id"]).where("company_id", "=", companyId).where("status", "=", "open").where("xero_invoice_id", "is not", null).execute());
  let updated = 0;
  try {
    for (let i = 0; i < open.length; i += 50) {
      const batch = open.slice(i, i + 50);
      const states = await conn.client.invoices(batch.map((b) => b.xero_invoice_id!));
      for (const st of states) {
        const ours = batch.find((b) => b.xero_invoice_id === st.invoiceId);
        if (!ours || st.status !== "PAID") continue;
        await withService(db(), async (tx) => {
          const known = new Set((await tx.selectFrom("payments").select("xero_payment_id").where("invoice_id", "=", ours.id).execute()).map((p) => p.xero_payment_id));
          const fresh = st.payments.filter((p) => !known.has(p.paymentId));
          const amount = fresh.reduce((t, p) => t + p.amountPence, 0);
          if (!fresh.length || amount <= 0) return;
          const rec = await recordInvoicePayment(tx, { companyId, invoiceId: ours.id, amountPence: amount, method: "bank_transfer", provider: "xero", providerRef: fresh[0]!.paymentId, actorId: null });
          if (rec.alreadyRecorded) return;
          await tx.updateTable("payments").set({ xero_payment_id: fresh[0]!.paymentId }).where("invoice_id", "=", ours.id).where("provider", "=", "xero").where("provider_ref", "=", fresh[0]!.paymentId).execute();
          if (rec.note) await writeSystemNote(tx, { ...rec.note, body: `${rec.note.body} (recorded in Xero)` });
          updated++;
        });
      }
    }
    await withService(db(), (tx) => tx.updateTable("integrations").set({ settings: sql`settings || ${JSON.stringify({ lastCheckedAt: new Date().toISOString() })}::jsonb` }).where("id", "=", conn.integrationId).execute());
    return { updated };
  } catch (e) {
    return { updated, error: message(e) };
  }
}

/** For the Invoices tab: a one-line Xero status per invoice. */
export function xeroStatusText(i: { xero_invoice_id: string | null; xero_error: string | null; xero_synced_at: Date | null }): { ok: boolean; text: string } | null {
  if (i.xero_error) return { ok: false, text: i.xero_error };
  if (i.xero_invoice_id) return { ok: true, text: "In Xero" };
  return null;
}

export { formatPence, kindLabel };

/** Send an invoice to Xero after the response (when the company has Xero connected). */
export function syncToXeroLater(companyId: string, invoiceId: string) {
  after(async () => {
    await syncInvoiceToXero(companyId, invoiceId).catch(() => undefined);
  });
}
