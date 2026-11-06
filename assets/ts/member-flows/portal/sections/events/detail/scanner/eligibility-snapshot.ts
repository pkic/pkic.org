import { z } from "zod";
import { SCANNER_OFFLINE_MAXIMUM_MS } from "../../../../../../../shared/event-offline-expiry";
import { enrolledOfflineEligibilityResponseSchema as offlineEligibilityResponseSchema } from "../../../../../../../shared/schemas/event-offline-eligibility";

export const cachedManifestSchema = offlineEligibilityResponseSchema
  .omit({ entries: true, nextBadgeId: true, pageDigest: true, unchanged: true })
  .extend({
    entries: offlineEligibilityResponseSchema.shape.entries.element.array().max(100000),
    snapshotId: z.string().uuid(),
    complete: z.boolean().default(false),
    writtenAt: z.number(),
    validUntil: z.number(),
  })
  .strict()
  .refine(
    (value) => value.validUntil >= value.writtenAt && value.validUntil - value.writtenAt <= SCANNER_OFFLINE_MAXIMUM_MS,
    "Eligibility snapshot lifetime must not exceed one local calendar day",
  );
export type CachedManifest = z.infer<typeof cachedManifestSchema>;
export function snapshotCurrent(snapshot: CachedManifest, now = Date.now()): boolean {
  return (
    Number.isFinite(now) &&
    now >= snapshot.writtenAt &&
    now < snapshot.validUntil &&
    now - snapshot.writtenAt < Date.parse(snapshot.expiresAt) - Date.parse(snapshot.serverNow)
  );
}
