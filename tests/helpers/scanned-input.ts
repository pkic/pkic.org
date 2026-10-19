import { boundedScannedValue } from "../../assets/shared/schemas/scanner-attempt-capture";

/** Synthetic capture happens before credential normalization, using the test's actual input once.
 * Explicit capture fields remain available for deliberately malformed protocol fixtures.
 */
export function withScannedInput<Body extends { badgeId: string }>(
  body: Body,
): Body & ReturnType<typeof boundedScannedValue> {
  return { ...boundedScannedValue(body.badgeId), ...body };
}
