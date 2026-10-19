import { readActiveUserSession } from "../../../../../../shared/pending-user-logout";
import type { NativeEventCaptureContext } from "../../../../../../../shared/schemas/event-attendance-capture";
import { scannerUploadSuspended } from "../../../../../../shared/pending-user-logout";
import { z } from "zod";
import {
  enrolledOfflineEligibilityQuerySchema,
  enrolledOfflineEligibilityResponseSchema as offlineEligibilityResponseSchema,
} from "../../../../../../../shared/schemas/event-offline-eligibility";
import type {
  EventScanRequest,
  EventScanResponse,
} from "../../../../../../../shared/schemas/event-participation-scanning";

const cachedManifestSchema = offlineEligibilityResponseSchema
  .omit({ entries: true, nextBadgeId: true })
  .extend({
    entries: offlineEligibilityResponseSchema.shape.entries.element.array().max(100000),
    complete: z.boolean().default(false),
    writtenAt: z.number(),
    validUntil: z.number(),
  })
  .strict()
  .refine(
    (value) => value.validUntil >= value.writtenAt && value.validUntil - value.writtenAt <= 15 * 60 * 1000,
    "Eligibility snapshot lifetime must not exceed 15 minutes",
  );
type CachedManifest = z.infer<typeof cachedManifestSchema>;
export type LocalEligibility = Pick<EventScanResponse, "outcome" | "reason"> & { message: string; userId?: string };
export interface EligibilityManifest {
  enrollment?: Pick<CachedManifest, "eventId" | "deviceId" | "epochId" | "writtenAt">;
  operatorUserId: string;
  occurrenceId: string | null;
  roomId?: string | null;
  publishedRevision: number | null;
  nativeEventContext?: NativeEventCaptureContext;
  privateAccessRequired?: boolean;
  serverNow: string;
  expiresAt: string;
  validUntil: number;
  lookup(credential: string, action?: EventScanRequest["action"]): Promise<LocalEligibility>;
}
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("pkic-scanner-eligibility", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("manifests");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error ?? new Error("Eligibility storage unavailable"));
  });
}
async function cached(key: string, value?: CachedManifest): Promise<unknown> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction("manifests", value ? "readwrite" : "readonly");
      const request = value
        ? transaction.objectStore("manifests").put(cachedManifestSchema.parse(value), key)
        : transaction.objectStore("manifests").get(key);
      let result: unknown;
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error ?? new Error("Eligibility storage failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Eligibility storage aborted"));
    });
  } finally {
    db.close();
  }
}
function snapshotCurrent(snapshot: CachedManifest, now = Date.now()): boolean {
  return (
    Number.isFinite(now) &&
    now >= snapshot.writtenAt &&
    now < snapshot.validUntil &&
    now - snapshot.writtenAt < Date.parse(snapshot.expiresAt) - Date.parse(snapshot.serverNow)
  );
}

/** Expiring eligibility never touches the independent attempt queue, history, or recovery storage. */
export async function pruneExpiredEligibilityManifests(): Promise<void> {
  await removeEligibilityManifests();
}

export async function clearOperatorEligibilityManifests(operatorUserId: string): Promise<void> {
  await removeEligibilityManifests(operatorUserId);
}

async function removeEligibilityManifests(operatorUserId?: string): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("manifests", "readwrite");
      const request = transaction.objectStore("manifests").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        const parsed = cachedManifestSchema.safeParse(cursor.value);
        if (!parsed.success || !snapshotCurrent(parsed.data) || parsed.data.operatorUserId === operatorUserId)
          cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error("Eligibility cleanup failed"));
      transaction.onabort = () => reject(transaction.error ?? new Error("Eligibility cleanup aborted"));
    });
  } finally {
    db.close();
  }
}

