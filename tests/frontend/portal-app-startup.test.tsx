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
  signOut: vi.fn(),
  renderShell: vi.fn(),
  supportsPasskeys: vi.fn(),
  authenticateWithPasskey: vi.fn(),
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
  signOutPortalSession: mocks.signOut,
}));
vi.mock("../../assets/ts/member-flows/portal/shell/PortalShell", () => ({
  PortalShell: () => {
    mocks.renderShell();
    return <div>Authenticated portal content</div>;
  },
}));
vi.mock("@simplewebauthn/browser", () => ({ browserSupportsWebAuthn: mocks.supportsPasskeys }));
vi.mock("../../assets/ts/shared/passkey-authentication", () => ({
  authenticateWithPasskey: mocks.authenticateWithPasskey,
}));
vi.mock("../../assets/ts/member-flows/portal/sections/events/detail/scanner/OfflineScannerBootstrap", () => ({
  OfflineScannerBootstrap: ({ route, onCheckSignIn }: { route: string; onCheckSignIn: () => void }) => (
    <div data-scanner-route={route}>
      Prepared offline scanner
      <button onClick={onCheckSignIn}>Check sign-in again</button>
    </div>
  ),
}));
import { App } from "../../assets/ts/member-flows/portal/App";
import { rememberedActingIdentityId } from "../../assets/ts/member-flows/portal/acting-identity";
import { myActiveIdentitySwitchSchema } from "../../assets/shared/schemas/me";
import { memoryStorage } from "./helpers/browser-storage";
import { portalSessionFixture } from "../helpers/portal-session";
import { userAuthVerifySchema, userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";
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
  mocks.signOut.mockReset();
  mocks.renderShell.mockReset();
  mocks.supportsPasskeys.mockReset().mockReturnValue(false);
  mocks.authenticateWithPasskey.mockReset();
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
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    if (String(input).endsWith("/verify-link")) return pending.promise;
    if (String(input).endsWith("/auth/session")) return Promise.resolve(refusal(401, "Sign in required"));
    return Promise.resolve(Response.json({ success: true }));
  });
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

