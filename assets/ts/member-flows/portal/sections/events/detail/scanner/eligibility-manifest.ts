import { z } from "zod";
import { offlineEligibilityResponseSchema } from "../../../../../../../shared/schemas/event-offline-eligibility";
import type { EventScanResponse } from "../../../../../../../shared/schemas/event-participation-scanning";

const cachedManifestSchema = offlineEligibilityResponseSchema
  .omit({ entries: true, nextBadgeId: true })
  .extend({
    entries: offlineEligibilityResponseSchema.shape.entries.element.array().max(100000),
    writtenAt: z.number(),
    validUntil: z.number(),
  })
  .strict()
  .refine(
    (value) => value.validUntil >= value.writtenAt && value.validUntil - value.writtenAt <= 15 * 60 * 1000,
    "Eligibility snapshot lifetime must not exceed 15 minutes",
  );
type CachedManifest = z.infer<typeof cachedManifestSchema>;
export type LocalEligibility = Pick<EventScanResponse, "outcome" | "reason"> & { message: string };
export interface EligibilityManifest {
  operatorUserId: string;
  occurrenceId: string | null;
  expiresAt: string;
  validUntil: number;
  lookup(credential: string): Promise<LocalEligibility>;
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
export function buildEligibilityManifest(raw: unknown): EligibilityManifest {
  const snapshot = cachedManifestSchema.parse(raw);
  const entries = new Map(snapshot.entries.map((entry) => [entry.credentialHash, entry]));
  return {
    operatorUserId: snapshot.operatorUserId,
    occurrenceId: snapshot.occurrenceId,
    expiresAt: snapshot.expiresAt,
    validUntil: snapshot.validUntil,
    async lookup(credential) {
      if (Date.now() < snapshot.writtenAt || Date.now() >= snapshot.validUntil)
        return {
          outcome: "unverified",
          reason: "verification_required",
          message: "Eligibility snapshot expired. Verification pending.",
        };
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(credential));
      if (Date.now() < snapshot.writtenAt || Date.now() >= snapshot.validUntil)
        return {
          outcome: "unverified",
          reason: "verification_required",
          message: "Eligibility snapshot expired. Verification pending.",
        };
      const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
      const entry = entries.get(hash);
      if (!entry)
        return {
          outcome: "unknown",
          reason: "unknown_credential",
          message: "Unknown badge in the current eligibility snapshot.",
        };
      if (entry.revoked) return { outcome: "denied", reason: "revoked_badge", message: "Badge revoked." };
      if (!entry.eventRegistered || !entry.physicalDayEligible)
        return {
          outcome: "warning",
          reason: "missing_registration",
          message: "Known attendee. Registration for this event day is required.",
        };
      if (snapshot.session && !entry.privateAccess)
        return { outcome: "denied", reason: "missing_registration", message: "This session requires specific access." };
      if (snapshot.session && !entry.sessionEligible)
        return {
          outcome: "warning",
          reason: "capacity",
          message: "Known attendee. Session registration or capacity confirmation required.",
        };
      return {
        outcome: "eligible",
        reason: "eligible",
        message: snapshot.session
          ? "Session eligibility verified locally. Admission and capacity confirmation pending; attendance upload pending."
          : "Event eligibility verified locally. Admission confirmation and attendance upload pending.",
      };
    },
  };
}

/** Downloads a revision-pinned, bounded snapshot once; the scanning path never queries storage. */
export async function prepareEligibilityManifest(
  slug: string,
  operatorUserId: string,
  occurrenceId: string | null,
  signal?: AbortSignal,
): Promise<EligibilityManifest> {
  const key = JSON.stringify([operatorUserId, slug, occurrenceId]);
  try {
    let cursor: string | null = null;
    let snapshot: CachedManifest | undefined;
    const visited = new Set<string>();
    do {
      const query = new URLSearchParams();
      if (occurrenceId) query.set("occurrenceId", occurrenceId);
      if (cursor) query.set("afterBadgeId", cursor);
      if (snapshot?.publishedRevision !== null && snapshot?.publishedRevision !== undefined)
        query.set("publishedRevision", String(snapshot.publishedRevision));
      const requestedAt = Date.now();
      const response = await fetch(`/api/v1/events/${encodeURIComponent(slug)}/offline-eligibility?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (response.status === 401 || response.status === 403) throw new Error("SCANNER_PERMISSION_CHANGED");
      if (!response.ok) throw new Error("Eligibility preparation unavailable");
      const page = offlineEligibilityResponseSchema.parse(await response.json());
      if (page.operatorUserId !== operatorUserId || page.occurrenceId !== occurrenceId)
        throw new Error("SCANNER_PERMISSION_CHANGED");
      if (
        snapshot &&
        (page.eventId !== snapshot.eventId ||
          page.revision !== snapshot.revision ||
          page.publishedRevision !== snapshot.publishedRevision)
      )
        throw new Error("Eligibility revision changed");
      if (!snapshot) {
        const { nextBadgeId: _, ...first } = page;
        const now = Date.now();
        snapshot = {
          ...first,
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
    if (!snapshot || Date.now() >= snapshot.validUntil)
      throw new Error("Eligibility snapshot expired during preparation");
    await cached(key, snapshot);
    return buildEligibilityManifest(snapshot);
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.message === "SCANNER_PERMISSION_CHANGED")) throw error;
    const saved = cachedManifestSchema.safeParse(await cached(key));
    if (
      !saved.success ||
      saved.data.operatorUserId !== operatorUserId ||
      saved.data.occurrenceId !== occurrenceId ||
      Date.now() < saved.data.writtenAt ||
      Date.now() >= saved.data.validUntil
    )
      throw error;
    return buildEligibilityManifest(saved.data);
  }
}
