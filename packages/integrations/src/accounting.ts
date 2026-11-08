/**
 * Accounting sync: Xero. Each company connects its own organisation with
 * OAuth 2.0; invoices, payments and voids are pushed to it, and payments
 * made in Xero are read back. Amounts here are integer pence.
 */

export interface XeroTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO time the access token expires. */
  expiresAt: string;
}

export interface XeroTenant {
  tenantId: string;
  tenantName: string;
  /** The connection's id, used to disconnect. */
  connectionId: string;
}

export interface XeroAccount {
  accountId: string;
  code: string | null;
  name: string;
  type: string;
  enablePayments: boolean;
}

export interface XeroTaxRate {
  taxType: string;
  name: string;
  rate: number;
  revenue: boolean;
}

export interface XeroInvoiceInput {
  /** Our invoice number, used as Xero's InvoiceNumber. */
  number: string;
  reference: string | null;
  contact: { name: string; email: string | null };
  date: string;
  dueDate: string;
  status: "DRAFT" | "AUTHORISED";
  lines: { description: string; netPence: number; vatPence: number; accountCode: string; taxType: string }[];
}

export interface XeroInvoiceState {
  invoiceId: string;
  status: string;
  amountPaidPence: number;
  payments: { paymentId: string; amountPence: number; date: string }[];
}

export interface XeroClient {
  readonly name: string;
  accounts(): Promise<XeroAccount[]>;
  taxRates(): Promise<XeroTaxRate[]>;
  /** Create (no id) or update an invoice; returns Xero's id. */
  upsertInvoice(input: XeroInvoiceInput, existingId: string | null, idempotencyKey: string): Promise<{ invoiceId: string }>;
  voidInvoice(invoiceId: string, draft: boolean): Promise<void>;
  createPayment(input: { invoiceId: string; accountId: string; amountPence: number; date: string; reference: string }, idempotencyKey: string): Promise<{ paymentId: string }>;
  invoices(ids: string[]): Promise<XeroInvoiceState[]>;
}

export interface XeroAuth {
  authorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<XeroTokens>;
  refresh(refreshToken: string): Promise<XeroTokens>;
  tenants(accessToken: string): Promise<XeroTenant[]>;
  disconnect(accessToken: string, tenantConnectionId: string | null): Promise<void>;
}

/** Granular scopes (Xero apps created from March 2026 can't use the old broad ones). */
export const XERO_DEFAULT_SCOPES = "openid profile email offline_access accounting.invoices accounting.payments accounting.contacts accounting.settings.read";

const pounds = (p: number) => Math.round(p) / 100;
const pence = (v: unknown) => Math.round(Number(v ?? 0) * 100);
/** Xero dates come back as "/Date(1700000000000+0000)/". */
const xeroDate = (v: unknown) => {
  const m = String(v ?? "").match(/\/Date\((\d+)/);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(v ?? "").slice(0, 10);
};

export class XeroError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function xeroFetch(fetchImpl: typeof fetch, url: string, init: RequestInit) {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const b = body as { Detail?: string; Message?: string; Elements?: { ValidationErrors?: { Message: string }[] }[]; error?: string } | null;
    const validation = b?.Elements?.flatMap((e) => e.ValidationErrors ?? []).map((v) => v.Message);
    throw new XeroError(validation?.length ? validation.join("; ") : (b?.Detail ?? b?.Message ?? b?.error ?? `Xero error ${res.status}`), res.status);
  }
  return body;
}

