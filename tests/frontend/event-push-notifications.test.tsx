import { webcrypto } from "node:crypto";
import { capturePortalWorkerPageAssets } from "../../assets/ts/member-flows/portal/portal-worker-release";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ getJson: vi.fn(), postJson: vi.fn(), deleteJson: vi.fn() }));
vi.mock("../../assets/ts/shared/api-client", () => api);
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-service-worker?worker&url", () => ({
  default: "/_assets/portal-worker.js",
}));
import { useEventPushNotifications } from "../../assets/ts/member-flows/portal/notifications/useEventPushNotifications";
let host: HTMLDivElement;
let current: ReturnType<typeof useEventPushNotifications>;
let permission: ReturnType<typeof vi.fn>,
  register: ReturnType<typeof vi.fn>,
  subscribe: ReturnType<typeof vi.fn>,
  unsubscribe: ReturnType<typeof vi.fn>;
const encodedKey = btoa(String.fromCharCode(...new Uint8Array(65).fill(4))).replace(/=/g, "");
function Harness({ slug = "pqc-2026" }: { slug?: string }) {
  current = useEventPushNotifications(slug);
  return (
    <p>
      {current.state}:{current.error}
    </p>
  );
}
async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
beforeEach(() => {
  vi.stubGlobal("crypto", webcrypto);
  capturePortalWorkerPageAssets(`${location.origin}/_assets/portal-test.js`);
  for (const mock of Object.values(api)) mock.mockReset();
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return stored.size;
    },
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
    removeItem: (key: string) => stored.delete(key),
    clear: () => stored.clear(),
    key: (index: number) => [...stored.keys()][index] ?? null,
  });
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  permission = vi.fn(async () => "granted");
  unsubscribe = vi.fn(async () => true);
  subscribe = vi.fn(async () => ({
    unsubscribe,
    toJSON: () => ({
      endpoint: "https://fcm.googleapis.com/push/opaque",
      expirationTime: null,
      keys: { p256dh: encodedKey, auth: "AQEBAQEBAQEBAQEBAQEBAQ" },
    }),
  }));
  register = vi.fn(async () => ({ pushManager: { getSubscription: vi.fn(async () => null), subscribe } }));
  vi.stubGlobal("Notification", { requestPermission: permission });
  vi.stubGlobal("PushManager", function () {});
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", { serviceWorker: { register, ready: Promise.resolve({}) } });
  api.getJson.mockImplementation(async (url: string) =>
    url.endsWith("/config")
      ? { available: true, publicKey: encodedKey }
      : { enabled: false, registered: false, revoked: false, reminderMinutes: 25 },
  );
  api.postJson.mockResolvedValue({ enabled: true, registered: true, revoked: false });
  api.deleteJson.mockResolvedValue({ revoked: true });
});
afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
});
it("disabled configuration neither prompts nor registers a worker or stores a device ID", async () => {
  api.getJson.mockResolvedValue({ available: false, publicKey: null });
  await act(async () => render(<Harness />, host));
  await flush();
  expect(current.state).toBe("unavailable");
  expect(permission).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(0);
  expect(api.getJson).toHaveBeenCalledTimes(1);
});
it("requires a deliberate action and reuses the scanner worker scope before subscribing", async () => {
  await act(async () => render(<Harness />, host));
  await flush();
  expect(current.state).toBe("off");
  expect(current.reminderMinutes).toBe(25);
  expect(permission).not.toHaveBeenCalled();
  await act(async () => current.enable(25));
  expect(register).toHaveBeenCalledWith(
    expect.stringMatching(/\/_assets\/portal-worker\.js\?portalRelease=[a-f0-9]{64}$/),
    { scope: "/portal/", type: "module", updateViaCache: "none" },
  );
  expect(subscribe).toHaveBeenCalledWith(expect.objectContaining({ userVisibleOnly: true }));
  expect(api.postJson).toHaveBeenCalledWith(
    "/api/v1/events/pqc-2026/push/devices",
    expect.objectContaining({ enabled: true, reminderMinutes: 25 }),
    expect.anything(),
  );
  expect(current.state).toBe("on");
  expect(
    [...Array(localStorage.length)].map((_, index) => localStorage.getItem(localStorage.key(index)!)).join(),
  ).not.toContain("fcm.googleapis");
});
it("permission denial does not create a subscription or opt in server-side", async () => {
  permission.mockResolvedValue("denied");
  await act(async () => render(<Harness />, host));
  await flush();
  await act(async () => current.enable(15));
  expect(current.error).toContain("Email reminders are unchanged");
  expect(api.postJson).not.toHaveBeenCalled();
  expect(register).not.toHaveBeenCalled();
});
it("rolls back a newly created browser subscription when server registration fails", async () => {
  api.postJson.mockRejectedValue(new Error("Ownership changed"));
  await act(async () => render(<Harness />, host));
  await flush();
  await act(async () => current.enable(15));
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(current.state).toBe("off");
  expect(current.error).toBe("Ownership changed");
});
it("an event switch while permission is pending cannot opt in the next event", async () => {
  let resolve!: (value: string) => void;
  permission.mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await act(async () => render(<Harness />, host));
  await flush();
  let pending!: Promise<void>;
  await act(() => {
    pending = current.enable(15);
  });
  await act(async () => render(<Harness slug="other-event" />, host));
  await flush();
  await act(async () => {
    resolve("granted");
    await pending;
  });
  expect(register).not.toHaveBeenCalled();
  expect(api.postJson).not.toHaveBeenCalled();
  expect(current.state).toBe("off");
  expect(current.busy).toBe(false);
});
