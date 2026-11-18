import {
  mocks,
  session,
  operator,
  slug,
  route,
  now,
  epoch,
  context,
  manifest,
} from "./scanner-offline-context-fixture";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  saveScannerOfflineContext,
  listPreparedScannerContexts,
  restoreScannerOfflineContext,
  assertScannerOfflineContext,
  clearScannerOfflineContexts,
  scannerTransportUnavailable,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context";

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
  scannerTransportUnavailable.value = true;
});
afterEach(() => {
  scannerTransportUnavailable.value = false;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("multiple prepared scanner tasks", () => {
  it("retains independent prepared tasks for one event and restores the selected task", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.location.hash = `#${route}?scanAction=attendance&scannerPurpose=collection`;
    const collection = await saveScannerOfflineContext({
      prepareCode: mocks.warm,
      slug,
      session,
      epoch: epoch(),
      manifest: manifest(),
      action: "attendance",
    });
    expect(collection?.contextId).toBeTruthy();
    window.location.hash = `#${route}?scanAction=checkout`;
    const checkout = await saveScannerOfflineContext({
      prepareCode: mocks.warm,
      slug,
      session,
      epoch: epoch(),
      manifest: manifest(),
      action: "checkout",
    });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const choices = await listPreparedScannerContexts();
    expect(choices.map((item) => [item.action, item.purpose])).toEqual([
      ["attendance", "collection"],
      ["attendance", "scan"],
      ["checkout", "scan"],
    ]);
    const entrance = choices[1]!;
    for (const selected of [collection!, entrance, checkout!]) {
      window.location.hash = `#${route}?scanAction=${selected.action}&scannerPurpose=${selected.purpose}&offlineContext=${selected.contextId}`;
      expect(await restoreScannerOfflineContext(route)).toMatchObject({ contextId: selected.contextId });
      await expect(assertScannerOfflineContext(selected)).resolves.toBeUndefined();
    }
    expect((await listPreparedScannerContexts()).map((item) => item.contextId)).toEqual(
      choices.map((item) => item.contextId),
    );
    await clearScannerOfflineContexts({ sessionId: session.sessionId, operatorUserId: operator });
    expect(await listPreparedScannerContexts()).toEqual([]);
  });
  it("does not carry task preparation into a later scanner session", async () => {
    const prior = { ...context(), contextId: "99999999-9999-4999-8999-999999999999" };
    const laterEpochId = "88888888-8888-4888-8888-888888888888";
    mocks.rows = [{ ...epoch(), epochId: laterEpochId, collectorContext: prior, collectorContexts: [prior] }];
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const prepared = await saveScannerOfflineContext({
      prepareCode: mocks.warm,
      slug,
      session,
      epoch: { ...epoch(), epochId: laterEpochId },
      manifest: { ...manifest(), enrollment: { ...manifest().enrollment!, epochId: laterEpochId } },
      action: "attendance",
    });
    expect(prepared?.contextId).not.toBe(prior.contextId);
    expect((await listPreparedScannerContexts()).map((item) => item.epochId)).toEqual([laterEpochId]);
  });
  it("keeps both collection and entrance deadlines when the same receipt is saved again", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    window.location.hash = `#${route}?scanAction=attendance&scannerPurpose=collection`;
    const input = {
      prepareCode: mocks.warm,
      slug,
      session,
      epoch: epoch(),
      manifest: manifest(),
      action: "attendance" as const,
    };
    await saveScannerOfflineContext(input);
    const first = structuredClone(mocks.rows[0]!.collectorContexts as ReturnType<typeof context>[]);
    vi.setSystemTime(new Date("2026-10-07T09:05:00.000Z"));
    await saveScannerOfflineContext({
      ...input,
      manifest: {
        ...manifest(),
        expiresAt: "2026-10-07T09:30:00.000Z",
        validUntil: Date.parse("2026-10-07T09:30:00.000Z"),
      },
    });
    const saved = mocks.rows[0]!.collectorContexts as ReturnType<typeof context>[];
    expect(saved.map((item) => [item.purpose, item.contextId, item.savedAt, item.expiresAt]).sort()).toEqual(
      first.map((item) => [item.purpose, item.contextId, item.savedAt, item.expiresAt]).sort(),
    );
  });
});
