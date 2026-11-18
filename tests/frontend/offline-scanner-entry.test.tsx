import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, expect, it, vi } from "vitest";
import { scannerOfflineContextSchema } from "../../assets/shared/schemas/event-scanner-offline-context";

const mocks = vi.hoisted(() => ({ list: vi.fn(), restore: vi.fn() }));
vi.mock(
  "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context",
  async (original) => ({
    ...(await original<object>()),
    listPreparedScannerContexts: mocks.list,
    restoreScannerOfflineContext: mocks.restore,
  }),
);
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/EventScanner", () => ({
  EventScanner: () => <p>Saved scanner opened</p>,
}));
import { OfflineScannerBootstrap } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/OfflineScannerBootstrap";

const host = document.createElement("div");
document.body.append(host);
afterEach(async () => {
  await act(() => render(null, host));
  mocks.list.mockReset();
  mocks.restore.mockReset();
});

it("offers a prepared badge collection link from the portal entry point", async () => {
  const now = new Date().toISOString();
  const prepared = scannerOfflineContextSchema.parse({
    slug: "pqc-conference-amsterdam-nl",
    route: "/events/pqc-conference-amsterdam-nl/scanner",
    eventId: "11111111-1111-4111-8111-111111111111",
    operatorUserId: "22222222-2222-4222-8222-222222222222",
    sessionId: "33333333-3333-4333-8333-333333333333",
    deviceId: "44444444-4444-4444-8444-444444444444",
    epochId: "55555555-5555-4555-8555-555555555555",
    action: "attendance",
    purpose: "collection",
    occurrenceId: null,
    roomId: null,
    publishedRevision: null,
    serverNow: now,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    savedAt: now,
    lastObservedAt: now,
  });
  mocks.list.mockResolvedValue([prepared]);
  await act(() => render(<OfflineScannerBootstrap route={null} onCheckSignIn={() => {}} />, host));
  await vi.waitFor(() => expect(host.textContent).toContain("Continue scanning offline"));
  const entry = host.querySelector<HTMLAnchorElement>("a[href*='scannerPurpose=collection']")!;
  expect(entry.textContent).toContain("Badge collection");
  expect(entry.getAttribute("href")).toContain("scanAction=attendance");
  expect(host.textContent).not.toContain("Saved scanner opened");
});
