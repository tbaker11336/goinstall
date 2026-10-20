import { handleStripeEvent } from "@/lib/stripe-events";
import { withService } from "@goinstall/db";
import { db } from "@/lib/db";

/** Stand-in for Stripe Checkout when PAYMENTS_FAKE=true (local development and e2e only). */
function enabled() {
  return process.env.PAYMENTS_FAKE === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL && !process.env.STRIPE_SECRET_KEY;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const sameOrigin = (url: string, base: string) => new URL(url, base).origin === new URL(base).origin;

export async function GET(request: Request) {
  if (!enabled()) return new Response("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const pounds = (Number(q.get("amount")) / 100).toFixed(2);
  const html = `<!doctype html><meta charset="utf-8"><title>Test checkout</title><body style="font-family:sans-serif;max-width:420px;margin:60px auto">
<h1>Test card payment</h1><p>No money moves: this stands in for Stripe while payments aren't configured.</p><p>Amount: £${pounds}</p>
<form method="post">${[...q.entries()].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}<button>Pay £${pounds}</button></form>
<p><a href="${esc(q.get("cancel") ?? "/")}">Cancel</a></p></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request) {
  if (!enabled()) return new Response("Not found", { status: 404 });
  const f = await request.formData();
  const get = (k: string) => String(f.get(k) ?? "");
  const company = await withService(db(), (tx) => tx.selectFrom("companies").select("stripe_account_id").where("id", "=", get("company_id")).executeTakeFirst());
  await handleStripeEvent({
    id: `evt_fake_${Date.now()}`,
    type: "checkout.session.completed",
    account: company?.stripe_account_id ?? undefined,
    data: { object: { id: `cs_fake_${get("invoice_id")}`, payment_status: "paid", amount_total: Number(get("amount")), metadata: { invoice_id: get("invoice_id"), company_id: get("company_id") } } },
  });
  const success = get("success");
  return Response.redirect(sameOrigin(success, request.url) ? new URL(success, request.url) : new URL("/", request.url), 303);
}
