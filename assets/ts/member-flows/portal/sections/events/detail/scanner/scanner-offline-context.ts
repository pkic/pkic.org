import { signal } from "@preact/signals";
import { z } from "zod";
import {
  scannerOfflineContextSchema,
  scannerOfflineRouteSchema,
  type ScannerOfflineContext,
} from "../../../../../../../shared/schemas/event-scanner-offline-context";
import {
  scannerRecoveryEpochSchema,
  SCANNER_RECOVERY_EPOCH_LIMIT,
} from "../../../../../../../shared/schemas/event-scanner-devices";
import { readActiveUserSession, scannerUploadSuspended } from "../../../../../../shared/pending-user-logout";
import type { PortalSession } from "../../../../types";
import type { ScannerEpoch } from "./scanner-device-ledger";
import type { EligibilityManifest } from "./eligibility-manifest";
import { SCANNER_EPOCH_STORE, openScanStorage, idbRequest, idbCompletion } from "./outbox-storage";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { prepareScannerDecoder } from "./prepareScannerDecoder";
import { portalHashPath } from "../../../../hash-route";

const storedEpochSchema = scannerRecoveryEpochSchema
  .safeExtend({ key: z.string(), collectorContext: scannerOfflineContextSchema.optional() })
  .refine(
    (epoch) =>
      epoch.key === JSON.stringify([epoch.eventId, epoch.operatorUserId, epoch.deviceId]) ||
      (epoch.state === "closed" &&
        epoch.key ===
          JSON.stringify([epoch.eventId, epoch.operatorUserId, epoch.deviceId, epoch.enrollmentOperationId])),
    "Scanner storage key must match its bounded canonical owner tuple.",
  );

/** An actual failed transport permits only unverified collection, never authentication. */
export const scannerTransportUnavailable = signal(false);

export async function readScannerOfflineEpoch(context: ScannerOfflineContext): Promise<ScannerEpoch> {
  await assertScannerOfflineContext(context);
  const db = await openScanStorage();
  try {
    const key = JSON.stringify([context.slug, context.operatorUserId, context.deviceId]);
    const raw = await idbRequest<unknown>(
      db.transaction(SCANNER_EPOCH_STORE).objectStore(SCANNER_EPOCH_STORE).get(key),
    );
    const stored = storedEpochSchema.parse(raw);
    if (stored.state !== "open" || stored.epochId !== context.epochId) throw new Error("Scanner session unavailable");
    return stored;
  } finally {
    db.close();
  }
}

export function scannerCollectorPath(hash: string): string | null {
  const path = portalHashPath(hash);
  const parsed = scannerOfflineRouteSchema.safeParse(path);
  return parsed.success && !hash.includes("?") ? parsed.data : null;
}

export function scannerContextCurrent(context: ScannerOfflineContext, now = Date.now()): boolean {
  return (
    now >= Date.parse(context.lastObservedAt) &&
    now < Date.parse(context.savedAt) + Date.parse(context.expiresAt) - Date.parse(context.serverNow)
  );
}

