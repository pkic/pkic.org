import { sha256Hex } from "./sha256";
import { offlineEligibilityResponseSchema } from "./schemas/event-offline-eligibility";

// Canonical projection and key order in both runtimes. Lease timestamps and draft edits
// do not change the eligibility content; enrollment is checked by the HTTP boundary.
const pageBasisSchema = offlineEligibilityResponseSchema
  .pick({
    eventId: true,
    operatorUserId: true,
    occurrenceId: true,
    roomId: true,
    publishedRevision: true,
    nativeEventContext: true,
    scopeDate: true,
    session: true,
    entries: true,
    nextBadgeId: true,
  })
  .extend({ roomId: offlineEligibilityResponseSchema.shape.roomId.default(null) })
  .strip();

const scopeBasisSchema = pageBasisSchema.omit({ entries: true, nextBadgeId: true });

/** Compare scope metadata without hashing the same empty page on every request. */
export function eligibilityScopeKey(value: unknown): string {
  return JSON.stringify(scopeBasisSchema.parse(value));
}

/** Fingerprint a bounded page of current eligibility without storing a second server read model. */
export async function eligibilityPageDigest(value: unknown): Promise<string> {
  const basis = pageBasisSchema.parse(value);
  return sha256Hex(JSON.stringify(basis));
}
