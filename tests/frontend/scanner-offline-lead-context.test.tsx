import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mocks,
  session,
  operator,
  eventId,
  slug,
  route,
  now,
  epoch,
  manifest,
} from "./scanner-offline-context-fixture";
import { portalSession } from "../../assets/ts/member-flows/portal/state";
import {
  saveScannerOfflineContext,
  listPreparedScannerContexts,
  restoreScannerOfflineContext,
  readScannerOfflineEpoch,
  assertScannerOfflineContext,
  scannerCollectorPath,
  scannerTransportUnavailable,
} from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context";
import { useScannerOfflinePreparation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest";
import { ScannerCodePreparation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-code-preparation";
import { prepareScannerEpoch } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-device-ledger";

let host: HTMLElement | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubGlobal("IDBKeyRange", { bound: (lower: unknown, upper: unknown) => [lower, upper] });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  window.location.hash = `#${route}`;
  mocks.rows = [epoch()];
  mocks.active.mockReset().mockResolvedValue({ sessionId: session.sessionId, operatorUserId: operator });
  mocks.suspended.mockReset().mockResolvedValue(false);
  mocks.warm.mockReset().mockResolvedValue(true);
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

describe("offline sponsor lead context", () => {
  it("refuses another sponsor's cached open session while the server is offline", async () => {
    const sponsorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const sponsorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    mocks.rows[0] = {
      ...mocks.rows[0],
      leadLease: { eventId, sponsorId: sponsorA, serverNow: now, expiresAt: manifest().expiresAt },
    };
    await expect(prepareScannerEpoch(slug, operator, mocks.rows[0]!.deviceId as string, sponsorB)).rejects.toThrow(
      "another sponsor",
    );
  });
  it("restores only the prepared sponsor lead scanner with its sponsor and no attendee inventory", async () => {
    const sponsorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const leadRoute = `/events/${slug}/sponsors/${sponsorId}/scanner`;
    const leadLease = { eventId, sponsorId, serverNow: now, expiresAt: manifest().expiresAt };
    const enrolled = { ...epoch(), leadLease, leadLeaseReceivedAt: Date.parse(now) };
    mocks.rows[0] = enrolled;
    const source = {
      ...manifest(),
      occurrenceId: null,
      roomId: null,
      attendeeInventory: [{ badgeId: "NEVER_STORE_THIS_BADGE", name: "Never Store" }],
    };
    window.location.hash = `#${leadRoute}`;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const prepared = await saveScannerOfflineContext({
      prepareCode: mocks.warm,
      slug,
      session,
      epoch: enrolled,
      manifest: source,
      action: "lead",
      sponsorId,
      targetLabel: "Synthetic sponsor",
      allowedActions: ["lead"],
    });
    expect(prepared).toMatchObject({ action: "lead", sponsorId, route: leadRoute });
    expect((await readScannerOfflineEpoch(prepared!)).leadLeaseReceivedAt).toBe(Date.parse(now));
    expect(JSON.stringify(mocks.rows)).not.toContain("NEVER_STORE_THIS_BADGE");
    expect(mocks.rows[0]!.collectorContext).toMatchObject({ sponsorId, action: "lead" });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect(await listPreparedScannerContexts()).toEqual([prepared]);
    expect(await restoreScannerOfflineContext(leadRoute)).toMatchObject({ sponsorId, action: "lead" });
    await expect(assertScannerOfflineContext(prepared!)).resolves.toBeUndefined();
    expect(portalSession.value).toBeNull();
    window.location.hash = `#${route}?scanAction=lead`;
    expect(scannerCollectorPath(window.location.hash)).toBeNull();
  });

  it("prepares a lead lease without loading attendee eligibility data", async () => {
    const sponsorId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    window.location.hash = `#/events/${slug}/sponsors/${sponsorId}/scanner`;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const leadLease = {
      eventId,
      sponsorId,
      serverNow: new Date(Date.parse(now) + 300_000).toISOString(),
      expiresAt: manifest().expiresAt,
    };
    const enrolled = { ...epoch(), leadLease, leadLeaseReceivedAt: Date.parse(now) };
    const actions = ["lead"] as const;
    function Preparation() {
      const state = useScannerOfflinePreparation(
        session,
        enrolled,
        null,
        slug,
        "lead",
        "Synthetic sponsor",
        undefined,
        { occurrenceId: null, roomId: null },
        actions,
        "scan",
        sponsorId,
      );
      return <output>{state.context ? "Lead scanner ready offline" : state.error}</output>;
    }
    host = document.createElement("div");
    document.body.append(host);
    await act(() =>
      render(
        <ScannerCodePreparation.Provider value={mocks.warm}>
          <Preparation />
        </ScannerCodePreparation.Provider>,
        host!,
      ),
    );
    await vi.waitFor(() => expect(host!.textContent).toContain("Lead scanner ready offline"));
    expect(mocks.rows[0]!.collectorContext).toMatchObject({ sponsorId, action: "lead" });
    expect(mocks.rows[0]!.collectorContext).toMatchObject({ savedAt: now });
    expect(JSON.stringify(mocks.rows)).not.toContain("attendee");
  });

  it("keeps two sponsor lead tasks on the shared leads route separate", async () => {
    const leadRoute = `/events/${slug}/leads`;
    window.location.hash = `#${leadRoute}`;
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const prepared = [];
    for (const sponsorId of ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"]) {
      const leadLease = { eventId, sponsorId, serverNow: now, expiresAt: manifest().expiresAt };
      mocks.rows[0] = { ...mocks.rows[0], leadLease };
      prepared.push(
        await saveScannerOfflineContext({
          prepareCode: mocks.warm,
          slug,
          session,
          epoch: { ...epoch(), leadLease },
          manifest: { ...manifest(), occurrenceId: null, roomId: null },
          action: "lead",
          sponsorId,
          targetLabel: `Sponsor ${prepared.length + 1}`,
        }),
      );
    }
    expect(prepared.every(Boolean)).toBe(true);
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect((await listPreparedScannerContexts()).map((item) => item.sponsorId)).toEqual(
      prepared.map((item) => item!.sponsorId),
    );
    for (const saved of prepared) {
      window.location.hash = `#${leadRoute}?scanAction=lead&offlineContext=${saved!.contextId}`;
      expect((await restoreScannerOfflineContext(leadRoute))?.sponsorId).toBe(saved!.sponsorId);
    }
  });
});
