// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeAll, beforeEach, afterEach, expect, it, vi } from "vitest";
import { App } from "../../assets/ts/member-flows/portal/App";
import { clearAuth, portalSession } from "../../assets/ts/member-flows/portal/state";
import { portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";
import { SESSION_ACTIVITY_REFRESH_INTERVAL_MS } from "../../assets/ts/member-flows/portal/use-session-activity";

vi.mock("../../assets/ts/member-flows/portal/portal-worker-registration", () => ({
  registerPortalServiceWorker: async () => null,
}));
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  recordCanonicalSession: async () => true,
  readActiveUserSession: async () => null,
  readPendingUserLogout: async () => null,
  subscribeUserSessionState: () => () => {},
  scannerUploadSuspended: async () => false,
}));
vi.mock("../../assets/ts/member-flows/portal/logout-session", () => ({
  resumePendingUserLogout: async () => false,
  signOutPortalSession: vi.fn(),
}));
vi.mock("../../assets/ts/member-flows/portal/shell/portal-sections", async (original) => ({
  ...(await original<typeof import("../../assets/ts/member-flows/portal/shell/portal-sections")>()),
  EventAnalytics: () => <input aria-label="Unsaved account field" defaultValue="" />,
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => false }));

let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
// The shell is lazy; transform it before the tests so mounting waits for portal state, not a cold module graph.
beforeAll(async () => {
  await import("../../assets/ts/member-flows/portal/shell/PortalShell");
}, 30_000);
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-13T12:00:00Z"));
  clearAuth();
  history.replaceState({}, "", "/portal/#/events/analytics?analytics.section=profile");
  host = document.createElement("div");
  document.body.append(host);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  clearAuth();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function signedInSession() {
  const session = portalSessionFixture({ staff: true });
  session.staff!.expiresAt = "2099-01-01T00:00:00.000Z";
  session.staff!.idleExpiresAt = "2099-01-01T00:00:00.000Z";
  return session;
}
async function mount() {
  await act(async () => render(<App />, host));
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Unsaved account field"]')).not.toBeNull());
  const input = host.querySelector<HTMLInputElement>('[aria-label="Unsaved account field"]');
  expect(input).not.toBeNull();
  return input!;
}
async function refresh() {
  document.dispatchEvent(new Event("pointerdown"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SESSION_ACTIVITY_REFRESH_INTERVAL_MS);
  });
}
it("preserves the route, DOM, focus and unsaved input through a background refresh", async () => {
  const initial = signedInSession();
  const next = structuredClone(initial);
  next.idleExpiresAt = "2099-01-02T00:00:00.000Z";
  let finish!: (response: Response) => void;
  fetchMock
    .mockResolvedValueOnce(Response.json(initial))
    .mockResolvedValueOnce(Response.json(portalProfileFixture(initial)))
    .mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
  const input = await mount();
  input.value = "Work in progress";
  input.focus();
  const route = location.hash;
  const scrollCalls = vi.mocked(window.scrollTo).mock.calls.length;
  await refresh();
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "/api/v1/auth/session",
    "/api/v1/users/current",
    "/api/v1/auth/session",
  ]);
  expect(host.querySelector('[aria-label="Unsaved account field"]')).toBe(input);
  await act(async () => {
    finish(Response.json(next));
  });
  await vi.waitFor(() => expect(portalSession.value?.idleExpiresAt).toBe(next.idleExpiresAt));
  expect(portalSession.value?.idleExpiresAt).toBe(next.idleExpiresAt);
  expect(host.querySelector('[aria-label="Unsaved account field"]')).toBe(input);
  expect(input.value).toBe("Work in progress");
  expect(document.activeElement).toBe(input);
  expect(location.hash).toBe(route);
  expect(window.scrollTo).toHaveBeenCalledTimes(scrollCalls);
});
it("re-evaluates removed permissions on background refresh instead of retaining protected views", async () => {
  history.replaceState({}, "", "/portal/#/events/analytics");
  const initial = signedInSession();
  const next = structuredClone(initial);
  next.staff!.grants = [];
  fetchMock
    .mockResolvedValueOnce(Response.json(initial))
    .mockResolvedValueOnce(Response.json(portalProfileFixture(initial)))
    .mockResolvedValue(Response.json(next));
  await mount();
  await refresh();
  await vi.waitFor(() => expect(portalSession.value?.staff?.grants).toEqual([]));
  await vi.waitFor(() => expect(host.querySelector('[aria-label="Unsaved account field"]')).toBeNull());
});
