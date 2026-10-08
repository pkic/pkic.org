// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serviceAvailability } from "../../assets/ts/shared/availability-state";
import { clearAuth, portalSession } from "../../assets/ts/member-flows/portal/state";
const mocks = vi.hoisted(() => ({
  registerWorker: vi.fn(),
  clearPreparation: vi.fn(),
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
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: () => false }));
vi.mock("../../assets/ts/shared/passkey-authentication", () => ({ authenticateWithPasskey: vi.fn() }));
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
import { portalSessionFixture } from "../helpers/portal-session";
import { userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";
import { scannerTransportUnavailable } from "../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context";
let host: HTMLElement;
let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  mocks.registerWorker.mockReset().mockResolvedValue(null);
  clearAuth();
  scannerTransportUnavailable.value = false;
  mocks.sessionListeners.clear();
  serviceAvailability.value = null;
  history.replaceState({}, "", "/portal/#/");
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  mocks.clearPreparation.mockReset().mockResolvedValue(undefined);
  mocks.recordSession.mockReset().mockResolvedValue(true);
  mocks.pendingLogout.mockReset().mockResolvedValue(null);
  mocks.activeSession.mockReset().mockResolvedValue(null);
  fetchMock = vi.fn();
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

function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function card() {
  const node = host.querySelector<HTMLElement>(".pk-login__card");
  expect(node).not.toBeNull();
  expect(host.querySelector(".pk-login__backdrop")).not.toBeNull();
  return node!;
}

function refusal(status: number, message: string) {
  return Response.json({ error: { code: "AUTH_REQUIRED", message } }, { status });
}

it("keeps the brand and disabled sign-in card while the canonical initial session check is pending", async () => {
  const pending = pendingResponse();
  fetchMock.mockReturnValue(pending.promise);
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Checking your sign-in…"));
  expect(card().querySelector<HTMLInputElement>("input")!.matches(":disabled")).toBe(true);
  expect(host.textContent).not.toContain("Verifying your sign-in link");
  expect(host.textContent).not.toContain("Authenticated portal content");
  pending.resolve(refusal(401, "Sign in required"));
  await vi.waitFor(() => expect(card().querySelector<HTMLInputElement>("input")!.matches(":disabled")).toBe(false));
  expect(card().querySelector("[role='status']")).toBeNull();
  expect(portalSession.value).toBeNull();
});

it("keeps an expired verification error in the card and lets the same form request a fresh link", async () => {
  window.location.hash = "#/verify?token=synthetic-expired-link";
  const pending = pendingResponse();
  fetchMock.mockImplementation((input: RequestInfo | URL) =>
    String(input).endsWith("/verify-link") ? pending.promise : Promise.resolve(Response.json({ success: true })),
  );
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Verifying your sign-in link…"));
  expect(card().querySelector<HTMLInputElement>("input")!.matches(":disabled")).toBe(true);
  pending.resolve(refusal(410, "The link has expired."));
  await vi.waitFor(() =>
    expect(card().querySelector("[role='alert']")?.textContent).toContain("The link has expired."),
  );
  expect(host.querySelectorAll("[role='alert']")).toHaveLength(1);
  expect(host.textContent).not.toContain("synthetic-expired-link");
  expect(portalSession.value).toBeNull();
  const input = card().querySelector<HTMLInputElement>("input")!;
  expect(input.matches(":disabled")).toBe(false);
  await act(async () => {
    input.value = "synthetic@example.test";
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    card()
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await vi.waitFor(() => expect(card().textContent).toContain("Check your email"));
  const request = fetchMock.mock.calls.find(([input]) => String(input).endsWith("/request-link"));
  expect(request).toBeDefined();
  expect(userAuthRequestSchema.parse(JSON.parse(String(request![1]?.body)))).toEqual({
    email: "synthetic@example.test",
  });
  expect(mocks.recordSession).not.toHaveBeenCalled();
});

it("keeps online failure and retry in the card without entering the offline scanner", async () => {
  fetchMock.mockResolvedValueOnce(refusal(503, "Temporarily unavailable"));
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Could not check sign-in"));
  expect(host.textContent).not.toContain("Prepared offline scanner");
  fetchMock.mockResolvedValueOnce(refusal(401, "Sign in required"));
  await act(async () => {
    [...card().querySelectorAll("button")].find((button) => button.textContent === "Check sign-in again")!.click();
  });
  await vi.waitFor(() => expect(card().textContent).not.toContain("Could not check sign-in"));
  expect(portalSession.value).toBeNull();
});

it("retains canonical session recording and the reviewed return route after successful link verification", async () => {
  window.location.hash = "#/verify?token=synthetic-valid-link&next=%2Fgroups%2Fsynthetic";
  const session = portalSessionFixture({ pendingIdentityCount: 1 });
  fetchMock.mockImplementation(async () => Response.json(session));
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(mocks.recordSession).toHaveBeenCalledWith({
    sessionId: session.sessionId,
    operatorUserId: session.identity.id,
  });
  expect(portalSession.value?.sessionId).toBe(session.sessionId);
  expect(window.location.hash).toBe("#/groups/synthetic");
  expect(window.location.hash).not.toContain("token=");
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
    "/api/v1/auth/verify-link",
    "/api/v1/auth/session",
  ]);
});
