// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const origin = "https://pkic.example";
const notice = {
  notificationId: "a9346cd0-5422-42f1-ae77-6aa6e7bc64a8",
  kind: "session_reminder",
  destination: "/portal/#/events/pqc-2026/agenda",
};
let listeners: Map<string, (event: unknown) => void>;
let showNotification: ReturnType<typeof vi.fn>,
  openWindow: ReturnType<typeof vi.fn>,
  matchAll: ReturnType<typeof vi.fn>;
beforeEach(async () => {
  vi.resetModules();
  listeners = new Map();
  showNotification = vi.fn(async () => {});
  openWindow = vi.fn(async () => null);
  matchAll = vi.fn(async () => []);
  vi.stubGlobal("self", {
    location: { origin },
    registration: { showNotification },
    clients: { openWindow, matchAll },
    addEventListener: (type: string, handler: (event: unknown) => void) => listeners.set(type, handler),
  });
  await import("../../assets/ts/member-flows/portal/notifications/portal-push-worker");
});
afterEach(() => vi.unstubAllGlobals());
async function push(value: unknown) {
  const waitUntil = vi.fn();
  listeners.get("push")!({ data: { json: () => value }, waitUntil });
  if (waitUntil.mock.calls.length) await waitUntil.mock.calls[0]![0];
  return waitUntil;
}
async function click(value: unknown) {
  const waitUntil = vi.fn(),
    close = vi.fn();
  listeners.get("notificationclick")!({ notification: { data: value, close }, waitUntil });
  if (waitUntil.mock.calls.length) await waitUntil.mock.calls[0]![0];
  return { waitUntil, close };
}
it("shows a generic lock-screen message with a stable opaque replacement tag", async () => {
  await push(notice);
  await push(notice);
  expect(showNotification).toHaveBeenCalledTimes(2);
  expect(showNotification).toHaveBeenCalledWith("PKI Consortium", {
    body: "A session on your schedule starts soon.",
    icon: "/img/icon-180x180-black-white.png",
    tag: notice.notificationId,
    data: notice,
  });
});
it("rejects private extra data, arbitrary destinations and malformed messages", async () => {
  for (const value of [
    { ...notice, name: "Private attendee" },
    { ...notice, destination: "https://evil.example/" },
    { ...notice, destination: "/portal/#/events/pqc-2026/agenda?token=private" },
    { ...notice, kind: "unknown" },
    null,
  ]) {
    expect((await push(value)).mock.calls).toHaveLength(0);
  }
  expect(showNotification).not.toHaveBeenCalled();
});
it("handles a non-JSON push without issuing a request or exposing data", () => {
  const waitUntil = vi.fn();
  listeners.get("push")!({
    data: {
      json: () => {
        throw new Error("bad JSON");
      },
    },
    waitUntil,
  });
  expect(waitUntil).not.toHaveBeenCalled();
  expect(showNotification).not.toHaveBeenCalled();
});
it("opens the canonical same-origin portal when no portal window exists", async () => {
  await click(notice);
  expect(openWindow).toHaveBeenCalledWith(`${origin}${notice.destination}`);
});
it("navigates and focuses an existing portal, ignoring a foreign window", async () => {
  const navigate = vi.fn(async () => null),
    focus = vi.fn(async () => null);
  matchAll.mockResolvedValue([
    { url: "https://evil.example/portal/", navigate: vi.fn(), focus: vi.fn() },
    { url: `${origin}/portal/#/events`, navigate, focus },
  ]);
  await click(notice);
  expect(navigate).toHaveBeenCalledWith(`${origin}${notice.destination}`);
  expect(focus).toHaveBeenCalledOnce();
  expect(openWindow).not.toHaveBeenCalled();
});
it("closes tampered notifications without following their destination", async () => {
  const event = await click({ ...notice, destination: "//evil.example/portal/" });
  expect(event.close).toHaveBeenCalledOnce();
  expect(event.waitUntil).not.toHaveBeenCalled();
  expect(openWindow).not.toHaveBeenCalled();
});
