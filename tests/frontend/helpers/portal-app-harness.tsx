/*
 * The signed-out portal App with its browser-only collaborators replaced:
 * service worker registration, the cross-tab session record, the passkey
 * ceremony and the signed-in shell. Import it before the App so the mocks
 * register first; `host`, `fetchMock` and `mocks` are reset before each test.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, vi } from "vitest";
import { serviceAvailability } from "../../../assets/ts/shared/availability-state";
import { clearAuth } from "../../../assets/ts/member-flows/portal/state";
const mocks = vi.hoisted(() => ({
  registerWorker: vi.fn(),
  clearPreparation: vi.fn(),
  recordSession: vi.fn(),
  pendingLogout: vi.fn(),
  activeSession: vi.fn(),
  signOut: vi.fn(),
  renderShell: vi.fn(),
  supportsPasskeys: vi.fn(),
  authenticateWithPasskey: vi.fn(),
  sessionListeners: new Set<() => void>(),
}));
vi.mock("../../../assets/ts/member-flows/portal/portal-worker-registration", () => ({
  registerPortalServiceWorker: mocks.registerWorker,
}));
vi.mock(
  "../../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context",
  async (original) => ({
    ...(await original<
      typeof import("../../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context")
    >()),
    clearScannerOfflineContexts: mocks.clearPreparation,
  }),
);
vi.mock("../../../assets/ts/shared/pending-user-logout", () => ({
  recordCanonicalSession: mocks.recordSession,
  readActiveUserSession: mocks.activeSession,
  readPendingUserLogout: mocks.pendingLogout,
  subscribeUserSessionState: (callback: () => void) => {
    mocks.sessionListeners.add(callback);
    return () => mocks.sessionListeners.delete(callback);
  },
  scannerUploadSuspended: async () => false,
}));
vi.mock("../../../assets/ts/member-flows/portal/logout-session", () => ({
  resumePendingUserLogout: async () => false,
  signOutPortalSession: mocks.signOut,
}));
vi.mock("../../../assets/ts/member-flows/portal/shell/PortalShell", () => ({
  PortalShell: () => {
    mocks.renderShell();
    return <div>Authenticated portal content</div>;
  },
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: mocks.supportsPasskeys }));
vi.mock("../../../assets/ts/shared/passkey-authentication", () => ({
  authenticateWithPasskey: mocks.authenticateWithPasskey,
}));
vi.mock("../../../assets/ts/member-flows/portal/sections/events/detail/scanner/OfflineScannerBootstrap", () => ({
  OfflineScannerBootstrap: ({ route, onCheckSignIn }: { route: string; onCheckSignIn: () => void }) => (
    <div data-scanner-route={route}>
      Prepared offline scanner
      <button onClick={onCheckSignIn}>Check sign-in again</button>
    </div>
  ),
}));
vi.mock("../../../assets/ts/member-flows/portal/shell/MeetingEntryReturn", () => ({
  MeetingEntryReturn: ({ destination }: { destination: string }) => <div data-meeting-return={destination} />,
}));
import { App } from "../../../assets/ts/member-flows/portal/App";
import { scannerTransportUnavailable } from "../../../assets/ts/member-flows/portal/sections/events/detail/scanner/scanner-offline-context";
export let host: HTMLElement;
export let fetchMock: ReturnType<typeof vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>>;
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
  mocks.signOut.mockReset();
  mocks.renderShell.mockReset();
  mocks.supportsPasskeys.mockReset().mockReturnValue(false);
  mocks.authenticateWithPasskey.mockReset();
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
export async function mount() {
  await act(async () => render(<App />, host));
}
export function pendingResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}
export function card() {
  const node = host.querySelector<HTMLElement>(".pk-login__card");
  expect(node).not.toBeNull();
  expect(host.querySelector(".pk-login__backdrop")).not.toBeNull();
  return node!;
}
export function refusal(status: number, message: string) {
  return Response.json({ error: { code: "AUTH_REQUIRED", message } }, { status });
}
export { mocks };
