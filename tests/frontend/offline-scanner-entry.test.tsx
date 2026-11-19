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
  expect(entry.classList.contains("pk-action-tile")).toBe(true);
  expect(entry.querySelector("svg")).not.toBeNull();
  expect(entry.getAttribute("href")).toContain("scanAction=attendance");
  expect(host.textContent).not.toContain("Saved scanner opened");
});

it("lists each prepared scanner task with its own link", async () => {
  const now = new Date().toISOString();
  const base = scannerOfflineContextSchema.parse({
    slug: "pqc-conference-amsterdam-nl",
    route: "/events/pqc-conference-amsterdam-nl/scanner",
    eventId: "11111111-1111-4111-8111-111111111111",
    operatorUserId: "22222222-2222-4222-8222-222222222222",
    sessionId: "33333333-3333-4333-8333-333333333333",
    deviceId: "44444444-4444-4444-8444-444444444444",
    epochId: "55555555-5555-4555-8555-555555555555",
    contextId: "66666666-6666-4666-8666-666666666666",
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
  mocks.list.mockResolvedValue([
    base,
    { ...base, contextId: "77777777-7777-4777-8777-777777777777", purpose: "scan" },
    { ...base, contextId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", action: "check", purpose: "scan" },
    { ...base, contextId: "88888888-8888-4888-8888-888888888888", action: "checkout", purpose: "scan" },
    {
      ...base,
      contextId: "99999999-9999-4999-8999-999999999999",
      action: "admission",
      purpose: "scan",
      occurrenceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      targetLabel: "Opening session",
      roomLabel: "Main hall",
    },
  ]);
  await act(() => render(<OfflineScannerBootstrap route={null} onCheckSignIn={() => {}} />, host));
  await vi.waitFor(() => expect(host.querySelectorAll(".pk-action-tiles a[href*='offlineContext']")).toHaveLength(5));
  const tiles = [...host.querySelectorAll<HTMLAnchorElement>(".pk-action-tiles a[href*='offlineContext']")];
  expect(tiles.every((tile) => tile.classList.contains("pk-action-tile") && tile.querySelector("svg"))).toBe(true);
  expect(tiles.map((tile) => tile.querySelector(".pk-action-tile__label")?.textContent)).toEqual([
    "Badge collection",
    "Venue entrance",
    "Venue entrance",
    "Venue exit",
    "Opening session",
  ]);
  expect(tiles[4]?.textContent).toContain("Main hall · Admission decision");
});
