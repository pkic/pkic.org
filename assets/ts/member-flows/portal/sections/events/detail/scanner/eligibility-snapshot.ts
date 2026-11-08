import { z } from "zod";
import { SCANNER_OFFLINE_MAXIMUM_MS } from "../../../../../../../shared/event-offline-expiry";
import { enrolledOfflineEligibilityResponseSchema as offlineEligibilityResponseSchema } from "../../../../../../../shared/schemas/event-offline-eligibility";

export const cachedManifestSchema = offlineEligibilityResponseSchema
  .omit({ entries: true, nextBadgeId: true, pageDigest: true, unchanged: true })
  .extend({
    entries: offlineEligibilityResponseSchema.shape.entries.element.array().max(100000),
    // Older saved rosters remain usable until their original lease expires.
    scopeDate: offlineEligibilityResponseSchema.shape.scopeDate.optional(),
    snapshotId: z.string().uuid().optional(),
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
type SnapshotScope = Pick<CachedManifest, "operatorUserId" | "occurrenceId" | "roomId" | "epochId" | "deviceId"> &
  Partial<Pick<CachedManifest, "eventId">>;

/** Requests know the event slug; compare the canonical event ID once a response supplies it. */
export function sameSnapshotIdentity(a: SnapshotScope, b: SnapshotScope): boolean {
  return (
    (a.eventId === undefined || b.eventId === undefined || a.eventId === b.eventId) &&
    a.operatorUserId === b.operatorUserId &&
    a.occurrenceId === b.occurrenceId &&
    a.epochId === b.epochId &&
    a.deviceId === b.deviceId
  );
}

export function sameSnapshotScope(a: SnapshotScope, b: SnapshotScope): boolean {
  return sameSnapshotIdentity(a, b) && (a.roomId ?? null) === (b.roomId ?? null);
}

export function snapshotCurrent(snapshot: CachedManifest, now = Date.now()): boolean {
  return (
    Number.isFinite(now) &&
    now >= snapshot.writtenAt &&
    now < snapshot.validUntil &&
    now - snapshot.writtenAt < Date.parse(snapshot.expiresAt) - Date.parse(snapshot.serverNow)
  );
}
