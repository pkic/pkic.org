import { AppError } from "../../errors";
import { logError } from "../../logging";

const STRIPE_REFUNDS_URL = "https://api.stripe.com/v1/refunds";

/** Raised when Stripe refuses a refund as asked: sending the same request again gives the same answer. */
export const STRIPE_REFUND_REFUSED = "STRIPE_REFUND_REFUSED";

/** Asks Stripe to refund part or all of a payment. The idempotency key makes a retry the same refund. */
export async function createStripeRefund(
  secretKey: string,
  input: { paymentIntentId: string; amount: number; metadata: Record<string, string> },
  options: { idempotencyKey: string; fetcher?: typeof fetch; apiBase?: string },
): Promise<{ id: string; status: string | null }> {
  const endpoint = options.apiBase ? new URL("/v1/refunds", options.apiBase) : new URL(STRIPE_REFUNDS_URL);
  if (
    endpoint.origin !== "https://api.stripe.com" &&
    !(
      secretKey.startsWith("sk_test_") &&
      endpoint.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(endpoint.hostname)
    )
  )
    throw new AppError(500, "STRIPE_CONFIGURATION_INVALID", "Stripe refund configuration is invalid");
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
  const decoded = (await response.json().catch(() => null)) as { id?: unknown; status?: unknown } | null;
  if (!decoded || typeof decoded.id !== "string" || !decoded.id)
    throw new AppError(502, "STRIPE_ERROR", "Stripe returned an invalid refund");
  return { id: decoded.id, status: typeof decoded.status === "string" ? decoded.status : null };
}