it("opens the portal when a link opened twice is refused but the first opening signed this browser in", async () => {
  window.location.hash = "#/verify?token=synthetic-used-link&next=%2Fgroups%2Fsynthetic";
  const session = portalSessionFixture({ pendingIdentityCount: 1 });
  fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
    String(input).endsWith("/verify-link") ? refusal(410, "Magic link already used") : Response.json(session),
  );
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(host.textContent).not.toContain("Magic link already used");
  expect(portalSession.value?.sessionId).toBe(session.sessionId);
  expect(window.location.hash).toBe("#/groups/synthetic");
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

async function followLink(token: string) {
  await act(async () => {
    history.replaceState({}, "", `/portal/#/verify?token=${token}&next=%2Fgroups%2Fsynthetic`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

it("verifies a same-tab link after mounting the signed-out form without rechecking ordinary routes", async () => {
  const pending = pendingResponse();
  const session = portalSessionFixture({ pendingIdentityCount: 1 });
  fetchMock.mockImplementation((input: RequestInfo | URL) =>
    String(input).endsWith("/verify-link")
      ? pending.promise
      : Promise.resolve(portalSession.value ? Response.json(session) : refusal(401, "Sign in required")),
  );
  await mount();
  await vi.waitFor(() => expect(card().querySelector<HTMLInputElement>("input")!.disabled).toBe(false));
  await followLink("synthetic-same-tab");
  await vi.waitFor(() => expect(card().textContent).toContain("Verifying your sign-in link…"));
  const calls = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/verify-link"));
  expect(calls).toHaveLength(1);
  expect(userAuthVerifySchema.parse(JSON.parse(String(calls[0]![1]?.body))).token).toBe("synthetic-same-tab");
  pending.resolve(Response.json(session));
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(window.location.hash).toBe("#/groups/synthetic");
  const count = fetchMock.mock.calls.length;
  await act(async () => {
    history.replaceState({}, "", "/portal/#/events");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(fetchMock.mock.calls).toHaveLength(count);
});

it("clears an expired token error for a new same-tab token and ignores a replaced token completion", async () => {
  const stale = pendingResponse();
  const fresh = pendingResponse();
  const session = portalSessionFixture({ pendingIdentityCount: 1 });
  fetchMock.mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/verify-link"))
      return Promise.resolve(portalSession.value ? Response.json(session) : refusal(401, "Sign in required"));
    const { token } = userAuthVerifySchema.parse(JSON.parse(String(init?.body)));
    return token === "synthetic-expired"
      ? Promise.resolve(refusal(410, "The link has expired."))
      : token === "synthetic-stale-link"
        ? stale.promise
        : fresh.promise;
  });
  await mount();
  await vi.waitFor(() => expect(card().querySelector<HTMLInputElement>("input")!.disabled).toBe(false));
  await followLink("synthetic-expired");
  await vi.waitFor(() => expect(card().querySelector("[role='alert']")?.textContent).toContain("expired"));
  await followLink("synthetic-stale-link");
  await vi.waitFor(() => expect(card().textContent).toContain("Verifying your sign-in link…"));
  expect(card().querySelector("[role='alert']")).toBeNull();
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/verify-link") &&
          userAuthVerifySchema.parse(JSON.parse(String(init?.body))).token === "synthetic-stale-link",
      ),
    ).toBe(true),
  );
  await followLink("synthetic-fresh-link");
  await vi.waitFor(() =>
    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          String(input).endsWith("/verify-link") &&
          userAuthVerifySchema.parse(JSON.parse(String(init?.body))).token === "synthetic-fresh-link",
      ),
    ).toBe(true),
  );
  await act(async () => {
    stale.resolve(Response.json(session));
  });
  expect(mocks.recordSession).not.toHaveBeenCalled();
  expect(portalSession.value).toBeNull();
  expect(window.location.hash).toContain("synthetic-fresh-link");
  fresh.resolve(Response.json(session));
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/verify-link"))).toHaveLength(3);
});

it("reconciles the canonical session when leaving a pending verification route", async () => {
  const pending = pendingResponse();
  const session = portalSessionFixture({ pendingIdentityCount: 1 });
  fetchMock.mockImplementation((input: RequestInfo | URL) =>
    String(input).endsWith("/verify-link") ? pending.promise : Promise.resolve(refusal(401, "Sign in required")),
  );
  await mount();
  await vi.waitFor(() => expect(card().querySelector<HTMLInputElement>("input")!.disabled).toBe(false));
  await followLink("synthetic-abandoned-link");
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/verify-link"))).toHaveLength(1),
  );
  const initialChecks = fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/session")).length;
  await act(async () => {
    history.replaceState({}, "", "/portal/#/");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/auth/session"))).toHaveLength(
      initialChecks + 1,
    ),
  );
  await act(async () => {
    pending.resolve(Response.json(session));
  });
  expect(mocks.recordSession).not.toHaveBeenCalled();
  expect(portalSession.value).toBeNull();
  expect(window.location.hash).toBe("#/");
});

it("does not let an initial pending session response overwrite a new same-tab link session", async () => {
  const initial = pendingResponse();
  const oldSession = {
    ...portalSessionFixture({ pendingIdentityCount: 1 }),
    sessionId: "00000000-0000-4000-8000-000000000005",
  };
  const newSession = {
    ...portalSessionFixture({ pendingIdentityCount: 1 }),
    sessionId: "00000000-0000-4000-8000-000000000006",
  };
  let checks = 0;
  fetchMock.mockImplementation((input: RequestInfo | URL) => {
    if (String(input).endsWith("/verify-link")) return Promise.resolve(Response.json(newSession));
    checks += 1;
    return checks === 1 ? initial.promise : Promise.resolve(Response.json(newSession));
  });
  await mount();
  await vi.waitFor(() => expect(checks).toBe(1));
  await followLink("synthetic-new-session-link");
  await vi.waitFor(() => expect(portalSession.value?.sessionId).toBe(newSession.sessionId));
  await act(async () => {
    initial.resolve(Response.json(oldSession));
  });
  expect(portalSession.value?.sessionId).toBe(newSession.sessionId);
  expect(mocks.recordSession).not.toHaveBeenCalledWith({
    sessionId: oldSession.sessionId,
    operatorUserId: oldSession.identity.id,
  });
  expect(window.location.hash).toBe("#/groups/synthetic");
});

