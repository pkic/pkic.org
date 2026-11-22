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

/** Find a refund after an uncertain create response, before retrying a request whose idempotency key may expire. */
export async function findStripeRefundByRequest(
  secretKey: string,
  input: { paymentIntentId: string; ticketId: string; refundId: string; amount: number },
  options: { fetcher?: typeof fetch; apiBase?: string } = {},
): Promise<{ id: string; status: string | null } | null> {
  let after: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const endpoint = refundEndpoint(secretKey, "/v1/refunds", options.apiBase);
    endpoint.searchParams.set("payment_intent", input.paymentIntentId);
    endpoint.searchParams.set("limit", "100");
    if (after) endpoint.searchParams.set("starting_after", after);
    let response: Response;
    try {
      response = await (options.fetcher ?? fetch)(endpoint.toString(), {
        method: "GET",
        headers: { Authorization: `Bearer ${secretKey}` },
      });
    } catch {
      throw new AppError(502, "STRIPE_ERROR", "Failed to check the refund at the payment provider");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AppError(502, "STRIPE_ERROR", "Failed to check the refund at the payment provider");
    }
    const decoded: unknown = await response.json().catch(() => null);
    if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
      throw new AppError(502, "STRIPE_ERROR", "The payment provider returned an invalid refund list");
    const list = decoded as { data?: unknown; has_more?: unknown };
    if (!Array.isArray(list.data) || typeof list.has_more !== "boolean")
      throw new AppError(502, "STRIPE_ERROR", "The payment provider returned an invalid refund list");
    for (const value of list.data) {
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new AppError(502, "STRIPE_ERROR", "The payment provider returned an invalid refund");
      const refund = value as Record<string, unknown>;
      if (typeof refund.id !== "string" || !/^re_[A-Za-z0-9_]+$/.test(refund.id))
        throw new AppError(502, "STRIPE_ERROR", "The payment provider returned an invalid refund");
      if (
        refund.payment_intent === input.paymentIntentId &&
        refund.metadata &&
        typeof refund.metadata === "object" &&
        !Array.isArray(refund.metadata) &&
        (refund.metadata as Record<string, unknown>).registrationTicketId === input.ticketId &&
        (refund.metadata as Record<string, unknown>).registrationTicketRefundId === input.refundId
      ) {
        if (
          refund.amount !== input.amount ||
          typeof refund.status !== "string" ||
          !["pending", "requires_action", "succeeded", "failed", "canceled"].includes(refund.status)
        )
          throw new AppError(
            502,
            "STRIPE_ERROR",
            "The payment provider returned a refund that does not match the request",
          );
        return { id: refund.id, status: refund.status };
      }
    }
    if (!list.has_more) return null;
    const last = list.data.at(-1) as { id?: unknown } | undefined;
    if (!last || typeof last.id !== "string" || !last.id)
      throw new AppError(502, "STRIPE_ERROR", "The payment provider returned an incomplete refund list");
    after = last.id;
  }
  throw new AppError(502, "STRIPE_ERROR", "The payment provider returned too many refunds to check safely");
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

/** One refund as Stripe holds it now. Read when its event may not have reached us. */
export async function readStripeRefund(
  secretKey: string,
  refundId: string,
  options: { fetcher?: typeof fetch; apiBase?: string } = {},
): Promise<Record<string, unknown>> {
  const endpoint = refundEndpoint(secretKey, `/v1/refunds/${encodeURIComponent(refundId)}`, options.apiBase);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(endpoint.toString(), {
      method: "GET",
      headers: { Authorization: `Bearer ${secretKey}` },
    });
  } catch {
    logError("STRIPE_REFUND_READ_FAILED", { status: null });
    throw new AppError(502, "STRIPE_ERROR", "Failed to read the refund");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    logError("STRIPE_REFUND_READ_FAILED", { status: response.status });
    throw new AppError(502, "STRIPE_ERROR", "Failed to read the refund");
  }
  const decoded: unknown = await response.json().catch(() => null);
  if (
    !decoded ||
    typeof decoded !== "object" ||
    Array.isArray(decoded) ||
    (decoded as { id?: unknown }).id !== refundId
  )
    throw new AppError(502, "STRIPE_ERROR", "Stripe returned an invalid refund");
  return decoded as Record<string, unknown>;
}