export function buildEligibilityManifest(raw: unknown): EligibilityManifest {
  const snapshot = cachedManifestSchema.parse(raw);
  const entries = new Map(snapshot.entries.map((entry) => [entry.credentialHash, entry]));
  let lastObservedAt = snapshot.writtenAt;
  let invalidated = false;
  let clockUncertain = false;
  const observeTime = (now: number): boolean => {
    if (!Number.isFinite(now) || now < lastObservedAt) clockUncertain = true;
    if (clockUncertain || !snapshotCurrent(snapshot, now)) invalidated = true;
    if (Number.isFinite(now)) lastObservedAt = Math.max(lastObservedAt, now);
    return !invalidated;
  };
  return {
    enrollment: {
      eventId: snapshot.eventId,
      deviceId: snapshot.deviceId,
      epochId: snapshot.epochId,
      writtenAt: snapshot.writtenAt,
    },
    operatorUserId: snapshot.operatorUserId,
    occurrenceId: snapshot.occurrenceId,
    roomId: snapshot.roomId ?? null,
    publishedRevision: snapshot.publishedRevision,
    ...(snapshot.nativeEventContext ? { nativeEventContext: snapshot.nativeEventContext } : {}),
    privateAccessRequired: snapshot.session?.visibility === "private",
    serverNow: snapshot.serverNow,
    expiresAt: snapshot.expiresAt,
    validUntil: snapshot.validUntil,
    async lookup(credential, action = "check") {
      const startedAt = Date.now();
      const currentBeforeHash = observeTime(startedAt);
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
      const checkedAt = Date.now();
      const clockConsistent = checkedAt >= startedAt;
      const currentAfterHash = observeTime(checkedAt);
      const current = currentBeforeHash && clockConsistent && currentAfterHash;
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const entry = entries.get(hash);
      const badgeExpiresAt = entry?.expiresAt ? Date.parse(entry.expiresAt) : null;
      // Only the server snapshot can establish that a credential was already expired.
      if (badgeExpiresAt !== null && badgeExpiresAt <= Date.parse(snapshot.serverNow))
        return { outcome: "denied", reason: "expired_badge", message: "Badge expired at the last server check." };
      if (entry?.revoked)
        return { outcome: "denied", reason: "revoked_badge", message: "Badge revoked in the saved snapshot." };
      if (!current)
        return {
          outcome: "unverified",
          reason: "verification_required",
          ...(entry ? { userId: entry.userId } : {}),
          message:
            checkedAt < snapshot.writtenAt
              ? "Device clock precedes the saved snapshot. Verification pending."
              : clockUncertain
                ? "Device clock changed since the saved snapshot. Verification pending."
                : entry
                  ? "Known badge in an expired snapshot. Current registration and later revocations require online verification."
                  : "Eligibility snapshot expired. This badge requires online verification.",
        };
      if (
        entry &&
        badgeExpiresAt !== null &&
        badgeExpiresAt <= Date.parse(snapshot.serverNow) + (checkedAt - snapshot.writtenAt)
      )
        return {
          outcome: "unverified",
          reason: "verification_required",
          userId: entry.userId,
          message: "Badge expiry requires online verification. This device cannot confirm later changes.",
        };
      if (!entry && snapshot.complete)
        return { outcome: "unknown", reason: "unknown_credential", message: "Unknown badge for this event snapshot." };
      if (!entry)
        return {
          outcome: "unverified",
          reason: "verification_required",
          message: "Badge is outside this eligibility snapshot. Verify online or refresh the snapshot.",
        };
      if (action === "checkout")
        return {
          outcome: "eligible",
          reason: "eligible",
          userId: entry.userId,
          message: "Checkout saved on this device. Upload pending.",
        };
      if (!entry.eventRegistered || !entry.physicalDayEligible)
        return {
          outcome: "warning",
          userId: entry.userId,
          reason: "missing_registration",
          message: "Known attendee is not registered for this event day. Attendance can be recorded.",
        };
      if (entry.allocationCompatible === false)
        return {
          outcome: "warning",
          userId: entry.userId,
          reason: "wrong_location",
          message: "Assigned duties use another location or attendance mode. This observation can still be recorded.",
        };
      if (snapshot.session && !entry.privateAccess)
        return {
          outcome: "warning",
          userId: entry.userId,
          reason: "missing_registration",
          message: "Known attendee has no registration for this private session. Attendance can be recorded.",
        };
      if (snapshot.session && !entry.sessionEligible)
        return {
          outcome: "warning",
          userId: entry.userId,
          reason: "missing_registration",
          message: "Known attendee is not registered for this session. Attendance can be recorded.",
        };
      return {
        outcome: "eligible",
        reason: "eligible",
        userId: entry.userId,
        message:
          action === "attendance" ? "Registered. Attendance saved on this device; upload pending." : "Registered.",
      };
    },
  };
}

