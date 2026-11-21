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
  scannerLeadLeaseSchema,
} from "../../../../../../../shared/schemas/event-scanner-devices";
import { readActiveUserSession, scannerUploadSuspended } from "../../../../../../shared/pending-user-logout";
import type { PortalSession } from "../../../../types";
import type { ScannerEpoch } from "./scanner-device-ledger";
import type { EligibilityManifest } from "./eligibility-manifest";
import { SCANNER_EPOCH_STORE, openScanStorage, idbRequest, idbCompletion } from "./outbox-storage";
import type { EventScanRequest } from "../../../../../../../shared/schemas/event-participation-scanning";
import { portalHashPath } from "../../../../hash-route";
import { databaseIdSchema } from "../../../../../../../shared/schemas/identifiers";

const SCANNER_PREPARED_CONTEXT_LIMIT = 100;

export type ScannerOfflinePreparation = Pick<
  EligibilityManifest,
  | "storageError"
  | "enrollment"
  | "operatorUserId"
  | "occurrenceId"
  | "roomId"
  | "publishedRevision"
  | "nativeEventContext"
  | "serverNow"
  | "expiresAt"
> &
  Partial<Pick<EligibilityManifest, "validUntil">>;

const storedEpochSchema = scannerRecoveryEpochSchema
  .safeExtend({
    key: z.string(),
    leadLease: scannerLeadLeaseSchema.optional(),
    collectorContext: scannerOfflineContextSchema.optional(),
    collectorContexts: scannerOfflineContextSchema.array().max(SCANNER_PREPARED_CONTEXT_LIMIT).optional(),
  })
  .refine(
    (epoch) =>
      epoch.key === JSON.stringify([epoch.eventId, epoch.operatorUserId, epoch.deviceId]) ||
      (epoch.state === "closed" &&
        epoch.key ===
          JSON.stringify([epoch.eventId, epoch.operatorUserId, epoch.deviceId, epoch.enrollmentOperationId])),
    "Scanner storage key must match its bounded canonical owner tuple.",
  );

/** An unavailable online session permits only a bounded saved scanner, never portal authentication. */
export const scannerTransportUnavailable = signal(false);
export const scannerCaptureActive = signal(false);

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
  const query = new URLSearchParams(hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "");
  if ([...query.keys()].some((key) => !["scannerTab", "scanAction", "scannerPurpose", "offlineContext"].includes(key)))
    return null;
  if (query.has("offlineContext") && !databaseIdSchema.safeParse(query.get("offlineContext")).success) return null;
  if (query.has("scannerPurpose") && !["scan", "collection"].includes(query.get("scannerPurpose")!)) return null;
  if (query.has("scannerTab") && !["scan", "recent", "diagnostics"].includes(query.get("scannerTab")!)) return null;
  if (
    query.has("scanAction") &&
    !["check", "attendance", "checkout", "admission", "lead"].includes(query.get("scanAction")!)
  )
    return null;
  if (query.get("scanAction") === "lead" && !/\/leads$|\/sponsors\/[^/]+\/scanner$/u.test(path)) return null;
  return parsed.success ? parsed.data : null;
}

