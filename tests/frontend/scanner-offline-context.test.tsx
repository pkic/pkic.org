import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { scannerRecoveryEpochSchema } from "../../assets/shared/schemas/event-scanner-devices";
import { scanRecoverySchema } from "../../assets/shared/schemas/event-scan-recovery";
import {
  eventScanRequestSchema,
  enrolledEventScanRequestSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { portalSessionFixture } from "../helpers/portal-session";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
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
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/prepareScannerDecoder", () => ({
  prepareScannerDecoder: mocks.warm,
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
import {
  saveScannerOfflineContext,
  restoreScannerOfflineContext,
  assertScannerOfflineContext,
  clearScannerOfflineContexts,
  scannerCollectorPath,
  scannerTransportUnavailable,
  scannerPreparationRefusal,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context";
import { useEligibilityManifest } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest";
import * as eligibility from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/eligibility-manifest";
import { scannerRecoverySnapshot } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-history";
import { EventScanner } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner";
import { useOfflineAdmission } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useOfflineAdmission";
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
let host: HTMLElement | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubGlobal("IDBKeyRange", {
    bound: (lower: unknown, upper: unknown) => [lower, upper],
    only: (value: unknown) => value,
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  window.location.hash = `#${route}`;
  mocks.rows = [epoch()];
  mocks.active.mockReset().mockResolvedValue({ sessionId: session.sessionId, operatorUserId: operator });
  mocks.suspended.mockReset().mockResolvedValue(false);
  mocks.warm.mockReset().mockResolvedValue(true);
  mocks.queue.mockReset().mockImplementation(async (record) => eventScanRequestSchema.parse(record.scan));
  mocks.drain.mockReset();
  mocks.backgroundSync.mockReset();
  mocks.abort.mockReset();
  mocks.add.mockReset();
  portalSession.value = null;
  scannerTransportUnavailable.value = true;
});
afterEach(() => {
  if (host) {
    render(null, host);
    host.remove();
    host = undefined;
  }
  portalSession.value = null;
  scannerTransportUnavailable.value = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("scanner-only offline preparation", () => {
  it("does not persist preparation until controlled public code warming completes", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    let release!: (ready: boolean) => void;
    mocks.warm.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const invokedAt = Date.now();
    const saving = saveScannerOfflineContext({
      slug,
      session,
      epoch: epoch(),
      manifest: manifest(),
      action: "attendance",
    });
    await vi.waitFor(() => expect(mocks.warm).toHaveBeenCalledOnce());
    expect(mocks.rows[0]).not.toHaveProperty("collectorContext");
    release(true);
    await saving;
    const completedAt = Date.now();
    const saved = scannerOfflineContextSchema.parse(mocks.rows[0]!.collectorContext);
    expect(saved).toEqual(
      scannerOfflineContextSchema.parse({
        ...context(),
        nativeEventContext: undefined,
        lastObservedAt: saved.lastObservedAt,
      }),
    );
    expect(Date.parse(saved.lastObservedAt)).toBeGreaterThanOrEqual(invokedAt);
    expect(Date.parse(saved.lastObservedAt)).toBeLessThanOrEqual(completedAt);
    expect(portalSession.value).toBeNull();
  });
  it("refuses failed warming, mismatched enrollment and invalid receipt timestamps", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    mocks.warm.mockResolvedValue(false);
    await saveScannerOfflineContext({ slug, session, epoch: epoch(), manifest: manifest(), action: "attendance" });
    expect(mocks.rows[0]).not.toHaveProperty("collectorContext");
    mocks.warm.mockClear();
    for (const enrollment of [
      { ...manifest().enrollment!, epochId: eventId },
      { ...manifest().enrollment!, deviceId: eventId },
      { ...manifest().enrollment!, writtenAt: NaN },
      { ...manifest().enrollment!, writtenAt: Number.MAX_VALUE },
    ]) {
      await saveScannerOfflineContext({
        slug,
        session,
        epoch: epoch(),
        manifest: { ...manifest(), enrollment },
        action: "attendance",
      });
    }
    expect(mocks.warm).not.toHaveBeenCalled();
    expect(mocks.rows[0]).not.toHaveProperty("collectorContext");
  });
  it("retains the original receipt deadline rather than renewing an old manifest", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    retain();
    vi.setSystemTime(new Date("2026-10-07T09:10:00.000Z"));
    await saveScannerOfflineContext({ slug, session, epoch: epoch(), manifest: manifest(), action: "attendance" });
    const stored = scannerOfflineContextSchema.parse(mocks.rows[0]!.collectorContext);
    expect(stored.savedAt).toBe(now);
    expect(stored.expiresAt).toBe(context().expiresAt);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    vi.setSystemTime(new Date(stored.expiresAt));
    expect(await restoreScannerOfflineContext(route)).toBeNull();
  });
  it("restores the exact prepared audience or group scanner without restoring portal identity", async () => {
    retain();
    expect(await restoreScannerOfflineContext(route)).toMatchObject(context());
    expect(portalSession.value).toBeNull();
    const groupRoute = `/groups/88888888-8888-4888-8888-888888888888/events/${eventId}/scanner`;
    mocks.rows[0] = { ...epoch(), collectorContext: { ...context(), route: groupRoute } };
    expect(scannerCollectorPath(`#${groupRoute}`)).toBe(groupRoute);
    expect(await restoreScannerOfflineContext(groupRoute)).toMatchObject({ eventId, route: groupRoute });
    expect(await restoreScannerOfflineContext(groupRoute.replace("88888888", "99999999"))).toBeNull();
    expect(
      scannerOfflineContextSchema.safeParse({ ...context(), route: groupRoute.replace(eventId, device) }).success,
    ).toBe(false);
    expect(await restoreScannerOfflineContext("/events/other-event/scanner")).toBeNull();
    expect(scannerCollectorPath(`#${route}?session=${occurrenceId}`)).toBeNull();
  });
  it("restores a long valid slug through its full canonical JSON owner key", async () => {
    const longSlug = "synthetic-" + "a".repeat(150);
    const longRoute = `/events/${longSlug}/scanner`;
    const key = JSON.stringify([longSlug, operator, device]);
    mocks.rows = [
      {
        ...epoch(),
        eventId: longSlug,
        key,
        collectorContext: scannerOfflineContextSchema.parse({ ...context(), slug: longSlug, route: longRoute }),
      },
    ];
    expect(key.length).toBeGreaterThan(200);
    expect(await restoreScannerOfflineContext(longRoute)).toMatchObject({ slug: longSlug, route: longRoute });
  });
  it.each(["logout", "account", "closed", "tampered", "rollback", "expired", "ambiguous", "transport-restored"])(
    "refuses %s without deleting pending epoch evidence",
    async (reason) => {
      retain();
      if (reason === "logout") mocks.suspended.mockResolvedValue(true);
      if (reason === "account") mocks.active.mockResolvedValue({ sessionId: eventId, operatorUserId: operator });
      if (reason === "closed") mocks.rows[0] = { ...mocks.rows[0], state: "closed", closingOperationId: device };
      if (reason === "tampered")
        mocks.rows[0] = { ...mocks.rows[0], collectorContext: { ...context(), email: "private@example.test" } };
      if (reason === "rollback") vi.setSystemTime(new Date("2026-10-07T08:59:59.999Z"));
      if (reason === "expired") vi.setSystemTime(new Date(context().expiresAt));
      if (reason === "ambiguous")
        mocks.rows.push({
          ...epoch(),
          deviceId: eventId,
          key: JSON.stringify([slug, operator, eventId]),
          collectorContext: { ...context(), deviceId: eventId },
        });
      if (reason === "transport-restored") scannerTransportUnavailable.value = false;
      const before = structuredClone(mocks.rows);
      expect(await restoreScannerOfflineContext(route)).toBeNull();
      expect(mocks.rows).toEqual(before);
      expect(portalSession.value).toBeNull();
    },
  );
  it("uses the actual transport purpose for restore and capture despite an online browser flag", async () => {
    retain();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    expect(await restoreScannerOfflineContext(route)).toMatchObject(context());
    await expect(assertScannerOfflineContext(context())).resolves.toBeUndefined();
    scannerTransportUnavailable.value = false;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const before = structuredClone(mocks.rows);
    expect(await restoreScannerOfflineContext(route)).toBeNull();
    await expect(assertScannerOfflineContext(context())).rejects.toThrow("Reconnect");
    expect(mocks.rows).toEqual(before);
  });
  it("refuses changed prepared action/target/provenance and clears only context after known auth refusal", async () => {
    retain();
    await expect(assertScannerOfflineContext({ ...context(), roomId: device })).rejects.toThrow("Reconnect");
    await expect(assertScannerOfflineContext({ ...context(), action: "admission" })).rejects.toThrow("Reconnect");
    await expect(assertScannerOfflineContext({ ...context(), publishedRevision: 8 })).rejects.toThrow("Reconnect");
    await clearScannerOfflineContexts({ sessionId: session.sessionId, operatorUserId: operator });
    expect(mocks.rows[0]).toEqual(epoch());
    expect(await restoreScannerOfflineContext(route)).toBeNull();
  });
  it.each(["another-owner", "newer-session"])("keeps %s preparation when an old request is refused", async (change) => {
    const old = { sessionId: session.sessionId, operatorUserId: operator };
    const newer = { sessionId: eventId, operatorUserId: change === "another-owner" ? device : operator };
    mocks.rows = [
      {
        ...epoch(),
        operatorUserId: newer.operatorUserId,
        key: JSON.stringify([slug, newer.operatorUserId, device]),
        collectorContext: { ...context(), ...newer },
      },
    ];
    mocks.active.mockResolvedValue(newer);
    const before = structuredClone(mocks.rows);
    await clearScannerOfflineContexts(old);
    expect(mocks.rows).toEqual(before);
    await clearScannerOfflineContexts(newer);
    expect(mocks.rows[0]).not.toHaveProperty("collectorContext");
  });
  it("keeps newer same-operator preparation after a delayed manifest refusal", async () => {
    retain();
    const newer = { ...session, sessionId: eventId };
    let refuse!: (error: Error) => void;
    const preparing = vi.spyOn(eligibility, "prepareEligibilityManifest").mockImplementation(
      () =>
        new Promise((_, reject) => {
          refuse = reject;
        }),
    );
    host = document.createElement("div");
    document.body.append(host);
    function Harness({ current }: { current: typeof session }) {
      useEligibilityManifest(
        slug,
        operator,
        occurrenceId,
        "attendance",
        scannerPreparationRefusal(current, operator),
        roomId,
        epoch(),
      );
      return null;
    }
    await act(() => render(<Harness current={session} />, host!));
    await vi.waitFor(() => expect(preparing).toHaveBeenCalledOnce());
    mocks.rows.push({
      ...epoch(),
      deviceId: eventId,
      key: JSON.stringify([slug, operator, eventId]),
      collectorContext: { ...context(), deviceId: eventId, sessionId: newer.sessionId },
    });
    mocks.active.mockResolvedValue({ sessionId: newer.sessionId, operatorUserId: operator });
    await act(() => render(<Harness current={newer} />, host!));
    await act(() => refuse(new Error("SCANNER_PERMISSION_CHANGED")));
    await vi.waitFor(() => expect(mocks.rows[0]).not.toHaveProperty("collectorContext"));
    expect(mocks.rows[1]).toHaveProperty("collectorContext.sessionId", newer.sessionId);
    expect(preparing).toHaveBeenCalledOnce();
  });
  it("exports the actual retained epoch through the canonical backup without transferring preparation", async () => {
    retain();
    const snapshot = await scannerRecoverySnapshot(operator, slug);
    const exported = scanRecoverySchema.parse({
      version: 1,
      operatorUserId: operator,
      eventId: slug,
      exportedAt: now,
      ...snapshot,
    });
    expect(exported.scannerEpochs).toEqual([
      scannerRecoveryEpochSchema.parse({
        eventId: slug,
        operatorUserId: operator,
        deviceId: device,
        epochId,
        enrollmentOperationId: epoch().enrollmentOperationId,
        issuedHighWater: 3,
        state: "open",
        closingOperationId: null,
        openedAt: now,
      }),
    ]);
    expect(JSON.stringify(exported)).not.toContain("collectorContext");
    expect(mocks.rows[0]).toHaveProperty("collectorContext");
    mocks.rows = [{ ...exported.scannerEpochs[0], key: epoch().key }];
    expect(await restoreScannerOfflineContext(route)).toBeNull();
    expect(portalSession.value).toBeNull();
    expect(
      scanRecoverySchema.safeParse({
        ...exported,
        scannerEpochs: [{ ...exported.scannerEpochs[0], collectorContext: context() }],
      }).success,
    ).toBe(false);
  });
  it("mounts only existing capture controls and never drains on mount, focus, visibility or reconnect", async () => {
    retain();
    host = document.createElement("div");
    document.body.append(host);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await act(async () =>
      render(
        <EventScanner
          slug={slug}
          operatorUserId={operator}
          occurrenceId={occurrenceId}
          allowedActions={["attendance"]}
          collectorContext={context()}
        />,
        host!,
      ),
    );
    await vi.waitFor(() => expect(host?.textContent).toContain("Offline · unverified until synced"));
    expect(host.textContent).not.toContain("Recovery and diagnostics");
    expect(host.textContent).not.toContain("Recent scans");
    expect(host.textContent).not.toContain("Prepare eligibility data");
    expect(host.textContent).not.toContain("Sync now");
    expect(host.textContent).not.toContain(occurrenceId);
    expect(host.textContent).not.toContain(roomId);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("online"));
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(mocks.drain).not.toHaveBeenCalled();
    expect(mocks.backgroundSync).not.toHaveBeenCalled();
    expect(portalSession.value).toBeNull();
  });
  it("queues only the fixed original context and always reports unverified, even with an eligible cached manifest", async () => {
    retain();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    host = document.createElement("div");
    document.body.append(host);
    const cached = {
      ...manifest(),
      lookup: vi.fn(async () => ({ outcome: "eligible" as const, reason: "eligible" as const, message: "Eligible" })),
    };
    let controller!: ReturnType<typeof useOfflineAdmission>;
    function Harness() {
      controller = useOfflineAdmission(slug, operator, { current: cached }, context());
      return null;
    }
    await act(() => render(<Harness />, host!));
    const scan = eventScanRequestSchema.parse({
      operatorUserId: operator,
      deviceId: device,
      operationId: eventId,
      badgeId: "abcd-efgh-jklm-npqr",
      occurrenceId,
      roomId,
      action: "attendance",
      observedAt: now,
    });
    const saved = await controller.persist(scan);
    expect(eventScanRequestSchema.parse(saved.scan)).toMatchObject({ ...scan, capturePublicationRevision: 7 });
    expect(saved.local).toMatchObject({ outcome: "unverified", reason: "verification_required" });
    expect(cached.lookup).not.toHaveBeenCalled();
    expect(mocks.queue).toHaveBeenCalledExactlyOnceWith(
      { eventId: slug, scan: saved.scan },
      session.sessionId,
      context(),
    );
    await expect(controller.persist({ ...scan, roomId: device })).rejects.toThrow("context changed");
    expect(mocks.queue).toHaveBeenCalledOnce();
    expect(portalSession.value).toBeNull();
  });
  it.each(["unchanged", "replaced-epoch", "expired", "transport-restored"])(
    "binds the actual queue transaction to the %s context after preassertion",
    async (change) => {
      retain();
      const real = await vi.importActual<
        typeof import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox")
      >("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scan-outbox");
      mocks.queue.mockImplementationOnce(async (record, sid, prepared) => {
        if (change === "replaced-epoch")
          mocks.rows[0] = { ...epoch(), epochId: eventId, collectorContext: { ...context(), epochId: eventId } };
        if (change === "expired") vi.setSystemTime(new Date(context().expiresAt));
        if (change === "transport-restored") scannerTransportUnavailable.value = false;
        return real.queueScan(record, sid, prepared);
      });
      host = document.createElement("div");
      document.body.append(host);
      let controller!: ReturnType<typeof useOfflineAdmission>;
      function Harness() {
        controller = useOfflineAdmission(slug, operator, { current: null }, context());
        return null;
      }
      await act(() => render(<Harness />, host!));
      const scan = eventScanRequestSchema.parse({
        operatorUserId: operator,
        deviceId: device,
        operationId: eventId,
        badgeId: "ABCDEFGHJKLMNPQR",
        occurrenceId,
        roomId,
        action: "attendance",
        observedAt: now,
      });
      if (change === "unchanged") {
        const saved = await controller.persist(scan);
        expect(enrolledEventScanRequestSchema.parse(saved.scan).scannerSession).toEqual({ epochId, sequence: 4 });
        expect(saved.local).toMatchObject({ outcome: "unverified" });
        expect(mocks.abort).not.toHaveBeenCalled();
        expect(mocks.add).toHaveBeenCalledOnce();
        expect(mocks.rows[0]!.issuedHighWater).toBe(4);
      } else {
        await expect(controller.persist(scan)).rejects.toThrow("context changed");
        expect(mocks.abort).toHaveBeenCalledOnce();
        expect(mocks.add).not.toHaveBeenCalled();
        expect(mocks.rows[0]!.issuedHighWater).toBe(3);
      }
    },
  );
});
