import { AppError } from "../../errors";
import { discardProviderResponseBody, providerFailureDetails } from "../provider-failure";
import { logError } from "../../logging";

const STRIPE_CHECKOUT_SESSIONS_URL = "https://api.stripe.com/v1/checkout/sessions";

export interface StripeCheckoutSessionCreated {
  id: string;
  url?: string;
  client_secret?: string;
}

/** A Checkout endpoint at Stripe, or at a local stand-in that only a test key may reach. */
function checkoutEndpoint(secretKey: string, path: string, apiBase?: string): URL {
  const endpoint = new URL(path, apiBase ?? STRIPE_CHECKOUT_SESSIONS_URL);
  if (
    endpoint.origin !== "https://api.stripe.com" &&
    !(
      secretKey.startsWith("sk_test_") &&
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(endpoint.hostname)
    )
  )
    throw new AppError(500, "STRIPE_CONFIGURATION_INVALID", "Stripe checkout configuration is invalid");
  return endpoint;
}

/**
 * Shared Stripe Checkout transport. Domain services remain responsible for
 * composing their own price, metadata, and redirect parameters.
 */
export async function createStripeCheckoutSession(
  secretKey: string,
  params: URLSearchParams,
  options: { idempotencyKey: string; fetcher?: typeof fetch; apiBase?: string },
): Promise<StripeCheckoutSessionCreated> {
  const endpoint = checkoutEndpoint(secretKey, "/v1/checkout/sessions", options.apiBase);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint.toString(), {
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

/**
 * Closes an open Checkout Session so it can no longer be paid. Best effort: a
 * session that is already complete or expired is refused by Stripe, which is fine.
 */
export async function expireStripeCheckoutSession(
  secretKey: string,
  sessionId: string,
  options: { fetcher?: typeof fetch; apiBase?: string } = {},
): Promise<boolean> {
  try {
    const endpoint = checkoutEndpoint(
      secretKey,
      `/v1/checkout/sessions/${encodeURIComponent(sessionId)}/expire`,
      options.apiBase,
    );
    const response = await (options.fetcher ?? fetch)(endpoint.toString(), {
      method: "POST",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    await discardProviderResponseBody(response);
    return response.ok;
  } catch {
    return false;
  }
}

/** A Checkout Session as Stripe holds it now. Read when its event may not have reached us. */
export async function readStripeCheckoutSession(
  secretKey: string,
  sessionId: string,
  options: { fetcher?: typeof fetch; apiBase?: string } = {},
): Promise<Record<string, unknown>> {
  const endpoint = checkoutEndpoint(
    secretKey,
    `/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    options.apiBase,
  );
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  } catch {
    logError("STRIPE_CHECKOUT_SESSION_READ_FAILED", providerFailureDetails("stripe", "fetch_checkout_session", null));
    throw new AppError(502, "STRIPE_ERROR", "Failed to read the payment page");
  }
  if (!response.ok) {
    logError(
      "STRIPE_CHECKOUT_SESSION_READ_FAILED",
      providerFailureDetails("stripe", "fetch_checkout_session", response.status),
    );
    await discardProviderResponseBody(response);
    throw new AppError(502, "STRIPE_ERROR", "Failed to read the payment page");
  }
  const decoded: unknown = await response.json().catch(() => null);
  if (
    !decoded ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    (decoded as { id?: unknown }).id !== sessionId
  )
    throw new AppError(502, "STRIPE_ERROR", "Stripe returned an invalid payment page");
  return decoded as Record<string, unknown>;
}
