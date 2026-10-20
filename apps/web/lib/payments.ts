import "server-only";
import { createStripePayments, type PaymentsProvider } from "@goinstall/integrations";

/**
 * Stripe when STRIPE_SECRET_KEY is set. Otherwise card payments are off and
 * the customer is shown bank transfer only, unless PAYMENTS_FAKE=true (local
 * development and e2e only), which sends Checkout to a local test page.
 */
export function payments(): PaymentsProvider | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (key) return createStripePayments({ secretKey: key });
  if (process.env.PAYMENTS_FAKE === "true" && process.env.NODE_ENV !== "production" && !process.env.VERCEL) return fakePayments;
  return null;
}

const fakePayments: PaymentsProvider = {
  name: "fake",
  async createCheckout(req) {
    const q = new URLSearchParams({ amount: String(req.amountPence), success: req.successUrl, cancel: req.cancelUrl, ...req.metadata });
    return { id: `cs_fake_${req.idempotencyKey}`, url: `/api/dev/fake-checkout?${q}` };
  },
  async startOnboarding({ existingAccountId, returnUrl }) {
    return { accountId: existingAccountId ?? "acct_fake", url: returnUrl };
  },
  async accountReady() {
    return true;
  },
};
