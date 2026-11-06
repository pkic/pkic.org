import {
  enrolledOfflineEligibilityQuerySchema,
  OFFLINE_ELIGIBILITY_PAGE_SIZE,
  enrolledOfflineEligibilityResponseSchema,
} from "../../../../../../../shared/schemas/event-offline-eligibility";
import { eligibilityPageDigest } from "../../../../../../../shared/event-eligibility-digest";
import { SCANNER_OFFLINE_MAXIMUM_MS } from "../../../../../../../shared/event-offline-expiry";
import { snapshotCurrent, type CachedManifest } from "./eligibility-snapshot";

/** Validate every bounded page, transferring its entries only when they differ from the saved copy. */
export async function downloadEligibilitySnapshot(
  slug: string,
  operatorUserId: string,
  occurrenceId: string | null,
  roomId: string | null,
  enrollment: { epochId: string; deviceId: string },
  signal?: AbortSignal,
  saved?: CachedManifest,
): Promise<CachedManifest> {
  const matching =
    saved &&
    saved.operatorUserId === operatorUserId &&
    saved.occurrenceId === occurrenceId &&
    (saved.roomId ?? null) === roomId &&
    saved.epochId === enrollment.epochId &&
    saved.deviceId === enrollment.deviceId;
  let previous = matching
    ? [...saved.entries].sort((a, b) => (a.badgeId < b.badgeId ? -1 : a.badgeId > b.badgeId ? 1 : 0))
    : [];
  let previousIndex = 0;
  let cursor: string | null = null;
  let snapshot: CachedManifest | undefined;
  let scopeDigest: string | undefined;
  let restarted = false;
  for (let pageNumber = 0; pageNumber < 1000; pageNumber++) {
    while (previousIndex < previous.length && cursor !== null && previous[previousIndex]!.badgeId <= cursor)
      previousIndex++;
    const knownEntries = previous.slice(previousIndex, previousIndex + OFFLINE_ELIGIBILITY_PAGE_SIZE);
    const knownNext =
      previous.length > previousIndex + OFFLINE_ELIGIBILITY_PAGE_SIZE ? knownEntries.at(-1)!.badgeId : null;
    const knownDigest =
      matching && !restarted
        ? await eligibilityPageDigest({ ...saved, entries: knownEntries, nextBadgeId: knownNext })
        : undefined;
    const query = new URLSearchParams({ epochId: enrollment.epochId, deviceId: enrollment.deviceId });
    if (occurrenceId) query.set("occurrenceId", occurrenceId);
    if (roomId) query.set("roomId", roomId);
    if (cursor) query.set("afterBadgeId", cursor);
    if (knownDigest) query.set("knownDigest", knownDigest);
    if (snapshot) {
      query.set("scopeDate", snapshot.scopeDate);
      if (snapshot.publishedRevision !== null) query.set("publishedRevision", String(snapshot.publishedRevision));
    }
    enrolledOfflineEligibilityQuerySchema.parse(Object.fromEntries(query));
    const requestedAt = Date.now();
    const response = await fetch(`/api/v1/events/${encodeURIComponent(slug)}/offline-eligibility?${query}`, {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    });
    if (response.status === 401 || response.status === 403) throw new Error("SCANNER_PERMISSION_CHANGED");
    if (response.status === 409 && !restarted) {
      previous = [];
      previousIndex = 0;
      cursor = null;
      snapshot = undefined;
      scopeDigest = undefined;
      restarted = true;
      continue;
    }
    if (!response.ok) throw new Error("Eligibility preparation unavailable");
    const page = enrolledOfflineEligibilityResponseSchema.parse(await response.json());
    if (
      page.operatorUserId !== operatorUserId ||
      page.occurrenceId !== occurrenceId ||
      page.epochId !== enrollment.epochId ||
      page.deviceId !== enrollment.deviceId
    )
      throw new Error("SCANNER_PERMISSION_CHANGED");
    if ((page.roomId ?? null) !== roomId) throw new Error("SCANNER_ROOM_CONTEXT_CHANGED");
    const pageScope = await eligibilityPageDigest({ ...page, entries: [], nextBadgeId: null });
    if (scopeDigest !== undefined && scopeDigest !== pageScope) throw new Error("Eligibility revision changed");
    scopeDigest = pageScope;
    if (page.unchanged && (!knownDigest || page.pageDigest !== knownDigest || page.entries.length !== 0))
      throw new Error("Eligibility page was not verified");
    const entries = page.unchanged ? knownEntries : page.entries;
    if ((await eligibilityPageDigest({ ...page, entries })) !== page.pageDigest)
      throw new Error("Eligibility page digest changed");
    let lastId: string = cursor ?? "";
    for (const entry of entries) {
      if (entry.badgeId <= lastId) throw new Error("Eligibility pagination repeated");
      lastId = entry.badgeId;
    }
    if (page.nextBadgeId !== null && (entries.length !== OFFLINE_ELIGIBILITY_PAGE_SIZE || page.nextBadgeId !== lastId))
      throw new Error("Eligibility pagination repeated");
    const now = Date.now();
    const validUntil = Math.max(
      now,
      requestedAt +
        Math.min(SCANNER_OFFLINE_MAXIMUM_MS, Math.max(0, Date.parse(page.expiresAt) - Date.parse(page.serverNow))),
    );
    if (!snapshot) {
      const { nextBadgeId: _, pageDigest: __, unchanged: ___, ...metadata } = page;
      snapshot = {
        ...metadata,
        snapshotId: crypto.randomUUID(),
        entries: [],
        complete: false,
        writtenAt: now,
        validUntil,
      };
    } else snapshot.validUntil = Math.min(snapshot.validUntil, validUntil);
    snapshot.entries.push(...entries);
    if (snapshot.entries.length > 100000) throw new Error("Eligibility snapshot too large");
    cursor = page.nextBadgeId;
    if (cursor !== null) continue;
    if (!snapshotCurrent(snapshot)) throw new Error("Eligibility snapshot expired during preparation");
    snapshot.complete = true;
    return snapshot;
  }
  throw new Error("Eligibility snapshot too large");
}
