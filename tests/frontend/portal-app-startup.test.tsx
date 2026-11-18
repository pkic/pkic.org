// @vitest-environment jsdom
import { fetchMock, host, mocks, mount, pendingResponse, card, refusal } from "./helpers/portal-app-harness";
import { render } from "preact";
import { act } from "preact/test-utils";
import axe from "axe-core";
import { expect, it, vi } from "vitest";
import { clearAuth, portalSession, logoutNotice, savePortalSession } from "../../assets/ts/member-flows/portal/state";
import { rememberedActingIdentityId } from "../../assets/ts/member-flows/portal/acting-identity";
import { myActiveIdentitySwitchSchema } from "../../assets/shared/schemas/me";
import { memoryStorage } from "./helpers/browser-storage";
import { portalIdentityChoiceFixtures, portalProfileFixture, portalSessionFixture } from "../helpers/portal-session";
import { userAuthVerifySchema, userAuthRequestSchema } from "../../assets/shared/schemas/user-auth";

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

it("replaces obsolete sign-out and verification notices when another sign-in attempt starts", async () => {
  logoutNotice.value = "You are signed out.";
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
  expect(card().querySelectorAll(".pk-alert")).toHaveLength(1);
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
  expect(card().querySelectorAll(".pk-alert")).toHaveLength(1);
  expect(logoutNotice.value).toBeNull();
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

it("returns to a personal meeting link when its sign-in link opened twice already signed this browser in", async () => {
  const meetingToken = `m2.${"A".repeat(22)}.${"B".repeat(22)}.0.${"C".repeat(22)}`;
  window.location.hash = `#/verify?token=synthetic-used-link&next=${encodeURIComponent(`/meeting-link/${meetingToken}`)}`;
  const session = portalSessionFixture({ pendingIdentityCount: 1 });
  fetchMock.mockImplementation(async (input: RequestInfo | URL) =>
    String(input).endsWith("/verify-link")
      ? refusal(409, "Magic link already used")
      : Response.json(String(input) === "/api/v1/users/current" ? portalProfileFixture(session) : session),
  );
  await mount();
  await vi.waitFor(() =>
    expect(host.querySelector("[data-meeting-return]")?.getAttribute("data-meeting-return")).toBe(
      `/m/#token=${meetingToken}`,
    ),
  );
  expect(mocks.renderShell).not.toHaveBeenCalled();
  expect(host.textContent).not.toContain("Magic link already used");
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
  fetchMock.mockImplementation(async (input) =>
    Response.json(String(input) === "/api/v1/users/current" ? portalProfileFixture(session) : session),
  );
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
    "/api/v1/users/current",
  ]);
});

it("holds a work address at the organization step until it is answered, then opens the return route", async () => {
  window.location.hash = "#/verify?token=synthetic-work-link&next=%2Fgroups%2Fsynthetic";
  const session = portalSessionFixture({ pendingIdentityCount: 1 });
  const verifications: unknown[] = [];
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === "/api/v1/auth/verify-link") {
      const body = userAuthVerifySchema.parse(JSON.parse(String(init?.body)));
      verifications.push(body);
      if (!body.organization)
        return Response.json({
          success: true,
          organizationRequired: {
            personalAllowed: true,
            affiliation: {
              email: "ada@own-domain.test",
              domain: "own-domain.test",
              domains: [],
              organization: null,
              organizations: [],
            },
          },
        });
    }
    return Response.json(path === "/api/v1/users/current" ? portalProfileFixture(session) : session);
  });
  await mount();
  const step = await vi.waitFor(() => {
    const region = host.querySelector<HTMLElement>('[aria-label="Add your organization"]');
    expect(region).not.toBeNull();
    return region!;
  });
  expect(step.textContent).toContain("@own-domain.test");
  expect(portalSession.value).toBeNull();
  expect(host.textContent).not.toContain("Authenticated portal content");
  await act(async () => {
    [...step.querySelectorAll("button")].find((button) => button.textContent === "Use it as a personal email")!.click();
  });
  // An unclaimed work domain is kept personal only once confirmed.
  await act(async () => {
    [...document.querySelectorAll<HTMLButtonElement>("dialog[open] button")]
      .find((button) => button.textContent?.trim() === "Use as personal email")!
      .click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(verifications).toEqual([
    { token: "synthetic-work-link" },
    { token: "synthetic-work-link", organization: { personal: true } },
  ]);
  expect(portalSession.value?.sessionId).toBe(session.sessionId);
  expect(window.location.hash).toBe("#/groups/synthetic");
});

