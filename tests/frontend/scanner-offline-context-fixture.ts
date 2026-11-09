import { vi } from "vitest";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { scannerRecoveryEpochSchema } from "../../assets/shared/schemas/event-scanner-devices";
import { portalSessionFixture } from "../helpers/portal-session";
import type { EligibilityManifest } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest";
const mocks = vi.hoisted(() => ({
  active: vi.fn(),
  suspended: vi.fn(),
  warm: vi.fn(),
  drain: vi.fn(),
  backgroundSync: vi.fn(),
  queue: vi.fn(),
  abort: vi.fn(),
  add: vi.fn(),
  rows: [] as Record<string, unknown>[],
}));
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  readActiveUserSession: mocks.active,
  scannerUploadSuspended: mocks.suspended,
  subscribeUserSessionState: () => () => {},
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox", () => ({
  queueScan: mocks.queue,
  drainScanOutbox: mocks.drain,
  requestScanOutboxBackgroundSync: mocks.backgroundSync,
  pendingScanCount: async () => 1,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/outbox-storage", () => ({
  SCANNER_EPOCH_STORE: "scanner-epochs",
  SCAN_STORE: "scans",
  HISTORY_STORE: "history",
  HISTORY_RETENTION_MS: 86400000,
  idbRequest: async (value: unknown) => value,
  idbCompletion: async () => {},
  openScanStorage: async () => ({
    close() {},
    transaction: () => ({
      abort: mocks.abort,
      objectStore: (name: string) => ({
        add: mocks.add,
        get: (key: string) => mocks.rows.find((row) => row.key === key),
        put: (row: Record<string, unknown>) => {
          const index = mocks.rows.findIndex((item) => item.key === row.key);
          if (index < 0) mocks.rows.push(structuredClone(row));
          else mocks.rows[index] = structuredClone(row);
        },
        index: () => ({
          getAll: () => structuredClone(mocks.rows),
          openCursor: () => {
            let index = 0;
            const rows = name === "scanner-epochs" ? mocks.rows : [];
            const request = {
              onsuccess: null as (() => void) | null,
              onerror: null,
              error: null,
              result: null as null | { value: Record<string, unknown>; continue: () => void },
            };
            const next = () =>
              queueMicrotask(() => {
                const value = rows[index++];
                request.result = value ? { value, continue: next } : null;
                request.onsuccess?.();
              });
            next();
            return request;
          },
        }),
      }),
    }),
  }),
}));
const session = portalSessionFixture({ member: true });
const operator = session.identity.id,
  device = "22222222-2222-4222-8222-222222222222",
  epochId = "33333333-3333-4333-8333-333333333333",
  eventId = "44444444-4444-4444-8444-444444444444",
  occurrenceId = "55555555-5555-4555-8555-555555555555",
  roomId = "66666666-6666-4666-8666-666666666666";
const slug = "synthetic-event",
  route = `/events/${slug}/scanner`,
  now = "2026-10-07T09:00:00.000Z";
function epoch() {
  return {
    ...scannerRecoveryEpochSchema.parse({
      eventId: slug,
      operatorUserId: operator,
      deviceId: device,
      epochId,
      enrollmentOperationId: "77777777-7777-4777-8777-777777777777",
      issuedHighWater: 3,
      state: "open",
      closingOperationId: null,
      openedAt: now,
    }),
    key: JSON.stringify([slug, operator, device]),
  };
}
function context() {
  return scannerOfflineContextSchema.parse({
    eventId,
    slug,
    route,
    operatorUserId: operator,
    sessionId: session.sessionId,
    deviceId: device,
    epochId,
    occurrenceId,
    roomId,
    action: "attendance",
    publishedRevision: 7,
    serverNow: now,
    expiresAt: "2026-10-07T09:15:00.000Z",
    savedAt: now,
    lastObservedAt: now,
  });
}
function manifest(): EligibilityManifest {
  return {
    operatorUserId: operator,
    occurrenceId,
    roomId,
    publishedRevision: 7,
    serverNow: now,
    expiresAt: "2026-10-07T09:15:00.000Z",
    validUntil: Date.parse(now) + 900000,
    enrollment: { eventId, deviceId: device, epochId, writtenAt: Date.parse(now) },
    lookup: vi.fn(),
  };
}
function retain() {
  mocks.rows = [{ ...epoch(), collectorContext: context() }];
}

export {
  mocks,
  session,
  operator,
  device,
  epochId,
  eventId,
  occurrenceId,
  roomId,
  slug,
  route,
  now,
  epoch,
  context,
  manifest,
  retain,
};
