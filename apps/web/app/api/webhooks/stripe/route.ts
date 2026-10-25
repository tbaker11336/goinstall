import { verifyStripeWebhook, type StripeEvent } from "@goinstall/integrations";
import { handleBillingEvent } from "@/lib/sms-billing";
import { handleStripeEvent } from "@/lib/stripe-events";

/**
 * Stripe webhooks. Connected-account events (customer deposits and balances)
 * carry `account`; GoInstall's own billing (the SMS add-on) doesn't. Each
 * webhook endpoint in Stripe has its own signing secret.
 */
export async function POST(request: Request) {
  const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_PLATFORM_WEBHOOK_SECRET].filter((s): s is string => Boolean(s));
  if (!secrets.length) return new Response("Webhook not configured", { status: 503 });
  const payload = await request.text();
  const header = request.headers.get("stripe-signature");
  let event: StripeEvent | null = null;
  for (const secret of secrets) {
    try {
      event = verifyStripeWebhook(payload, header, secret);
      break;
    } catch {
      // try the next endpoint's secret
    }
  }
  if (!event) return new Response("Invalid signature", { status: 400 });
  return Response.json(event.account ? await handleStripeEvent(event) : await handleBillingEvent(event));
}
