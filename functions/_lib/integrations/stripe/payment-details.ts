import { logError } from "../../logging";
import {
  providerFailureDetails,
  providerFailureResult,
  providerSuccess,
  discardProviderResponseBody,
  type ProviderResult,
} from "../provider-failure";

export interface StripeCheckoutSession {
  id: string;
  object?: "checkout.session";
  status?: "open" | "complete" | "expired";
  payment_status?: string | null;
  payment_intent: string | null;
  payment_method_types?: string[] | null;
  expires_at?: number | null;
  amount_total: number | null;
  currency: string;
  customer_email: string | null;
  metadata?: Record<string, string> | null;
  customer_details?: { email?: string | null; name?: string | null } | null;
}

interface StripeBalanceTransactionExpanded {
  id: string;
  net: number;
  amount: number;
  currency: string;
}

interface StripeChargeExpanded {
  id: string;
  balance_transaction: string | StripeBalanceTransactionExpanded | null;
  failure_code: string | null;
  payment_method_details?: { type: string } | null;
}

interface StripePaymentIntent {
  id: string;
  status: string;
  latest_charge: string | StripeChargeExpanded | null;
  last_payment_error: { code: string; type: string } | null;
  payment_method_types?: string[] | null;
}

export interface StripePaymentDetails {
  netAmount: number | null;
  settledAmount: number | null;
  settledCurrency: string | null;
  paymentMethodType: string | null;
  paymentFailed: boolean;
}

const EMPTY_DETAILS: StripePaymentDetails = {
  netAmount: null,
  settledAmount: null,
  settledCurrency: null,
  paymentMethodType: null,
  paymentFailed: false,
};

type FetchLike = typeof fetch;

function isFetchedStripeCheckoutSession(value: unknown): value is StripeCheckoutSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return (
    typeof session.id === "string" &&
    session.id.length > 0 &&
    (session.status === "open" || session.status === "complete" || session.status === "expired") &&
    (typeof session.payment_status === "string" || session.payment_status === null) &&
    (typeof session.payment_intent === "string" || session.payment_intent === null) &&
    (typeof session.amount_total === "number" || session.amount_total === null) &&
    typeof session.currency === "string" &&
    (typeof session.customer_email === "string" || session.customer_email === null)
  );
}

export async function fetchStripeCheckoutSession(
  stripeKey: string,
  sessionId: string,
  fetcher: FetchLike = fetch,
): Promise<ProviderResult<StripeCheckoutSession>> {
  const operation = "fetch_checkout_session" as const;
  let response: Response;
  try {
    response = await fetcher(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
  } catch {
    const error = providerFailureDetails("stripe", operation, null);
    logError("STRIPE_CHECKOUT_SESSION_FETCH_FAILED", error);
    return providerFailureResult(error);
  }
  if (!response.ok) {
    const error = providerFailureDetails("stripe", operation, response.status);
    await discardProviderResponseBody(response);
    logError("STRIPE_CHECKOUT_SESSION_FETCH_FAILED", error);
    return providerFailureResult(error);
  }
  try {
    const decoded: unknown = await response.json();
    if (!isFetchedStripeCheckoutSession(decoded)) {
      const error = providerFailureDetails("stripe", operation, response.status);
      logError("STRIPE_CHECKOUT_SESSION_FETCH_FAILED", error);
      return providerFailureResult(error);
    }
    return providerSuccess(decoded);
  } catch {
    const error = providerFailureDetails("stripe", operation, response.status);
    logError("STRIPE_CHECKOUT_SESSION_FETCH_FAILED", error);
    return providerFailureResult(error);
  }
}

/** One expanded Stripe request for settlement, method, and failure state. */
export async function fetchStripePaymentDetails(
  stripeKey: string,
  paymentIntentId: string,
  fetcher: FetchLike = fetch,
): Promise<ProviderResult<StripePaymentDetails>> {
  const url =
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}` +
    "?expand[]=latest_charge.balance_transaction";
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Authorization: `Bearer ${stripeKey}` } });
  } catch {
    const error = providerFailureDetails("stripe", "fetch_payment_details", null);
    logError("STRIPE_PAYMENT_DETAILS_FETCH_FAILED", error);
    return providerFailureResult(error);
  }
  if (!response.ok) {
    const error = providerFailureDetails("stripe", "fetch_payment_details", response.status);
    await discardProviderResponseBody(response);
    logError("STRIPE_PAYMENT_DETAILS_FETCH_FAILED", error);
    return providerFailureResult(error);
  }

  let intent: StripePaymentIntent;
  try {
    const decoded: unknown = await response.json();
    if (
      !decoded ||
      typeof decoded !== "object" ||
      Array.isArray(decoded) ||
      typeof (decoded as { id?: unknown }).id !== "string" ||
      typeof (decoded as { status?: unknown }).status !== "string" ||
      !("latest_charge" in decoded)
    ) {
      const error = providerFailureDetails("stripe", "fetch_payment_details", response.status);
      logError("STRIPE_PAYMENT_DETAILS_FETCH_FAILED", error);
      return providerFailureResult(error);
    }
    intent = decoded as StripePaymentIntent;
  } catch {
    const error = providerFailureDetails("stripe", "fetch_payment_details", response.status);
    logError("STRIPE_PAYMENT_DETAILS_FETCH_FAILED", error);
    return providerFailureResult(error);
  }
  if (!intent.latest_charge || typeof intent.latest_charge === "string") {
    const committedMethod =
      intent.status === "requires_action" || intent.status === "processing"
        ? (intent.payment_method_types?.[0] ?? null)
        : null;
    return providerSuccess({
      ...EMPTY_DETAILS,
      paymentMethodType: committedMethod ?? intent.payment_method_types?.[0] ?? null,
      paymentFailed: intent.status === "requires_payment_method" && Boolean(intent.last_payment_error),
    });
  }

  const charge = intent.latest_charge;
  const paymentMethodType = charge.payment_method_details?.type ?? null;
  if (charge.failure_code) return providerSuccess({ ...EMPTY_DETAILS, paymentMethodType, paymentFailed: true });
  if (!charge.balance_transaction || typeof charge.balance_transaction === "string") {
    return providerSuccess({ ...EMPTY_DETAILS, paymentMethodType });
  }

  return providerSuccess({
    netAmount: charge.balance_transaction.net ?? null,
    settledAmount: charge.balance_transaction.amount ?? null,
    settledCurrency: charge.balance_transaction.currency ?? null,
    paymentMethodType,
    paymentFailed: false,
  });
}
