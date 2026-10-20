import { verifyStripeWebhook } from "@goinstall/integrations";
import { handleStripeEvent } from "@/lib/stripe-events";

/** Stripe Connect webhook (checkout.session.completed on connected accounts). */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("Webhook not configured", { status: 503 });
  const payload = await request.text();
  let event;
  try {
    event = verifyStripeWebhook(payload, request.headers.get("stripe-signature"), secret);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }
  const result = await handleStripeEvent(event);
  return Response.json(result);
}
