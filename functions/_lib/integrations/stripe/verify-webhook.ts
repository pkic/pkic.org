import { constantTimeEqual, hmacSha256Hex } from "../../utils/crypto";

export const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;

/**
 * Verifies Stripe's signed raw request body, including multiple `v1`
 * signatures emitted during endpoint-secret rotation.
 */
export async function verifyStripeWebhookSignature(
  rawBody: string,
  signatureHeader: string,
  secrets: string | readonly string[],
  options: { nowSeconds?: number; toleranceSeconds?: number } = {},
): Promise<boolean> {
  const timestamps: string[] = [];
  const signatures: string[] = [];
  for (const rawPart of signatureHeader.split(",")) {
    const part = rawPart.trim();
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    const key = part.slice(0, separator);
    const value = part.slice(separator + 1);
    if (key === "t") timestamps.push(value);
    if (key === "v1") signatures.push(value.toLowerCase());
  }

  if (timestamps.length !== 1 || signatures.length === 0) return false;
  const timestamp = timestamps[0];
  if (!/^\d+$/.test(timestamp)) return false;
  const parsedTimestamp = Number(timestamp);
  if (!Number.isSafeInteger(parsedTimestamp)) return false;

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const toleranceSeconds = options.toleranceSeconds ?? STRIPE_WEBHOOK_TOLERANCE_SECONDS;
  if (Math.abs(nowSeconds - parsedTimestamp) > toleranceSeconds) return false;

  const configuredSecrets = (typeof secrets === "string" ? [secrets] : [...secrets]).filter(Boolean);
  if (configuredSecrets.length === 0) return false;
  const payload = `${timestamp}.${rawBody}`;
  for (const secret of configuredSecrets) {
    const expected = await hmacSha256Hex(secret, payload);
    for (const candidate of signatures) {
      if (await constantTimeEqual(expected, candidate)) return true;
    }
  }
  return false;
}