export async function saveScannerOfflineContext(input: {
  slug: string;
  session: PortalSession;
  epoch: ScannerEpoch;
  manifest: EligibilityManifest;
  action: EventScanRequest["action"];
  signal?: AbortSignal;
}) {
  const { session, epoch, manifest } = input;
  const route = scannerCollectorPath(window.location.hash);
  if (
    !route ||
    (route.startsWith("/groups/")
      ? route.split("/")[4] !== manifest.enrollment?.eventId
      : route !== `/events/${encodeURIComponent(input.slug)}/scanner`)
  )
    return;
  if (
    input.signal?.aborted ||
    !navigator.onLine ||
    !epoch.epochId ||
    epoch.state !== "open" ||
    manifest.operatorUserId !== session.identity.id ||
    !manifest.enrollment ||
    manifest.enrollment.deviceId !== epoch.deviceId ||
    manifest.enrollment.epochId !== epoch.epochId ||
    ["lead", "exception"].includes(input.action)
  )
    return;
  const active = await readActiveUserSession();
  if (
    active?.sessionId !== session.sessionId ||
    active.operatorUserId !== session.identity.id ||
    (await scannerUploadSuspended(session.identity.id, session.sessionId))
  )
    return;
  const deadlines = [
    manifest.expiresAt,
    session.expiresAt,
    session.idleExpiresAt,
    session.staff?.expiresAt,
    session.staff?.idleExpiresAt,
  ].filter((value): value is string => Boolean(value));
  const deadline = Math.min(...deadlines.map((value) => Date.parse(value)));
  if (!Number.isFinite(deadline) || !Number.isFinite(manifest.enrollment.writtenAt)) return;
  const savedDate = new Date(manifest.enrollment.writtenAt);
  if (!Number.isFinite(savedDate.getTime()) || !Number.isFinite(new Date(deadline).getTime())) return;
  const expiresAt = new Date(deadline).toISOString();
  const now = new Date().toISOString();
  const context = scannerOfflineContextSchema.safeParse({
    slug: input.slug,
    route,
    eventId: manifest.enrollment.eventId,
    operatorUserId: session.identity.id,
    sessionId: session.sessionId,
    deviceId: epoch.deviceId,
    epochId: epoch.epochId,
    action: input.action,
    occurrenceId: manifest.occurrenceId,
    roomId: manifest.roomId ?? null,
    publishedRevision: manifest.publishedRevision,
    nativeEventContext: manifest.nativeEventContext,
    serverNow: manifest.serverNow,
    expiresAt,
    savedAt: savedDate.toISOString(),
    lastObservedAt: now,
  });
  if (!context.success || !scannerContextCurrent(context.data)) return;
  if (
    !(await prepareScannerDecoder(input.signal ?? new AbortController().signal)) ||
    !navigator.onLine ||
    scannerCollectorPath(window.location.hash) !== route ||
    !scannerContextCurrent(context.data) ||
    (await scannerUploadSuspended(session.identity.id, session.sessionId))
  )
    return;
  const latestActive = await readActiveUserSession();
  if (latestActive?.sessionId !== session.sessionId || latestActive.operatorUserId !== session.identity.id) return;
  const db = await openScanStorage();
  try {
    const tx = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      done = idbCompletion(tx);
    const store = tx.objectStore(SCANNER_EPOCH_STORE);
    const current = await idbRequest<(ScannerEpoch & { collectorContext?: ScannerOfflineContext }) | undefined>(
      store.get(epoch.key),
    );
    if (!input.signal?.aborted && current?.epochId === epoch.epochId && current.state === "open") {
      const previous = current.collectorContext;
      if (previous?.serverNow === context.data.serverNow && !scannerContextCurrent(previous)) {
        await done;
        return;
      }
      const saved =
        previous?.serverNow === context.data.serverNow
          ? {
              ...context.data,
              savedAt: previous.savedAt,
              expiresAt: new Date(
                Math.min(Date.parse(previous.expiresAt), Date.parse(context.data.expiresAt)),
              ).toISOString(),
            }
          : context.data;
      store.put({ ...current, collectorContext: saved });
    }
    await done;
  } finally {
    db.close();
  }
}