const ALPHA_IDENTITY = {
  id: "00000000-0000-4000-8000-0000000000a1",
  organizationId: "00000000-0000-4000-8000-0000000000b1",
  organizationName: "Alpha Org",
  jobTitle: "Delegate",
};
const INDIVIDUAL_IDENTITY = {
  id: "00000000-0000-4000-8000-0000000000a2",
  organizationId: null,
  organizationName: null,
  jobTitle: null,
};

/** A person holding two identities; the server answers the session and the active-identity endpoint. */
function serveSeveralIdentities() {
  const base = {
    ...portalSessionFixture({ pendingIdentityCount: 1 }),
    actingIdentities: [ALPHA_IDENTITY, INDIVIDUAL_IDENTITY],
  };
  const state = { session: { ...base, actingIdentityId: null as string | null }, selections: [] as string[] };
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith("/api/v1/users/current/identities/active") && init?.method === "PUT") {
      const { identityId } = myActiveIdentitySwitchSchema.parse(JSON.parse(String(init.body)));
      state.selections.push(identityId);
      state.session = { ...base, actingIdentityId: identityId };
      return Response.json(state.session);
    }
    return Response.json(state.session);
  });
  return state;
}

/** This device's storage, empty: nothing remembered yet. */
function clearRememberedIdentity(): void {
  vi.stubGlobal("localStorage", memoryStorage());
}

it("asks a person with several identities which one to continue as, then remembers it on this device", async () => {
  clearRememberedIdentity();
  const server = serveSeveralIdentities();
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Choose an identity"));
  const choices = [...card().querySelectorAll("button")].map((button) => button.textContent);
  expect(choices).toEqual(["Continue as Alpha Org · Delegate", "Continue as Individual"]);
  expect(mocks.renderShell).not.toHaveBeenCalled();

  await act(async () => {
    [...card().querySelectorAll("button")].find((button) => button.textContent === "Continue as Individual")!.click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(server.selections).toEqual([INDIVIDUAL_IDENTITY.id]);
  expect(portalSession.value?.actingIdentityId).toBe(INDIVIDUAL_IDENTITY.id);
  expect(rememberedActingIdentityId(portalSession.value!.identity.id)).toBe(INDIVIDUAL_IDENTITY.id);
});

it("continues silently as the identity remembered on this device while it is still held", async () => {
  clearRememberedIdentity();
  const server = serveSeveralIdentities();
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Choose an identity"));
  await act(async () => {
    [...card().querySelectorAll("button")].find((button) => button.textContent?.includes("Alpha Org"))!.click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));

  // The next sign-in on this device starts a session that has chosen nothing.
  await act(() => render(null, host));
  clearAuth();
  server.session = { ...server.session, actingIdentityId: null };
  server.selections.length = 0;
  mocks.renderShell.mockReset();
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(host.textContent).not.toContain("Choose an identity");
  expect(server.selections).toEqual([ALPHA_IDENTITY.id]);
});

it("asks again when the identity remembered on this device is no longer held", async () => {
  clearRememberedIdentity();
  localStorage.setItem(
    `portal-acting-identity:${portalSessionFixture({}).identity.id}`,
    "00000000-0000-4000-8000-0000000000ff",
  );
  const server = serveSeveralIdentities();
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Choose an identity"));
  expect(server.selections).toEqual([]);
});