function preparedContexts(epoch: { collectorContext?: unknown; collectorContexts?: unknown }): ScannerOfflineContext[] {
  const source = Array.isArray(epoch.collectorContexts)
    ? epoch.collectorContexts
    : epoch.collectorContext === undefined
      ? []
      : [epoch.collectorContext];
  return source.flatMap((raw) => {
    const parsed = scannerOfflineContextSchema.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
}

function samePreparedTask(a: ScannerOfflineContext, b: ScannerOfflineContext): boolean {
  return (
    a.route === b.route &&
    a.sessionId === b.sessionId &&
    a.action === b.action &&
    a.sponsorId === b.sponsorId &&
    (a.purpose ?? "scan") === (b.purpose ?? "scan") &&
    a.occurrenceId === b.occurrenceId &&
    a.roomId === b.roomId
  );
}

function keepPreparedDeadline(
  next: ScannerOfflineContext,
  previous: ScannerOfflineContext | undefined,
): ScannerOfflineContext | null {
  if (!previous) return next;
  const contextId = previous.contextId ?? next.contextId;
  if (previous.serverNow !== next.serverNow) return { ...next, contextId };
  if (!scannerContextCurrent(previous)) return null;
  return {
    ...next,
    contextId,
    savedAt: previous.savedAt,
    expiresAt: new Date(Math.min(Date.parse(previous.expiresAt), Date.parse(next.expiresAt))).toISOString(),
  };
}

export function scannerContextCurrent(context: ScannerOfflineContext, now = Date.now()): boolean {
  return (
    now >= Date.parse(context.lastObservedAt) &&
    now < Date.parse(context.savedAt) + Date.parse(context.expiresAt) - Date.parse(context.serverNow)
  );
}

function contextBelongsToEpoch(epoch: ScannerEpoch, context: ScannerOfflineContext): boolean {
  return (
    epoch.eventId === context.slug &&
    epoch.operatorUserId === context.operatorUserId &&
    epoch.deviceId === context.deviceId &&
    epoch.epochId === context.epochId
  );
}

function contextMatchesEpoch(epoch: ScannerEpoch, context: ScannerOfflineContext, now = Date.now()): boolean {
  return epoch.state === "open" && contextBelongsToEpoch(epoch, context) && scannerContextCurrent(context, now);
}

function resumableContextMatchesEpoch(epoch: ScannerEpoch, context: ScannerOfflineContext, now = Date.now()): boolean {
  return (
    (epoch.state === "open" || epoch.state === "closing" || epoch.state === "closed") &&
    epoch.key === JSON.stringify([epoch.eventId, epoch.operatorUserId, epoch.deviceId]) &&
    contextBelongsToEpoch(epoch, context) &&
    scannerContextCurrent(context, now)
  );
}

/** A saved local lease can outlast server availability and the web sign-in session. */
export function scannerOfflineLeaseCurrent(
  epoch: ScannerEpoch & { collectorContext?: unknown; collectorContexts?: unknown },
  now = Date.now(),
): boolean {
  return preparedContexts(epoch).some((context) => contextMatchesEpoch(epoch, context, now));
}

/** List only current leases for the locally signed-in operator, without restoring portal access. */
export async function listPreparedScannerContexts(): Promise<ScannerOfflineContext[]> {
  const active = await readActiveUserSession();
  if (!active || (await scannerUploadSuspended(active.operatorUserId, active.sessionId))) return [];
  const db = await openScanStorage();
  try {
    const tx = db.transaction(SCANNER_EPOCH_STORE, "readonly");
    const records = await idbRequest<unknown[]>(
      tx
        .objectStore(SCANNER_EPOCH_STORE)
        .index("scope")
        .getAll(
          IDBKeyRange.bound([active.operatorUserId], [active.operatorUserId, []]),
          SCANNER_RECOVERY_EPOCH_LIMIT + 1,
        ),
    );
    await idbCompletion(tx);
    if (records.length > SCANNER_RECOVERY_EPOCH_LIMIT) return [];
    return records.flatMap((raw) => {
      const parsed = storedEpochSchema.safeParse(raw);
      if (!parsed.success) return [];
      return preparedContexts(parsed.data).filter(
        (context) => context.sessionId === active.sessionId && resumableContextMatchesEpoch(parsed.data, context),
      );
    });
  } finally {
    db.close();
  }
}

export async function saveScannerOfflineContext(input: {
  slug: string;
  session: PortalSession;
  epoch: ScannerEpoch;
  manifest: ScannerOfflinePreparation;
  action: EventScanRequest["action"];
  sponsorId?: string;
  purpose?: "scan" | "collection";
  allowedActions?: readonly EventScanRequest["action"][];
  targetLabel?: string;
  roomLabel?: string;
  signal?: AbortSignal;
  prepareCode: (signal: AbortSignal) => Promise<boolean>;
}): Promise<ScannerOfflineContext | null> {
  const { session, epoch, manifest } = input;
  const route = scannerCollectorPath(window.location.hash);
  if (
    !route ||
    (input.action === "lead"
      ? !input.sponsorId ||
        (route !== `/events/${encodeURIComponent(input.slug)}/leads` &&
          route !== `/events/${encodeURIComponent(input.slug)}/sponsors/${input.sponsorId}/scanner`)
      : input.sponsorId ||
        (route.startsWith("/groups/")
          ? route.split("/")[4] !== manifest.enrollment?.eventId
          : route !== `/events/${encodeURIComponent(input.slug)}/scanner`))
  )
    return null;
  if (
    manifest.storageError ||
    input.signal?.aborted ||
    !navigator.onLine ||
    !epoch.epochId ||
    epoch.state !== "open" ||
    manifest.operatorUserId !== session.identity.id ||
    !manifest.enrollment ||
    manifest.enrollment.deviceId !== epoch.deviceId ||
    manifest.enrollment.epochId !== epoch.epochId ||
    input.action === "exception" ||
    (input.action === "lead" &&
      (!epoch.leadLease ||
        epoch.leadLease.sponsorId !== input.sponsorId ||
        epoch.leadLease.eventId !== manifest.enrollment.eventId ||
        epoch.leadLease.serverNow !== manifest.serverNow ||
        epoch.leadLease.expiresAt !== manifest.expiresAt))
  )
    return null;
  const active = await readActiveUserSession();
  if (
    active?.sessionId !== session.sessionId ||
    active.operatorUserId !== session.identity.id ||
    (await scannerUploadSuspended(session.identity.id, session.sessionId))
  )
    return null;
  // Offline collection remains event-scoped and never restores portal authentication.
  const deadline = Date.parse(manifest.expiresAt);
  if (!Number.isFinite(deadline) || !Number.isFinite(manifest.enrollment.writtenAt)) return null;
  const savedDate = new Date(manifest.enrollment.writtenAt);
  if (!Number.isFinite(savedDate.getTime()) || !Number.isFinite(new Date(deadline).getTime())) return null;
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
    contextId: crypto.randomUUID(),
    action: input.action,
    ...(input.sponsorId ? { sponsorId: input.sponsorId } : {}),
    ...(input.targetLabel ? { targetLabel: input.targetLabel } : {}),
    ...(input.roomLabel ? { roomLabel: input.roomLabel } : {}),
    purpose:
      input.action === "attendance" &&
      (input.purpose ?? new URLSearchParams(window.location.hash.split("?")[1] ?? "").get("scannerPurpose")) ===
        "collection"
        ? "collection"
        : "scan",
    occurrenceId: manifest.occurrenceId,
    roomId: manifest.roomId ?? null,
    publishedRevision: manifest.publishedRevision,
    nativeEventContext: manifest.nativeEventContext,
    serverNow: manifest.serverNow,
    expiresAt,
    savedAt: savedDate.toISOString(),
    lastObservedAt: now,
  });
  if (!context.success || !scannerContextCurrent(context.data)) return null;
  if (
    !(await input.prepareCode(input.signal ?? new AbortController().signal)) ||
    !navigator.onLine ||
    scannerCollectorPath(window.location.hash) !== route ||
    !scannerContextCurrent(context.data) ||
    (await scannerUploadSuspended(session.identity.id, session.sessionId))
  )
    return null;
  const latestActive = await readActiveUserSession();
  if (latestActive?.sessionId !== session.sessionId || latestActive.operatorUserId !== session.identity.id) return null;
  const db = await openScanStorage();
  try {
    const tx = db.transaction(SCANNER_EPOCH_STORE, "readwrite"),
      done = idbCompletion(tx);
    let committed: ScannerOfflineContext | null = null;
    const store = tx.objectStore(SCANNER_EPOCH_STORE);
    const current = await idbRequest<
      | (ScannerEpoch & { collectorContext?: ScannerOfflineContext; collectorContexts?: ScannerOfflineContext[] })
      | undefined
    >(store.get(epoch.key));
    if (!input.signal?.aborted && current?.epochId === epoch.epochId && current.state === "open") {
      const storedContexts = preparedContexts(current).filter((item) => contextBelongsToEpoch(current, item));
      const contexts = storedContexts.filter(
        (item) => item.sessionId === session.sessionId && scannerContextCurrent(item),
      );
      const actions = [...new Set([input.action, ...(input.allowedActions ?? [])])].flatMap((action) =>
        (
          input.action === "lead"
            ? action === "lead"
            : ["check", "attendance", "checkout", "admission"].includes(action)
        )
          ? [action as ScannerOfflineContext["action"]]
          : [],
      );
      const tasks: ScannerOfflineContext[] = actions.map((action) => ({
        ...context.data,
        action,
        purpose: "scan",
        contextId: crypto.randomUUID(),
      }));
      if (
        actions.includes("attendance") &&
        (context.data.purpose === "collection" || context.data.occurrenceId === null)
      )
        tasks.unshift({ ...context.data, action: "attendance", purpose: "collection", contextId: crypto.randomUUID() });
      const savedTasks: ScannerOfflineContext[] = [];
      for (const task of tasks) {
        const previous = storedContexts.find((item) => samePreparedTask(item, task));
        const saved = keepPreparedDeadline(task, previous);
        if (!saved) {
          await done;
          return null;
        }
        savedTasks.push(saved);
      }
      const next = contexts.filter((item) => !savedTasks.some((saved) => samePreparedTask(item, saved)));
      next.push(...savedTasks);
      if (next.length <= SCANNER_PREPARED_CONTEXT_LIMIT) {
        const selected = savedTasks.find((item) => samePreparedTask(item, context.data));
        if (selected) {
          store.put({ ...current, collectorContext: selected, collectorContexts: next });
          committed = selected;
        }
      }
    }
    await done;
    if (
      input.signal?.aborted ||
      !committed ||
      !scannerContextCurrent(committed) ||
      scannerCollectorPath(window.location.hash) !== route ||
      (await scannerUploadSuspended(session.identity.id, session.sessionId))
    )
      return null;
    const settledActive = await readActiveUserSession();
    if (settledActive?.sessionId !== session.sessionId || settledActive.operatorUserId !== session.identity.id)
      return null;
    const check = db.transaction(SCANNER_EPOCH_STORE, "readonly");
    const checked = idbCompletion(check);
    const [settled] = await Promise.all([
      idbRequest<
        | (ScannerEpoch & { collectorContext?: ScannerOfflineContext; collectorContexts?: ScannerOfflineContext[] })
        | undefined
      >(check.objectStore(SCANNER_EPOCH_STORE).get(epoch.key)),
      checked,
    ]);
    return !input.signal?.aborted &&
      settled?.epochId === epoch.epochId &&
      settled.state === "open" &&
      settled &&
      preparedContexts(settled).some(
        (item) =>
          item.contextId === committed.contextId &&
          item.sessionId === committed.sessionId &&
          item.savedAt === committed.savedAt &&
          item.serverNow === committed.serverNow &&
          item.expiresAt === committed.expiresAt,
      ) &&
      scannerContextCurrent(committed)
      ? committed
      : null;
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
    const query = new URLSearchParams(window.location.hash.split("?")[1] ?? "");
    const selectedId = query.get("offlineContext");
    const selectedAction = query.get("scanAction");
    const selectedPurpose = query.get("scannerPurpose");
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
      if (!epoch) return [];
      return preparedContexts(epoch).flatMap((context) =>
        context.route === route &&
        context.operatorUserId === active.operatorUserId &&
        context.sessionId === active.sessionId &&
        resumableContextMatchesEpoch(epoch, context) &&
        (selectedId ? context.contextId === selectedId : true) &&
        (selectedAction ? context.action === selectedAction : true) &&
        (selectedPurpose ? (context.purpose ?? "scan") === selectedPurpose : true)
          ? [{ epoch, context }]
          : [],
      );
    });
    // A prepared roster can offer several tasks. The epoch records the task this scanner last used;
    // a bare scanner URL resumes that task, while distinct devices remain ambiguous.
    const selectedCandidates = selectedId
      ? candidates
      : candidates.length > 1
        ? candidates.filter(({ epoch, context }) => epoch.collectorContext?.contextId === context.contextId)
        : candidates;
    if (selectedCandidates.length !== 1) {
      await done;
      return null;
    }
    const { epoch, context } = selectedCandidates[0]!;
    const next = { ...context, lastObservedAt: new Date().toISOString() };
    const contexts = preparedContexts(epoch).map((item) =>
      item.contextId === context.contextId && samePreparedTask(item, context) ? next : item,
    );
    store.put({
      ...epoch,
      state: "open",
      closingOperationId: null,
      collectorContext: next,
      collectorContexts: contexts,
    });
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
    "contextId",
    "occurrenceId",
    "roomId",
    "action",
    "sponsorId",
    "purpose",
    "publishedRevision",
    "serverNow",
    "expiresAt",
  ] as const;
  return (
    fields.every((key) => current[key] === expected[key]) &&
    JSON.stringify(current.nativeEventContext) === JSON.stringify(expected.nativeEventContext)
  );
}

export function scannerOfflineEpochContextMatches(
  expected: ScannerOfflineContext,
  epoch: { collectorContext?: unknown; collectorContexts?: unknown },
): boolean {
  return preparedContexts(epoch).some((stored) => scannerOfflineContextMatches(expected, stored));
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
      if (parsed.success) {
        const remaining = preparedContexts(parsed.data).filter((item) => item.sessionId !== active.sessionId);
        if (remaining.length !== preparedContexts(parsed.data).length) {
          const { collectorContext: _, collectorContexts: __, ...epoch } = parsed.data;
          store.put(
            remaining.length ? { ...epoch, collectorContext: remaining.at(-1), collectorContexts: remaining } : epoch,
          );
        }
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
