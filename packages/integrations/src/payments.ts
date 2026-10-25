/**
 * Card payments through Stripe Connect: each installer company has its own
 * connected Stripe account and is paid directly (spec: Payments). Uses the
 * REST API directly; webhooks are verified with the endpoint secret.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export interface CheckoutRequest {
  amountPence: number;
  description: string;
  customerEmail?: string | null;
  successUrl: string;
  cancelUrl: string;
  /** Echoed back on the webhook, e.g. invoice and company ids. */
  metadata: Record<string, string>;
  /** Connected account (acct_...) the charge is made on. */
  connectedAccountId: string;
  idempotencyKey: string;
}

export interface PaymentsProvider {
  readonly name: string;
  createCheckout(req: CheckoutRequest): Promise<{ id: string; url: string }>;
  /** Create a Standard connected account for a company and return an onboarding link. */
  startOnboarding(input: { email: string | null; companyName: string; existingAccountId: string | null; refreshUrl: string; returnUrl: string }): Promise<{ accountId: string; url: string }>;
  accountReady(accountId: string): Promise<boolean>;
}

function form(data: Record<string, string | number | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null) p.append(k, String(v));
  return p.toString();
}

type StripeCall = <T>(path: string, body: Record<string, string | number | undefined | null> | null, opts?: { account?: string; idempotencyKey?: string; method?: string }) => Promise<T>;

function stripeCaller(secretKey: string, fetchImpl: typeof fetch): StripeCall {
  return async function call<T>(path: string, body: Record<string, string | number | undefined | null> | null, opts: { account?: string; idempotencyKey?: string; method?: string } = {}): Promise<T> {
    const res = await fetchImpl(`https://api.stripe.com/v1${path}`, {
      method: opts.method ?? (body ? "POST" : "GET"),
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        ...(opts.account ? { "Stripe-Account": opts.account } : {}),
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
      },
      body: body ? form(body) : undefined,
    });
    const json = (await res.json()) as T & { error?: { message: string } };
    if (!res.ok) throw new Error(`Stripe: ${json.error?.message ?? res.status}`);
    return json;
  };
}

export function createStripePayments({ secretKey, fetch: fetchImpl = fetch }: { secretKey: string; fetch?: typeof fetch }): PaymentsProvider {
  const call = stripeCaller(secretKey, fetchImpl);
  return {
    name: "stripe",
    async createCheckout(req) {
      const meta: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.metadata)) {
        meta[`metadata[${k}]`] = v;
        meta[`payment_intent_data[metadata][${k}]`] = v;
      }
      const s = await call<{ id: string; url: string }>(
        "/checkout/sessions",
        {
          mode: "payment",
          "line_items[0][quantity]": 1,
          "line_items[0][price_data][currency]": "gbp",
          "line_items[0][price_data][unit_amount]": req.amountPence,
          "line_items[0][price_data][product_data][name]": req.description,
          customer_email: req.customerEmail ?? undefined,
          success_url: req.successUrl,
          cancel_url: req.cancelUrl,
          ...meta,
        },
        { account: req.connectedAccountId, idempotencyKey: req.idempotencyKey },
      );
      return { id: s.id, url: s.url };
    },
    async startOnboarding({ email, companyName, existingAccountId, refreshUrl, returnUrl }) {
      const accountId =
        existingAccountId ??
        (await call<{ id: string }>("/accounts", { type: "standard", country: "GB", email: email ?? undefined, "business_profile[name]": companyName })).id;
      const link = await call<{ url: string }>("/account_links", { account: accountId, refresh_url: refreshUrl, return_url: returnUrl, type: "account_onboarding" });
      return { accountId, url: link.url };
    },
    async accountReady(accountId) {
      const a = await call<{ charges_enabled?: boolean }>(`/accounts/${accountId}`, null);
      return Boolean(a.charges_enabled);
    },
  };
}

/**
 * GoInstall's own billing (add-ons such as SMS), on the platform Stripe
 * account: separate from the companies' connected accounts.
 */
export interface PlatformBilling {
  readonly name: string;
  /** Checkout for a monthly subscription to a Stripe price. */
  createSubscriptionCheckout(req: { priceId: string; customerEmail?: string | null; customerId?: string | null; successUrl: string; cancelUrl: string; metadata: Record<string, string>; idempotencyKey: string }): Promise<{ id: string; url: string }>;
  /** A one-off charge on the customer's next (or a given draft) invoice, e.g. texts over the allowance. */
  addInvoiceItem(req: { customerId: string; invoiceId?: string; amountPence: number; description: string; idempotencyKey: string }): Promise<void>;
  /** Stripe's own page for updating the card, seeing invoices or cancelling. */
  portal(req: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
}

export function createStripeBilling({ secretKey, fetch: fetchImpl = fetch }: { secretKey: string; fetch?: typeof fetch }): PlatformBilling {
  const call = stripeCaller(secretKey, fetchImpl);
  return {
    name: "stripe",
    async createSubscriptionCheckout(req) {
      const meta: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.metadata)) {
        meta[`metadata[${k}]`] = v;
        meta[`subscription_data[metadata][${k}]`] = v;
      }
      const s = await call<{ id: string; url: string }>(
        "/checkout/sessions",
        {
          mode: "subscription",
          "line_items[0][price]": req.priceId,
          "line_items[0][quantity]": 1,
          customer: req.customerId ?? undefined,
          customer_email: req.customerId ? undefined : (req.customerEmail ?? undefined),
          success_url: req.successUrl,
          cancel_url: req.cancelUrl,
          ...meta,
        },
        { idempotencyKey: req.idempotencyKey },
      );
      return { id: s.id, url: s.url };
    },
    async addInvoiceItem(req) {
      await call("/invoiceitems", { customer: req.customerId, invoice: req.invoiceId, amount: req.amountPence, currency: "gbp", description: req.description }, { idempotencyKey: req.idempotencyKey });
    },
    async portal(req) {
      const s = await call<{ url: string }>("/billing_portal/sessions", { customer: req.customerId, return_url: req.returnUrl });
      return { url: s.url };
    },
  };
}

export interface StripeEvent {
  id: string;
  type: string;
  account?: string;
  data: { object: Record<string, unknown> & { id: string; metadata?: Record<string, string>; amount_total?: number; payment_status?: string; payment_intent?: string } };
}

/**
 * Verify a Stripe webhook (Stripe-Signature: t=…,v1=…) and parse the event.
 * Rejects stale timestamps to stop replays.
 */
export function verifyStripeWebhook(payload: string, header: string | null, secret: string, opts: { toleranceSec?: number; now?: number } = {}): StripeEvent {
  if (!header) throw new Error("Missing Stripe-Signature");
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const t = Number(parts.t);
  const signatures = header
    .split(",")
    .filter((kv) => kv.startsWith("v1="))
    .map((kv) => kv.slice(3));
  if (!t || !signatures.length) throw new Error("Malformed Stripe-Signature");
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - t) > (opts.toleranceSec ?? 300)) throw new Error("Stripe webhook timestamp outside tolerance");
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`).digest();
  const ok = signatures.some((s) => {
    const got = Buffer.from(s, "hex");
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
  if (!ok) throw new Error("Stripe webhook signature mismatch");
  return JSON.parse(payload) as StripeEvent;
}

/** For tests: sign a payload the way Stripe does. */
export function signStripePayload(payload: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex")}`;
}