it("keeps the passkey offer on screen while the session a link just signed in is refreshed", async () => {
  mocks.supportsPasskeys.mockReturnValue(true);
  window.location.hash = "#/verify?token=synthetic-valid-link";
  const session = portalSessionFixture({ pendingIdentityCount: 0 });
  const refresh = pendingResponse();
  fetchMock.mockImplementation(async (input) => {
    const path = String(input);
    if (path === "/api/v1/auth/session") return refresh.promise;
    return Response.json(path === "/api/v1/users/current" ? portalProfileFixture(session) : session);
  });
  await mount();
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/v1/auth/session"),
  );
  expect(host.textContent).not.toContain("Checking your sign-in");
  expect(host.textContent).toContain("Continue without a passkey");
  await act(async () => {
    refresh.resolve(Response.json(session));
  });
  await vi.waitFor(() =>
    expect(fetchMock.mock.calls.map(([input]) => String(input))).toContain("/api/v1/users/current"),
  );
  expect(host.textContent).toContain("Continue without a passkey");
  expect(mocks.renderShell).not.toHaveBeenCalled();
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

const { organization: ALPHA_IDENTITY, individual: INDIVIDUAL_IDENTITY } = portalIdentityChoiceFixtures;

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
  await vi.waitFor(() => expect(card().textContent).toContain("Choose how you take part"));
  const choices = [...card().querySelectorAll("button")].map(
    (button) => button.querySelector(".pk-identity-choice__name")?.textContent,
  );
  // A first-time attendee chooses between themself and their employer by name.
  // An organization is offered first, and green; the personal identity comes last.
  expect(choices).toEqual(["Alpha Org", "Personal"]);
  expect(mocks.renderShell).not.toHaveBeenCalled();

  await act(async () => {
    [...card().querySelectorAll("button")].find((button) => button.textContent?.includes("Personal"))!.click();
  });
  await vi.waitFor(() => expect(host.textContent).toContain("Authenticated portal content"));
  expect(server.selections).toEqual([INDIVIDUAL_IDENTITY.id]);
  expect(portalSession.value?.actingIdentityId).toBe(INDIVIDUAL_IDENTITY.id);
  expect(rememberedActingIdentityId(portalSession.value!.identity.id)).toBe(INDIVIDUAL_IDENTITY.id);
});

it("offers the identity choices as named buttons with no accessibility defects", async () => {
  clearRememberedIdentity();
  serveSeveralIdentities();
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Choose how you take part"));
  // Each choice is a button named by what it holds: the name and its role, not the decorative tile.
  const names = [...card().querySelectorAll("button")].map(
    (button) => button.getAttribute("aria-label") ?? button.textContent,
  );
  expect(names[0]).toContain("Alpha Org");
  expect(names[0]).toContain("Delegate");
  const results = await axe.run(card(), { rules: { "color-contrast": { enabled: false } } });
  expect(results.violations.map((violation) => `${violation.id}: ${violation.help}`)).toEqual([]);
});

it("continues silently as the identity remembered on this device while it is still held", async () => {
  clearRememberedIdentity();
  const server = serveSeveralIdentities();
  await mount();
  await vi.waitFor(() => expect(card().textContent).toContain("Choose how you take part"));
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
  expect(host.textContent).not.toContain("Choose how you take part");
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
  await vi.waitFor(() => expect(card().textContent).toContain("Choose how you take part"));
  expect(server.selections).toEqual([]);
});

it("confirms an accepted identity invitation, then signs the invitee in without another portal-entry screen", async () => {
  history.replaceState({}, "", "/portal/#/identity-invitations?token=synthetic-invitation");
  const previousSession = portalSessionFixture({});
  savePortalSession(previousSession);
  fetchMock.mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === "/api/v1/identities/invitations/preview" || path === "/api/v1/identities/invitations/accept") {
      const { identityInvitationLinkRequestSchema } = await import("../../assets/shared/schemas/identity");
      expect(identityInvitationLinkRequestSchema.parse(JSON.parse(String(init?.body))).token).toBe(
        "synthetic-invitation",
      );
      return Response.json(
        path.endsWith("preview")
          ? {
              success: true,
              organizationName: "Synthetic Organization",
              recipientEmail: "new-member@example.test",
              viewer: "signed_out",
            }
          : { success: true, identityId: "00000000-0000-4000-8000-000000000042", state: "active" },
      );
    }
    if (path === "/api/v1/auth/session") return refusal(401, "Sign in required");
    throw new Error(`Unexpected request: ${path}`);
  });
  await mount();
  await vi.waitFor(() => expect(host.textContent).toContain("Accept identity"));
  expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual(["/api/v1/identities/invitations/preview"]);
  expect(portalSession.value).toBe(previousSession);
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
  // Acceptance is confirmed before anything else happens; signing in is the reader's next step.
  await vi.waitFor(() => expect(host.textContent).toContain("Invitation accepted"));
  const signIn = [...host.querySelectorAll<HTMLAnchorElement>("a")].find(
    (link) => link.textContent?.trim() === "Sign in to continue",
  )!;
  await act(async () => signIn.click());
  await vi.waitFor(() => expect(window.location.hash).toBe("#/users/current"));
  await vi.waitFor(() => {
    expect(portalSession.value).toBeNull();
    expect(card().textContent).toContain("Sign in");
    expect(card().querySelector<HTMLInputElement>("input")!.matches(":disabled")).toBe(false);
  });
  expect(host.textContent).not.toContain("Identity accepted");
  expect(host.textContent).not.toContain("Open portal");
  expect(mocks.renderShell).not.toHaveBeenCalled();
});

it("uses normal portal login for an MCP request and preserves its reference in the email contract", async () => {
  const returnPath = "/auth/oauth?request=00000000-0000-4000-8000-000000000001";
  window.location.hash = `#${returnPath}`;
  let sent: unknown;
  fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/v1/auth/request-link") {
      sent = JSON.parse(String(init?.body));
      return Response.json({ success: true });
    }
    return refusal(401, "Sign in required");
  });
  await mount();
  await vi.waitFor(() => expect(host.querySelector('input[name="email"]:not(:disabled)')).not.toBeNull());
  const email = host.querySelector<HTMLInputElement>('input[name="email"]')!;
  await act(() => {
    email.value = "admin@pkic.org";
    email.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(() => {
    host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
  });
  await vi.waitFor(() => expect(sent).toBeDefined());
  expect(userAuthRequestSchema.parse(sent)).toEqual({ email: "admin@pkic.org", returnPath });
  expect(fetchMock.mock.calls.some(([input]) => String(input) === "/api/v1/auth/oauth/authorize")).toBe(false);
});
