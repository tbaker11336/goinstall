import { handleBillingEvent } from "@/lib/sms-billing";

/** Stand-in for Stripe subscription Checkout when PAYMENTS_FAKE=true (local development and e2e only). */
function enabled() {
  return process.env.PAYMENTS_FAKE === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL && !process.env.STRIPE_SECRET_KEY;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const sameOrigin = (url: string, base: string) => new URL(url, base).origin === new URL(base).origin;

export async function GET(request: Request) {
  if (!enabled()) return new Response("Not found", { status: 404 });
  const q = new URL(request.url).searchParams;
  const html = `<!doctype html><meta charset="utf-8"><title>Test subscription</title><body style="font-family:sans-serif;max-width:420px;margin:60px auto">
<h1>Test subscription</h1><p>No money moves: this stands in for Stripe while payments aren't configured.</p>
<form method="post">${[...q.entries()].map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join("")}<button>Subscribe</button></form>
<p><a href="${esc(q.get("cancel") ?? "/")}">Cancel</a></p></body>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(request: Request) {
  if (!enabled()) return new Response("Not found", { status: 404 });
  const f = await request.formData();
  const get = (k: string) => String(f.get(k) ?? "");
  const metadata = { company_id: get("company_id"), kind: get("kind") };
  const now = Math.floor(Date.now() / 1000);
  const ids = { customer: `cus_fake_${metadata.company_id.slice(0, 8)}`, subscription: `sub_fake_${metadata.company_id.slice(0, 8)}` };
  await handleBillingEvent({ id: `evt_fake_${now}`, type: "checkout.session.completed", data: { object: { id: `cs_fake_${now}`, mode: "subscription", customer: ids.customer, subscription: ids.subscription, metadata } } });
  await handleBillingEvent({ id: `evt_fake_${now}_s`, type: "customer.subscription.created", data: { object: { id: ids.subscription, customer: ids.customer, status: "active", metadata, current_period_start: now, current_period_end: now + 30 * 86_400 } } });
  const success = get("success");
  return Response.redirect(sameOrigin(success, request.url) ? new URL(success, request.url) : new URL("/", request.url), 303);
}
