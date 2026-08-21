import { AppError } from "../../errors";

const STRIPE_CHECKOUT_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";

export interface StripeCheckoutSessionCreated {
  id: string;
  url?: string;
  client_secret?: string;
}

/**
 * Shared Stripe Checkout transport. Domain services remain responsible for
 * composing their own price, metadata, and redirect parameters.
 */
export async function createStripeCheckoutSession(
  secretKey: string,
  params: URLSearchParams,
  options: { idempotencyKey: string; fetcher?: typeof fetch },
): Promise<StripeCheckoutSessionCreated> {
  const response = await (options.fetcher ?? fetch)(STRIPE_CHECKOUT_SESSIONS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": options.idempotencyKey,
    },
    body: params.toString(),
  });

  if (!response.ok) {
    // Stripe's body can echo customer input. Log only the processor status.
    console.error("Stripe checkout-session creation failed", response.status);
    throw new AppError(502, "STRIPE_ERROR", "Failed to create checkout session");
  }
  const session = (await response.json()) as StripeCheckoutSessionCreated;
  if (!session.id) throw new AppError(502, "STRIPE_ERROR", "Stripe did not return a checkout session id");
  return session;
}
