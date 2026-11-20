import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  mocks,
  session,
  operator,
  device,
  slug,
  route,
  now,
  epoch,
  context,
  retain,
} from "./scanner-offline-context-fixture";
import {
  assertScannerOfflineContext,
  listPreparedScannerContexts,
  restoreScannerOfflineContext,
  scannerTransportUnavailable,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown, upper: unknown) => [lower, upper] });
  window.location.hash = `#${route}`;
  mocks.active.mockReset().mockResolvedValue({ sessionId: session.sessionId, operatorUserId: operator });
  mocks.suspended.mockReset().mockResolvedValue(false);
  scannerTransportUnavailable.value = true;
  retain();
});
afterEach(() => {
  scannerTransportUnavailable.value = false;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it.each(["closed", "closing"])("returns a locally %s scanner to its saved task", async (state) => {
  mocks.rows[0] = { ...mocks.rows[0], state, closingOperationId: device };
  expect(await listPreparedScannerContexts()).toEqual([context()]);
  expect(await restoreScannerOfflineContext(route)).toMatchObject(context());
  expect(mocks.rows[0]).toMatchObject({ state: "open", closingOperationId: null, issuedHighWater: 3 });
  await expect(assertScannerOfflineContext(context())).resolves.toBeUndefined();
});

it("does not offer an archived prior session after a later scanner session starts", async () => {
  mocks.rows[0] = {
    ...mocks.rows[0],
    state: "closed",
    closingOperationId: device,
    key: JSON.stringify([slug, operator, device, epoch().enrollmentOperationId]),
  };
  expect(await listPreparedScannerContexts()).toEqual([]);
  expect(await restoreScannerOfflineContext(route)).toBeNull();
});