/** Restores an unverified collector, never a portal user or server authorization. */
export async function restoreScannerOfflineContext(route: string): Promise<ScannerOfflineContext | null> {
  if (!scannerTransportUnavailable.value) return null;
  const active = await readActiveUserSession();
  if (!active || (await scannerUploadSuspended(active.operatorUserId, active.sessionId))) return null;
  const db = await openScanStorage();
  try {
    const tx = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      done = idbCompletion(tx);
    const store = tx.objectStore(SCANNER_EPOCH_STORE);
    const records = await idbRequest<unknown[]>(
      store
        .index("scope")
        .getAll(
          IDBKeyRange.bound([active.operatorUserId], [active.operatorUserId, []]),
          SCANNER_RECOVERY_EPOCH_LIMIT + 1,
        ),
    );
    if (records.length > SCANNER_RECOVERY_EPOCH_LIMIT) {
      await done;
      return null;
    }
    const candidates = records.flatMap((raw) => {
      const parsed = storedEpochSchema.safeParse(raw);
      const epoch = parsed.success ? parsed.data : null;
      const context = epoch?.collectorContext;
      return context &&
        epoch.state === "open" &&
        epoch.epochId === context.epochId &&
        epoch.deviceId === context.deviceId &&
        epoch.eventId === context.slug &&
        context.route === route &&
        context.operatorUserId === active.operatorUserId &&
        context.sessionId === active.sessionId &&
        scannerContextCurrent(context)
        ? [{ epoch, context }]
        : [];
    });
    // Never guess between two retained devices/targets.
    if (candidates.length !== 1) {
      await done;
      return null;
    }
    const { epoch, context } = candidates[0]!;
    const next = { ...context, lastObservedAt: new Date().toISOString() };
    store.put({ ...epoch, collectorContext: next });
    await done;
    const stillActive = await readActiveUserSession();
    return scannerTransportUnavailable.value &&
      stillActive?.sessionId === active.sessionId &&
      stillActive.operatorUserId === active.operatorUserId &&
      !(await scannerUploadSuspended(active.operatorUserId, active.sessionId))
      ? next
      : null;
  } finally {
    db.close();
  }
}

export function scannerOfflineContextMatches(expected: ScannerOfflineContext, stored: unknown): boolean {
  const parsed = scannerOfflineContextSchema.safeParse(stored);
  if (!scannerTransportUnavailable.value || !parsed.success || !scannerContextCurrent(parsed.data)) return false;
  const current = parsed.data;
  const fields = [
    "eventId",
    "slug",
    "route",
    "savedAt",
    "sessionId",
    "operatorUserId",
    "deviceId",
    "epochId",
    "occurrenceId",
    "roomId",
    "action",
    "publishedRevision",
    "serverNow",
    "expiresAt",
  ] as const;
  return (
    fields.every((key) => current[key] === expected[key]) &&
    JSON.stringify(current.nativeEventContext) === JSON.stringify(expected.nativeEventContext)
  );
}

export async function assertScannerOfflineContext(expected: ScannerOfflineContext): Promise<void> {
  const current =
    scannerCollectorPath(window.location.hash) === expected.route
      ? await restoreScannerOfflineContext(expected.route)
      : null;
  if (!scannerOfflineContextMatches(expected, current))
    throw new Error("Reconnect and check sign-in before continuing this scanner.");
}

/** A known online auth refusal removes preparation, never unfinished scans or epoch evidence. */
export async function clearScannerOfflineContexts(
  reference: Awaited<ReturnType<typeof readActiveUserSession>>,
): Promise<void> {
  const active = reference;
  if (!active) return;
  const db = await openScanStorage();
  try {
    const tx = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      done = idbCompletion(tx);
    const store = tx.objectStore(SCANNER_EPOCH_STORE);
    const records = await idbRequest<unknown[]>(
      store
        .index("scope")
        .getAll(
          IDBKeyRange.bound([active.operatorUserId], [active.operatorUserId, []]),
          SCANNER_RECOVERY_EPOCH_LIMIT + 1,
        ),
    );
    if (records.length > SCANNER_RECOVERY_EPOCH_LIMIT) throw new Error("Scanner recovery limit exceeded");
    for (const raw of records) {
      const parsed = storedEpochSchema.safeParse(raw);
      if (parsed.success && parsed.data.collectorContext?.sessionId === active.sessionId) {
        const { collectorContext: _, ...epoch } = parsed.data;
        store.put(epoch);
      }
    }
    await done;
  } finally {
    db.close();
  }
}

/** Capture the mounted session before its preparation request can become stale. */
export function scannerPreparationRefusal(session: PortalSession | null, operatorUserId: string): () => void {
  const reference = session?.identity.id === operatorUserId ? { sessionId: session.sessionId, operatorUserId } : null;
  return () => {
    void clearScannerOfflineContexts(reference).catch(() => {});
  };
}
