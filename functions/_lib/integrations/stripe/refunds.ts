import { AppError } from "../../errors";
import { logError } from "../../logging";

const STRIPE_API_ORIGIN = "https://api.stripe.com";

/** Stripe itself, or a local stand-in when a test key is used. */
function refundEndpoint(secretKey: string, path: string, apiBase?: string): URL {
  const endpoint = new URL(path, apiBase ?? STRIPE_API_ORIGIN);
  if (
    endpoint.origin !== STRIPE_API_ORIGIN &&
    !(
      secretKey.startsWith("sk_test_") &&
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(endpoint.hostname)
    )
  )
    throw new AppError(500, "STRIPE_CONFIGURATION_INVALID", "Stripe refund configuration is invalid");
  return endpoint;
}

/** Raised when Stripe refuses a refund as asked: sending the same request again gives the same answer. */
export const STRIPE_REFUND_REFUSED = "STRIPE_REFUND_REFUSED";

/** Asks Stripe to refund part or all of a payment. The idempotency key makes a retry the same refund. */
export async function createStripeRefund(
  secretKey: string,
  input: { paymentIntentId: string; amount: number; metadata: Record<string, string> },
  options: { idempotencyKey: string; fetcher?: typeof fetch; apiBase?: string },
): Promise<{ id: string; status: string | null }> {
  const endpoint = refundEndpoint(secretKey, "/v1/refunds", options.apiBase);
  const params = new URLSearchParams({ payment_intent: input.paymentIntentId, amount: String(input.amount) });
  for (const [key, value] of Object.entries(input.metadata)) params.set(`metadata[${key}]`, value);
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
    logError("STRIPE_REFUND_CREATE_FAILED", { status: null });
    throw new AppError(502, "STRIPE_ERROR", "Failed to create the refund");
  }
  if (!response.ok) {
    // Stripe's body can echo customer input. Log only the status.
    await response.body?.cancel().catch(() => undefined);
    logError("STRIPE_REFUND_CREATE_FAILED", { status: response.status });
    // A request Stripe judged and refused is final; a busy, unauthorized or conflicting one is worth another try.
    if ([400, 402, 404].includes(response.status))
      throw new AppError(502, STRIPE_REFUND_REFUSED, "The payment provider refused the refund");
    throw new AppError(502, "STRIPE_ERROR", "Failed to create the refund");
  }
  const decoded = (await response.json().catch(() => null)) as {
    id?: unknown;
    status?: unknown;
    created?: unknown;
  } | null;
  if (!decoded || typeof decoded.id !== "string" || !decoded.id)
    throw new AppError(502, "STRIPE_ERROR", "Stripe returned an invalid refund");
  return { id: decoded.id, status: typeof decoded.status === "string" ? decoded.status : null };
}

/**
 * What Stripe holds right now for a payment: how much of it has been returned,
 * and whether all of it has. Read when our own record cannot be trusted, such
 * as after a refund failed.
 */
export async function readStripeRefundedTotal(
  secretKey: string,
  paymentIntentId: string,
  options: { fetcher?: typeof fetch; apiBase?: string } = {},
): Promise<{ amountRefunded: number; refunded: boolean }> {
  const endpoint = refundEndpoint(
    secretKey,
    `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`,
    options.apiBase,
  );
  endpoint.searchParams.set("expand[]", "latest_charge");
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  } catch {
    logError("STRIPE_REFUND_TOTAL_READ_FAILED", { status: null });
    throw new AppError(502, "STRIPE_ERROR", "Failed to read the payment");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    logError("STRIPE_REFUND_TOTAL_READ_FAILED", { status: response.status });
    throw new AppError(502, "STRIPE_ERROR", "Failed to read the payment");
  }
  const decoded = (await response.json().catch(() => null)) as {
    latest_charge?: { amount_refunded?: unknown; refunded?: unknown } | null;
  } | null;
  const charge = decoded?.latest_charge;
  if (!charge || typeof charge !== "object" || typeof charge.amount_refunded !== "number" || charge.amount_refunded < 0)
    throw new AppError(502, "STRIPE_ERROR", "Stripe returned an invalid payment");
  return { amountRefunded: charge.amount_refunded, refunded: charge.refunded === true };
}
