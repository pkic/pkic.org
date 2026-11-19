// @vitest-environment jsdom
import { render, type ComponentProps } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AVAILABILITY_ERROR_CODE } from "../../assets/shared/schemas/availability";
import { serviceAvailability } from "../../assets/ts/shared/availability-state";
import { clearAuth, expirePortalSession, portalSession, isAuthed } from "../../assets/ts/member-flows/portal/state";
const mocks = vi.hoisted(() => ({
  registerWorker: vi.fn(),
  clearPreparation: vi.fn(),
  preparedContexts: vi.fn(),
  recordSession: vi.fn(),
  pendingLogout: vi.fn(),
  activeSession: vi.fn(),
  sessionListeners: new Set<() => void>(),
}));
vi.mock("../../assets/ts/member-flows/portal/portal-worker-registration", () => ({
  registerPortalServiceWorker: mocks.registerWorker,
}));
vi.mock(
  "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context",
  async (original) => ({
    ...(await original<
      typeof import("../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context")
    >()),
    clearScannerOfflineContexts: mocks.clearPreparation,
    listPreparedScannerContexts: mocks.preparedContexts,
  }),
);
vi.mock("../../assets/ts/shared/pending-user-logout", () => ({
  recordCanonicalSession: mocks.recordSession,
  readActiveUserSession: mocks.activeSession,
  readPendingUserLogout: mocks.pendingLogout,
  subscribeUserSessionState: (callback: () => void) => {
    mocks.sessionListeners.add(callback);
    return () => mocks.sessionListeners.delete(callback);
  },
  scannerUploadSuspended: async () => false,
}));
vi.mock("../../assets/ts/member-flows/portal/logout-session", () => ({
  resumePendingUserLogout: async () => false,
  signOutPortalSession: vi.fn(),
}));
vi.mock("../../assets/ts/member-flows/portal/shell/PortalShell", () => ({
  PortalShell: () => <div>Authenticated portal content</div>,
}));
vi.mock("../../assets/ts/member-flows/portal/shell/Login", () => ({
  Login: ({
    busy,
    status,
    notice,
  }: ComponentProps<typeof import("../../assets/ts/member-flows/portal/shell/Login").Login>) => (
    <div>
      {busy ? status : "Sign in"}
      {notice}
    </div>
  ),
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/OfflineScannerBootstrap", () => ({
  OfflineScannerBootstrap: ({ route, onCheckSignIn }: { route: string; onCheckSignIn: () => void }) => (
    <div data-scanner-route={route}>
      Prepared offline scanner
      <button onClick={onCheckSignIn}>Check sign-in again</button>
    </div>
  ),
}));
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => [
    window.location.hash.slice(1),
    (path: string) => {
      window.location.hash = path;
    },
  ],
}));
import { App } from "../../assets/ts/member-flows/portal/App";
import { scannerTransportUnavailable } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context";
let host: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
beforeEach(() => {
  mocks.registerWorker.mockReset().mockResolvedValue(null);
  clearAuth();
  scannerTransportUnavailable.value = false;
  mocks.sessionListeners.clear();
  serviceAvailability.value = null;
  window.location.hash = "#/events/synthetic-event/scanner";
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  mocks.clearPreparation.mockReset().mockResolvedValue(undefined);
  mocks.preparedContexts.mockReset().mockResolvedValue([]);
  mocks.recordSession.mockReset();
  mocks.pendingLogout.mockReset().mockResolvedValue(null);
  mocks.activeSession.mockReset().mockResolvedValue(null);
  fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>();
  vi.stubGlobal("fetch", fetchMock);
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(async () => {
  await act(() => render(null, host));
  host.remove();
  clearAuth();
  scannerTransportUnavailable.value = false;
  serviceAvailability.value = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function mount() {
  await act(async () => render(<App />, host));
}
it("registers the public worker on ordinary app startup without diagnostics or notification enrollment", async () => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Sign in required" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
  await mount();
  expect(mocks.registerWorker).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("Recovery and diagnostics");
});
it("keeps ordinary sign-in usable after startup worker registration fails", async () => {
  mocks.registerWorker.mockRejectedValueOnce(new Error("Offline files unavailable"));
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Sign in required" } }), {
      status: 401,
      headers: { "content-type": "application/json" },
    }),
  );
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Sign in"));
  expect(mocks.registerWorker).toHaveBeenCalledOnce();
  expect(host.textContent).not.toContain("Offline files unavailable");
});
it.each([true, false])(
  "enters after a real disconnected fetch with navigator online=%s without authenticating",
  async (online) => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/auth/session",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(host.querySelector("[data-scanner-route]")?.getAttribute("data-scanner-route")).toBe(
      "/events/synthetic-event/scanner",
    );
    expect(host.textContent).not.toContain("Authenticated portal content");
    expect(portalSession.value).toBeNull();
    expect(isAuthed.value).toBe(false);
    expect(mocks.recordSession).not.toHaveBeenCalled();
    expect(mocks.clearPreparation).not.toHaveBeenCalled();
    expect(scannerTransportUnavailable.value).toBe(true);
  },
);
it.each([401, 403, 503])(
  "keeps a real HTTP %s refusal authoritative even when navigator reports offline",
  async (status) => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: status === 503 ? AVAILABILITY_ERROR_CODE : "AUTH_REQUIRED",
            message: "Refused",
            details: null,
          },
        }),
        { status, headers: { "content-type": "application/json" } },
      ),
    );
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain(status === 503 ? "Could not check sign-in" : "Sign in"));
    expect(host.textContent).not.toContain("Prepared offline scanner");
    expect(portalSession.value).toBeNull();
    expect(scannerTransportUnavailable.value).toBe(false);
    if (status === 401 || status === 403) expect(mocks.clearPreparation).toHaveBeenCalledOnce();
    else expect(mocks.clearPreparation).not.toHaveBeenCalled();
  },
);
it.each(["online", "focus", "retry", "local-session-change"])(
  "keeps offline capture until an authoritative response during %s recovery",
  async (trigger) => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
    let finish!: (response: Response) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    if (trigger === "online" || trigger === "focus") vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    await act(() => {
      if (trigger === "focus") window.dispatchEvent(new Event("focus"));
      else if (trigger === "online") window.dispatchEvent(new Event("online"));
      else if (trigger === "retry") host.querySelector("button")!.click();
      else for (const callback of mocks.sessionListeners) callback();
    });
    expect(scannerTransportUnavailable.value).toBe(true);
    expect(host.textContent).toContain("Prepared offline scanner");
    expect(portalSession.value).toBeNull();
    if (trigger !== "local-session-change") {
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
      await act(() =>
        finish(
          new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Refused" } }), {
            status: 401,
            headers: { "content-type": "application/json" },
          }),
        ),
      );
      await vi.waitFor(() => expect(mocks.clearPreparation).toHaveBeenCalledOnce());
      await vi.waitFor(() => expect(host.textContent).toContain("Sign in"));
      expect(scannerTransportUnavailable.value).toBe(false);
      expect(host.textContent).not.toContain("Prepared offline scanner");
    } else expect(fetchMock).toHaveBeenCalledOnce();
  },
);
it("offers the local scanner without exposing other portal pages after a disconnected request", async () => {
  window.location.hash = "#/organizations/private-organization";
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
  expect(host.textContent).not.toContain("Authenticated portal content");
  expect(portalSession.value).toBeNull();
});
it("offers prepared scanners from the portal entry point without a remembered scanner URL", async () => {
  window.location.hash = "#/home";
  mocks.activeSession.mockResolvedValue({
    sessionId: "11111111-1111-4111-8111-111111111111",
    operatorUserId: "22222222-2222-4222-8222-222222222222",
  });
  fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
  expect(host.textContent).not.toContain("Authenticated portal content");
  expect(scannerTransportUnavailable.value).toBe(true);
});
it.each([true, false])(
  "keeps the offline return route when local session state changes after the network fails (local session: %s)",
  async (hasLocalSession) => {
    window.location.hash = "#/home";
    if (hasLocalSession)
      mocks.activeSession.mockResolvedValue({
        sessionId: "11111111-1111-4111-8111-111111111111",
        operatorUserId: "22222222-2222-4222-8222-222222222222",
      });
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
    await act(async () => {
      for (const callback of mocks.sessionListeners) callback();
    });
    expect(host.textContent).toContain("Prepared offline scanner");
    expect(scannerTransportUnavailable.value).toBe(true);
  },
);
it("moves an expired web sign-in to the local scanner route without erasing preparation", () => {
  expirePortalSession();
  expect(scannerTransportUnavailable.value).toBe(true);
  expect(mocks.clearPreparation).not.toHaveBeenCalled();
});
it.each([401, 403])("does not erase a newer local scanner after a delayed HTTP %s refusal", async (status) => {
  mocks.preparedContexts.mockResolvedValue([{}]);
  const original = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    operatorUserId: "22222222-2222-4222-8222-222222222222",
  };
  const newer = { ...original, sessionId: "33333333-3333-4333-8333-333333333333" };
  mocks.activeSession.mockResolvedValue(original);
  let finish!: (response: Response) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      }),
  );
  await mount();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
  mocks.activeSession.mockResolvedValue(newer);
  await act(() =>
    finish(
      new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Refused" } }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
  expect(mocks.clearPreparation).not.toHaveBeenCalled();
  expect(scannerTransportUnavailable.value).toBe(true);
  expect(portalSession.value).toBeNull();
});
it.each([401, 403, 429, 500, 503])("offers a saved scanner after HTTP %s on portal sign-in", async (status) => {
  mocks.preparedContexts.mockResolvedValue([{}]);
  mocks.activeSession.mockResolvedValue({
    sessionId: "11111111-1111-4111-8111-111111111111",
    operatorUserId: "22222222-2222-4222-8222-222222222222",
  });
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "SERVER_UNAVAILABLE", message: "Unavailable" } }), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
  expect(portalSession.value).toBeNull();
  expect(mocks.clearPreparation).not.toHaveBeenCalled();
});
it.each([401, 403, 429, 500, 503])(
  "shows ordinary sign-in after HTTP %s when no scanner is prepared",
  async (status) => {
    mocks.activeSession.mockResolvedValue({
      sessionId: "11111111-1111-4111-8111-111111111111",
      operatorUserId: "22222222-2222-4222-8222-222222222222",
    });
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Refused" } }), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
    await mount();
    await vi.waitFor(() => expect(host.textContent).toContain("Sign in"));
    expect(host.textContent).not.toContain("Prepared offline scanner");
    expect(scannerTransportUnavailable.value).toBe(false);
  },
);
it("preserves scanner preparation when its local inventory cannot be read after HTTP 403", async () => {
  mocks.activeSession.mockResolvedValue({
    sessionId: "11111111-1111-4111-8111-111111111111",
    operatorUserId: "22222222-2222-4222-8222-222222222222",
  });
  mocks.preparedContexts.mockRejectedValue(new Error("Local storage unavailable"));
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED", message: "Refused" } }), {
      status: 403,
      headers: { "content-type": "application/json" },
    }),
  );
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Prepared offline scanner"));
  expect(mocks.clearPreparation).not.toHaveBeenCalled();
});