export function createXeroAuth(o: { clientId: string; clientSecret: string; redirectUri: string; scopes?: string; fetch?: typeof fetch }): XeroAuth {
  const f = o.fetch ?? fetch;
  const basic = Buffer.from(`${o.clientId}:${o.clientSecret}`).toString("base64");
  const token = async (body: Record<string, string>): Promise<XeroTokens> => {
    const r = (await xeroFetch(f, "https://identity.xero.com/connect/token", {
      method: "POST",
      headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body).toString(),
    })) as { access_token: string; refresh_token: string; expires_in: number };
    return { accessToken: r.access_token, refreshToken: r.refresh_token, expiresAt: new Date(Date.now() + (r.expires_in - 60) * 1000).toISOString() };
  };
  return {
    authorizeUrl(state) {
      const q = new URLSearchParams({ response_type: "code", client_id: o.clientId, redirect_uri: o.redirectUri, scope: o.scopes ?? XERO_DEFAULT_SCOPES, state });
      return `https://login.xero.com/identity/connect/authorize?${q}`;
    },
    exchangeCode: (code) => token({ grant_type: "authorization_code", code, redirect_uri: o.redirectUri }),
    refresh: (refreshToken) => token({ grant_type: "refresh_token", refresh_token: refreshToken }),
    async tenants(accessToken) {
      const r = (await xeroFetch(f, "https://api.xero.com/connections", { headers: { Authorization: `Bearer ${accessToken}` } })) as { id: string; tenantId: string; tenantName: string; tenantType: string }[];
      return r.filter((t) => t.tenantType === "ORGANISATION").map((t) => ({ tenantId: t.tenantId, tenantName: t.tenantName, connectionId: t.id }));
    },
    async disconnect(accessToken, connectionId) {
      if (connectionId) await xeroFetch(f, `https://api.xero.com/connections/${connectionId}`, { method: "DELETE", headers: { Authorization: `Bearer ${accessToken}` } }).catch(() => undefined);
    },
  };
}

export function createXeroClient(o: { accessToken: string; tenantId: string; fetch?: typeof fetch; baseUrl?: string }): XeroClient {
  const f = o.fetch ?? fetch;
  const base = o.baseUrl ?? "https://api.xero.com/api.xro/2.0";
  const call = (path: string, init: RequestInit = {}, idempotencyKey?: string) =>
    xeroFetch(f, `${base}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${o.accessToken}`,
        "xero-tenant-id": o.tenantId,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
      },
    });
  return {
    name: "xero",
    async accounts() {
      const r = (await call("/Accounts")) as { Accounts: { AccountID: string; Code?: string; Name: string; Type: string; Status: string; EnablePaymentsToAccount?: boolean }[] };
      return r.Accounts.filter((a) => a.Status === "ACTIVE").map((a) => ({ accountId: a.AccountID, code: a.Code ?? null, name: a.Name, type: a.Type, enablePayments: Boolean(a.EnablePaymentsToAccount) }));
    },
    async taxRates() {
      const r = (await call("/TaxRates")) as { TaxRates: { Name: string; TaxType: string; EffectiveRate: number | string; Status: string; CanApplyToRevenue?: boolean }[] };
      return r.TaxRates.filter((t) => t.Status === "ACTIVE").map((t) => ({ taxType: t.TaxType, name: t.Name, rate: Number(t.EffectiveRate), revenue: t.CanApplyToRevenue !== false }));
    },
    async upsertInvoice(inv, existingId, key) {
      const body = {
        Invoices: [
          {
            ...(existingId ? { InvoiceID: existingId } : {}),
            Type: "ACCREC",
            Contact: { Name: inv.contact.name, ...(inv.contact.email ? { EmailAddress: inv.contact.email } : {}) },
            Date: inv.date,
            DueDate: inv.dueDate,
            InvoiceNumber: inv.number,
            ...(inv.reference ? { Reference: inv.reference } : {}),
            CurrencyCode: "GBP",
            Status: inv.status,
            LineAmountTypes: "Exclusive",
            LineItems: inv.lines.map((l) => ({ Description: l.description, Quantity: 1, UnitAmount: pounds(l.netPence), AccountCode: l.accountCode, TaxType: l.taxType, TaxAmount: pounds(l.vatPence) })),
          },
        ],
      };
      const r = (await call("/Invoices?summarizeErrors=false", { method: "POST", body: JSON.stringify(body) }, key)) as { Invoices: { InvoiceID: string; HasErrors?: boolean; ValidationErrors?: { Message: string }[] }[] };
      const out = r.Invoices[0];
      if (!out || out.HasErrors) throw new XeroError(out?.ValidationErrors?.map((v) => v.Message).join("; ") || "Xero rejected the invoice", 400);
      return { invoiceId: out.InvoiceID };
    },
    async voidInvoice(invoiceId, draft) {
      await call(`/Invoices/${invoiceId}`, { method: "POST", body: JSON.stringify({ Invoices: [{ InvoiceID: invoiceId, Status: draft ? "DELETED" : "VOIDED" }] }) });
    },
    async createPayment(p, key) {
      const r = (await call(
        "/Payments",
        { method: "PUT", body: JSON.stringify({ Payments: [{ Invoice: { InvoiceID: p.invoiceId }, Account: { AccountID: p.accountId }, Date: p.date, Amount: pounds(p.amountPence), Reference: p.reference }] }) },
        key,
      )) as { Payments: { PaymentID: string }[] };
      return { paymentId: r.Payments[0]!.PaymentID };
    },
    async invoices(ids) {
      if (!ids.length) return [];
      const r = (await call(`/Invoices?IDs=${ids.join(",")}`)) as { Invoices: { InvoiceID: string; Status: string; AmountPaid: number; Payments?: { PaymentID: string; Amount: number; Date: string }[] }[] };
      return r.Invoices.map((i) => ({ invoiceId: i.InvoiceID, status: i.Status, amountPaidPence: pence(i.AmountPaid), payments: (i.Payments ?? []).map((p) => ({ paymentId: p.PaymentID, amountPence: pence(p.Amount), date: xeroDate(p.Date) })) }));
    },
  };
}

