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

export async function fetchStripeCheckoutSession(
  stripeKey: string,
  sessionId: string,
  fetcher: FetchLike = fetch,
): Promise<StripeCheckoutSession | null> {
  const response = await fetcher(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  if (!response.ok) return null;
  return (await response.json()) as StripeCheckoutSession;
}

/** One expanded Stripe request for settlement, method, and failure state. */
export async function fetchStripePaymentDetails(
  stripeKey: string,
  paymentIntentId: string,
  fetcher: FetchLike = fetch,
): Promise<StripePaymentDetails> {
  const url =
    `https://api.stripe.com/v1/payment_intents/${encodeURIComponent(paymentIntentId)}` +
    "?expand[]=latest_charge.balance_transaction";
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${stripeKey}` } });
  if (!response.ok) {
    console.error("Stripe payment-intent fetch failed", response.status, await response.text());
    return EMPTY_DETAILS;
  }

  const intent = (await response.json()) as StripePaymentIntent;
  if (!intent.latest_charge || typeof intent.latest_charge === "string") {
    const committedMethod =
      intent.status === "requires_action" || intent.status === "processing"
        ? (intent.payment_method_types?.[0] ?? null)
        : null;
    return {
      ...EMPTY_DETAILS,
      paymentMethodType: committedMethod ?? intent.payment_method_types?.[0] ?? null,
      paymentFailed: intent.status === "requires_payment_method" && Boolean(intent.last_payment_error),
    };
  }

  const charge = intent.latest_charge;
  const paymentMethodType = charge.payment_method_details?.type ?? null;
  if (charge.failure_code) return { ...EMPTY_DETAILS, paymentMethodType, paymentFailed: true };
  if (!charge.balance_transaction || typeof charge.balance_transaction === "string") {
    return { ...EMPTY_DETAILS, paymentMethodType };
  }

  return {
    netAmount: charge.balance_transaction.net ?? null,
    settledAmount: charge.balance_transaction.amount ?? null,
    settledCurrency: charge.balance_transaction.currency ?? null,
    paymentMethodType,
    paymentFailed: false,
  };
}
