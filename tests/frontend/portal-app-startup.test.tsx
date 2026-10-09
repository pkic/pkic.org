// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { serviceAvailability } from "../../assets/ts/shared/availability-state";
import { clearAuth, expirePortalSession, portalSession } from "../../assets/ts/member-flows/portal/state";
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
import { portalSessionFixture } from "../helpers/portal-session";
import type { PortalSession } from "../../assets/ts/member-flows/portal/types";
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

const agendaPath = "/events/synthetic/agenda";

function expiredAdministratorSession(): PortalSession {
  return {
    ...portalSessionFixture({ pendingIdentityCount: 1 }),
    hasActiveAffiliation: true,
    staffReauthenticationRequired: true,
  };
}

function renewedAdministratorSession() {
  const session = portalSessionFixture({ staff: true, pendingIdentityCount: 1 });
  session.staff!.expiresAt = "2099-01-01T00:00:00.000Z";
  session.staff!.idleExpiresAt = "2099-01-01T00:00:00.000Z";
  return session;
}

async function openPortalPath(path: string) {
  await act(async () => {
    history.replaceState({}, "", `/portal/#${path}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
}

it.each(["server", "browser"] as const)(
  "gates expired administrator pages after %s expiry while keeping the session and explicit Home access",
  async (expiry) => {
    history.replaceState({}, "", `/portal/#${agendaPath}`);
    const session = expiry === "server" ? expiredAdministratorSession() : renewedAdministratorSession();
    if (expiry === "browser" && session.staff) {
      session.staff!.expiresAt = new Date(Date.now() - 1_000).toISOString();
      session.staff!.idleExpiresAt = session.staff!.expiresAt;
    }
    fetchMock.mockResolvedValue(Response.json(session));
    await mount();
    await vi.waitFor(() => expect(card().querySelector("h1")?.textContent).toBe("Reauthenticate"));
    expect(host.textContent).not.toContain("Authenticated portal content");
    expect(host.textContent).not.toContain("Sign out and sign in again");
    expect(portalSession.value?.sessionId).toBe(session.sessionId);
    expect(portalSession.value?.staff).toBeUndefined();
    expect(window.location.hash).toBe(`#${agendaPath}`);
    const home = card().querySelector<HTMLAnchorElement>('a[href="#/home"]');
    expect(home?.textContent).toBe("Continue to Home");
    await openPortalPath("/home");
    await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
    expect(portalSession.value?.staffReauthenticationRequired).toBe(true);
    await openPortalPath(agendaPath);
    await vi.waitFor(() => expect(card().querySelector("h1")?.textContent).toBe("Reauthenticate"));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.clearPreparation).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/api/v1/auth/session"]);
  },
);

it("keeps a failed passkey prompt and resumes the same agenda only after canonical renewed authority", async () => {
  history.replaceState({}, "", "/portal/#/home");
  mocks.supportsPasskeys.mockReturnValue(true);
  let session = expiredAdministratorSession();
  fetchMock.mockImplementation(async () => Response.json(session));
  await mount();
  // Resolve the lazy shell at the allowed Home landing first, so a transient
  // protected render cannot hide behind an unresolved module import.
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  await openPortalPath(agendaPath);
  await vi.waitFor(() => expect(card().querySelector("h1")?.textContent).toBe("Reauthenticate"));
  mocks.renderShell.mockClear();
  const signIn = () =>
    [...card().querySelectorAll("button")].find((button) => button.textContent === "Sign in with a passkey")!;
  mocks.authenticateWithPasskey.mockImplementationOnce(async () => {
    // The shared 401 interceptor clears local portal state for a rejected
    // public ceremony; the session endpoint remains the authority on its validity.
    expirePortalSession();
    throw new Error("No passkey was selected.");
  });
  await vi.waitFor(() => expect(signIn()?.disabled).toBe(false));
  await act(async () => signIn().click());
  await vi.waitFor(() =>
    expect(card().querySelector('[role="alert"]')?.textContent).toContain("No passkey was selected."),
  );
  expect(portalSession.value?.sessionId).toBe(session.sessionId);
  expect(window.location.hash).toBe(`#${agendaPath}`);
  mocks.authenticateWithPasskey.mockResolvedValue(undefined);
  await vi.waitFor(() => expect(signIn()?.disabled).toBe(false));
  await act(async () => signIn().click());
  await vi.waitFor(() => expect(signIn()?.disabled).toBe(false));
  expect(portalSession.value?.staffReauthenticationRequired).toBe(true);
  expect(host.textContent).not.toContain("Authenticated portal content");
  session = { ...expiredAdministratorSession(), staffReauthenticationRequired: false };
  await vi.waitFor(() => expect(signIn()?.disabled).toBe(false));
  await act(async () => signIn().click());
  await vi.waitFor(() => expect(card().textContent).toContain("Administrator access unavailable"));
  expect(mocks.renderShell).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Authenticated portal content");
  await vi.waitFor(() => expect(signIn()?.disabled).toBe(false));
  expect(portalSession.value?.staff).toBeUndefined();
  session = { ...renewedAdministratorSession(), hasActiveAffiliation: true };
  await vi.waitFor(() => expect(signIn()?.disabled).toBe(false));
  await act(async () => signIn().click());
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(portalSession.value?.staff).toBeDefined();
  expect(portalSession.value?.staffReauthenticationRequired).toBe(false);
  expect(window.location.hash).toBe(`#${agendaPath}`);
  expect(mocks.authenticateWithPasskey).toHaveBeenCalledTimes(4);
  expect(mocks.renderShell).toHaveBeenCalled();
  expect(mocks.signOut).not.toHaveBeenCalled();
});

it("keeps email reauthentication failures signed in and carries the agenda through retry and verification", async () => {
  history.replaceState({}, "", `/portal/#${agendaPath}`);
  let verified = false;
  const session = expiredAdministratorSession();
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/request-link")) {
      expect(userAuthRequestSchema.parse(JSON.parse(String(init?.body)))).toEqual({
        email: "synthetic@example.test",
        returnPath: agendaPath,
      });
      return Response.json({ success: true });
    }
    if (url.endsWith("/verify-link")) {
      const { token } = userAuthVerifySchema.parse(JSON.parse(String(init?.body)));
      if (token === "synthetic-expired-reauthentication") return refusal(410, "This link has expired.");
      expect(token).toBe("synthetic-renewed-reauthentication");
      verified = true;
      return Response.json(renewedAdministratorSession());
    }
    return Response.json(verified ? renewedAdministratorSession() : session);
  });
  await mount();
  const requestLink = async () => {
    await act(async () => {
      const input = card().querySelector<HTMLInputElement>("input")!;
      input.value = "synthetic@example.test";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      card()
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await vi.waitFor(() => expect(card().textContent).toContain("Check your email"));
  };
  await vi.waitFor(() => expect(card().querySelector("h1")?.textContent).toBe("Reauthenticate"));
  await requestLink();
  await openPortalPath(`/verify?token=synthetic-expired-reauthentication&next=${encodeURIComponent(agendaPath)}`);
  await vi.waitFor(() =>
    expect(card().querySelector('[role="alert"]')?.textContent).toContain("This link has expired."),
  );
  expect(portalSession.value?.sessionId).toBe(session.sessionId);
  expect(portalSession.value?.staffReauthenticationRequired).toBe(true);
  expect(host.textContent).not.toContain("Authenticated portal content");
  await requestLink();
  await openPortalPath(`/verify?token=synthetic-renewed-reauthentication&next=${encodeURIComponent(agendaPath)}`);
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(window.location.hash).toBe(`#${agendaPath}`);
  expect(portalSession.value?.staff).toBeDefined();
  expect(mocks.signOut).not.toHaveBeenCalled();
  expect(fetchMock.mock.calls.filter(([input]) => String(input).endsWith("/verify-link"))).toHaveLength(2);
});