/** Downloads a revision-pinned, bounded snapshot once; the scanning path never queries storage. */
export async function prepareEligibilityManifest(
  slug: string,
  operatorUserId: string,
  occurrenceId: string | null,
  enrollment: { epochId: string; deviceId: string },
  signal?: AbortSignal,
  roomId: string | null = null,
): Promise<EligibilityManifest> {
  const session = await readActiveUserSession();
  const sessionId = session?.sessionId;
  if (await scannerUploadSuspended(operatorUserId, sessionId)) throw new Error("SCANNER_SIGNED_OUT");
  const key = JSON.stringify([operatorUserId, slug, occurrenceId, roomId, enrollment.epochId, enrollment.deviceId]);
  let fallback: unknown;
  try {
    // Retain IDs for qualified feedback in this foreground session, then remove expired persisted copies.
    fallback = await cached(key);
    await pruneExpiredEligibilityManifests();
  } catch {
    // An unavailable cache must not prevent an authorized network refresh.
  }
  try {
    let cursor: string | null = null;
    let snapshot: CachedManifest | undefined;
    const visited = new Set<string>();
    do {
      const query = new URLSearchParams({ epochId: enrollment.epochId, deviceId: enrollment.deviceId });
      if (occurrenceId) query.set("occurrenceId", occurrenceId);
      if (roomId) query.set("roomId", roomId);
      if (cursor) query.set("afterBadgeId", cursor);
      if (snapshot?.publishedRevision !== null && snapshot?.publishedRevision !== undefined)
        query.set("publishedRevision", String(snapshot.publishedRevision));
      enrolledOfflineEligibilityQuerySchema.parse(Object.fromEntries(query));
      const requestedAt = Date.now();
      const response = await fetch(`/api/v1/events/${encodeURIComponent(slug)}/offline-eligibility?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (response.status === 401 || response.status === 403) throw new Error("SCANNER_PERMISSION_CHANGED");
      if (!response.ok) throw new Error("Eligibility preparation unavailable");
      const page = offlineEligibilityResponseSchema.parse(await response.json());
      if (
        page.operatorUserId !== operatorUserId ||
        page.occurrenceId !== occurrenceId ||
        page.epochId !== enrollment.epochId ||
        page.deviceId !== enrollment.deviceId
      )
        throw new Error("SCANNER_PERMISSION_CHANGED");
      if ((page.roomId ?? null) !== roomId) throw new Error("SCANNER_ROOM_CONTEXT_CHANGED");
      if (
        snapshot &&
        (page.eventId !== snapshot.eventId ||
          page.revision !== snapshot.revision ||
          page.publishedRevision !== snapshot.publishedRevision ||
          page.nativeEventContext?.profileKey !== snapshot.nativeEventContext?.profileKey ||
          page.nativeEventContext?.timeZone !== snapshot.nativeEventContext?.timeZone)
      )
        throw new Error("Eligibility revision changed");
      if (!snapshot) {
        const { nextBadgeId: _, ...first } = page;
        const now = Date.now();
        snapshot = {
          ...first,
          complete: false,
          writtenAt: now,
          validUntil: Math.max(
            now,
            requestedAt +
              Math.min(15 * 60 * 1000, Math.max(0, Date.parse(page.expiresAt) - Date.parse(page.serverNow))),
          ),
        };
      } else snapshot.entries.push(...page.entries);
      if (snapshot.entries.length > 100000) throw new Error("Eligibility snapshot too large");
      cursor = page.nextBadgeId;
      if (cursor) {
        if (visited.has(cursor)) throw new Error("Eligibility pagination repeated");
        visited.add(cursor);
      }
    } while (cursor);
    if (!snapshot || !snapshotCurrent(snapshot)) throw new Error("Eligibility snapshot expired during preparation");
    snapshot.complete = true;
    if (await scannerUploadSuspended(operatorUserId, sessionId)) throw new Error("SCANNER_SIGNED_OUT");
    await cached(key, snapshot);
    if (await scannerUploadSuspended(operatorUserId, sessionId)) {
      await clearOperatorEligibilityManifests(operatorUserId);
      throw new Error("SCANNER_SIGNED_OUT");
    }
    return buildEligibilityManifest(snapshot);
  } catch (error) {
    if (
      signal?.aborted ||
      (error instanceof Error && ["SCANNER_PERMISSION_CHANGED", "SCANNER_SIGNED_OUT"].includes(error.message))
    )
      throw error;
    if (await scannerUploadSuspended(operatorUserId, sessionId))
      throw new Error("SCANNER_SIGNED_OUT", { cause: error });
    const saved = cachedManifestSchema.safeParse(fallback);
    if (
      !saved.success ||
      saved.data.operatorUserId !== operatorUserId ||
      saved.data.epochId !== enrollment.epochId ||
      saved.data.deviceId !== enrollment.deviceId ||
      saved.data.occurrenceId !== occurrenceId ||
      (saved.data.roomId ?? null) !== roomId
    )
      throw error;
    return buildEligibilityManifest(saved.data);
  }
}
