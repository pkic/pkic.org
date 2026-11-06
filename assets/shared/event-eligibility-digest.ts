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

/** Fingerprint a bounded page of current eligibility without storing a second server read model. */
export async function eligibilityPageDigest(value: unknown): Promise<string> {
  const basis = pageBasisSchema.parse(value);
  const bytes = new TextEncoder().encode(JSON.stringify(basis));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