/**
 * A stand-in Xero for development and tests: a fixed chart of accounts and
 * tax rates, invoices and payments kept in a JSON file the tests can read
 * (and edit, e.g. to mark an invoice paid "in Xero").
 */
export interface FakeXeroState {
  invoices: Record<string, { input: XeroInvoiceInput; status: string; payments: { paymentId: string; amountPence: number; date: string; ours: boolean }[] }>;
}

export function createFakeXero(o: { load: () => FakeXeroState; save: (s: FakeXeroState) => void }): XeroClient {
  let n = 0;
  const id = (p: string) => `${p}-${Date.now().toString(36)}-${++n}`;
  return {
    name: "fake-xero",
    async accounts() {
      return [
        { accountId: "acc-200", code: "200", name: "Sales", type: "REVENUE", enablePayments: false },
        { accountId: "acc-260", code: "260", name: "Other Revenue", type: "REVENUE", enablePayments: false },
        { accountId: "acc-090", code: "090", name: "Business Bank Account", type: "BANK", enablePayments: true },
        { accountId: "acc-091", code: "091", name: "Stripe clearing", type: "BANK", enablePayments: true },
      ];
    },
    async taxRates() {
      return [
        { taxType: "OUTPUT2", name: "20% (VAT on Income)", rate: 20, revenue: true },
        { taxType: "RROUTPUT", name: "5% (VAT on Income)", rate: 5, revenue: true },
        { taxType: "ZERORATEDOUTPUT", name: "Zero Rated Income", rate: 0, revenue: true },
      ];
    },
    async upsertInvoice(input, existingId) {
      const s = o.load();
      const invoiceId = existingId ?? id("inv");
      s.invoices[invoiceId] = { input, status: input.status, payments: s.invoices[invoiceId]?.payments ?? [] };
      o.save(s);
      return { invoiceId };
    },
    async voidInvoice(invoiceId, draft) {
      const s = o.load();
      if (s.invoices[invoiceId]) s.invoices[invoiceId].status = draft ? "DELETED" : "VOIDED";
      o.save(s);
    },
    async createPayment(p) {
      const s = o.load();
      const paymentId = id("pay");
      const inv = s.invoices[p.invoiceId];
      if (!inv) throw new XeroError("Invoice not found", 404);
      inv.payments.push({ paymentId, amountPence: p.amountPence, date: p.date, ours: true });
      const total = inv.input.lines.reduce((t, l) => t + l.netPence + l.vatPence, 0);
      if (inv.payments.reduce((t, x) => t + x.amountPence, 0) >= total) inv.status = "PAID";
      o.save(s);
      return { paymentId };
    },
    async invoices(ids) {
      const s = o.load();
      return ids.flatMap((i) => {
        const inv = s.invoices[i];
        return inv ? [{ invoiceId: i, status: inv.status, amountPaidPence: inv.payments.reduce((t, x) => t + x.amountPence, 0), payments: inv.payments.map(({ paymentId, amountPence, date }) => ({ paymentId, amountPence, date })) }] : [];
      });
    },
  };
}
