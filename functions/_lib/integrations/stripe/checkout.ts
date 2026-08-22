import { AppError } from "../../errors";
import { discardProviderResponseBody, providerFailureDetails } from "../provider-failure";
import { logError } from "../../logging";

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
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(STRIPE_CHECKOUT_SESSIONS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Idempotency-Key": options.idempotencyKey,
      },
      body: params.toString(),
    });
  } catch {
    const details = providerFailureDetails("stripe", "create_checkout_session", null);
    logError("STRIPE_CHECKOUT_SESSION_CREATE_FAILED", details);
    throw new AppError(502, "STRIPE_ERROR", "Failed to create checkout session", details);
  }

  if (!response.ok) {
    // Stripe's body can echo customer input. Log only bounded metadata.
    const details = providerFailureDetails("stripe", "create_checkout_session", response.status);
    await discardProviderResponseBody(response);
    logError("STRIPE_CHECKOUT_SESSION_CREATE_FAILED", details);
    throw new AppError(502, "STRIPE_ERROR", "Failed to create checkout session", details);
  }
  let decoded: unknown;
  try {
    decoded = await response.json();
  } catch {
    const details = providerFailureDetails("stripe", "create_checkout_session", response.status);
    logError("STRIPE_CHECKOUT_SESSION_CREATE_FAILED", details);
    throw new AppError(502, "STRIPE_ERROR", "Stripe returned an invalid checkout session", details);
  }
  if (
    !decoded ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    typeof (decoded as { id?: unknown }).id !== "string"
  ) {
    const details = providerFailureDetails("stripe", "create_checkout_session", response.status);
    logError("STRIPE_CHECKOUT_SESSION_CREATE_FAILED", details);
    throw new AppError(502, "STRIPE_ERROR", "Stripe returned an invalid checkout session", details);
  }
  const session = decoded as StripeCheckoutSessionCreated;
  if (!session.id) {
    const details = providerFailureDetails("stripe", "create_checkout_session", response.status);
    logError("STRIPE_CHECKOUT_SESSION_CREATE_FAILED", details);
    throw new AppError(502, "STRIPE_ERROR", "Stripe did not return a checkout session id", details);
  }
  return session;
}
