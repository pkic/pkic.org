/**
 * Bounded operational context for an upstream provider failure.
 *
 * Provider response bodies are intentionally excluded: they can contain
 * customer input, credentials-related diagnostics, or unexpectedly large
 * content. This object is safe to carry through AppError, structured logs,
 * and durable outbox diagnostics.
 */
export type ProviderName = "sendgrid" | "stripe";
export type ProviderOperation =
  "send_email" | "create_checkout_session" | "fetch_checkout_session" | "fetch_payment_details";

export interface ProviderFailureDetails {
  kind: "provider_failure";
  provider: ProviderName;
  operation: ProviderOperation;
  status: number | null;
}

export type ProviderResult<T> = { ok: true; value: T } | { ok: false; error: ProviderFailureDetails };

export function providerFailureDetails(
  provider: ProviderName,
  operation: ProviderOperation,
  status: number | null,
): ProviderFailureDetails {
  return { kind: "provider_failure", provider, operation, status };
}

export function providerSuccess<T>(value: T): ProviderResult<T> {
  return { ok: true, value };
}

export function providerFailureResult<T>(error: ProviderFailureDetails): ProviderResult<T> {
  return { ok: false, error };
}

/**
 * Release an unneeded provider response body without reading or parsing it.
 * Cancellation failures must not replace the original normalized failure.
 */
export async function discardProviderResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The provider failure remains the useful, bounded diagnostic.
  }
}
