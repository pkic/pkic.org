import { mocks, session, operator, slug, route, now, epoch, manifest } from "./scanner-offline-context-fixture";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";
import { ScannerCodePreparation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-code-preparation";
import { useScannerOfflinePreparation } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/useEligibilityManifest";

const host = document.createElement("div");
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(now));
  vi.stubGlobal("IDBKeyRange", {
    bound: (lower: unknown, upper: unknown) => [lower, upper],
    only: (value: unknown) => value,
  });
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  window.location.hash = `#${route}`;
  mocks.rows = [epoch()];
  mocks.active.mockReset().mockResolvedValue({ sessionId: session.sessionId, operatorUserId: operator });
  mocks.suspended.mockReset().mockResolvedValue(false);
  mocks.warm.mockReset().mockResolvedValue(true);
  document.body.append(host);
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("updates the saved task when the operator switches to badge collection", async () => {
  const enrolled = epoch();
  const preparedManifest = manifest();
  function Preparation({ purpose }: { purpose: "scan" | "collection" }) {
    const state = useScannerOfflinePreparation(
      session,
      enrolled,
      preparedManifest,
      slug,
      "attendance",
      undefined,
      undefined,
      undefined,
      undefined,
      purpose,
    );
    return <output>{state.context?.purpose ?? (state.error || "Waiting")}</output>;
  }
  await act(() =>
    render(
      <ScannerCodePreparation.Provider value={mocks.warm}>
        <Preparation purpose="scan" />
      </ScannerCodePreparation.Provider>,
      host,
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toBe("scan"));
  await act(() =>
    render(
      <ScannerCodePreparation.Provider value={mocks.warm}>
        <Preparation purpose="collection" />
      </ScannerCodePreparation.Provider>,
      host,
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toBe("collection"));
  expect(scannerOfflineContextSchema.parse(mocks.rows[0]!.collectorContext).purpose).toBe("collection");
});
