import { render } from "preact";
import { useSyncExternalStore } from "preact/compat";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpAuthorization } from "../../assets/ts/member-flows/portal/shell/McpAuthorization";
import { mcpOauthAuthorizeActionSchema } from "../../assets/shared/schemas/mcp-oauth";
import { portalSessionFixture } from "../helpers/portal-session";

// The browser test exercises the router subscription; unit tests supply its current location.
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => [
    useSyncExternalStore(
      (notify) => {
        window.addEventListener("hashchange", notify);
        return () => window.removeEventListener("hashchange", notify);
      },
      () => window.location.hash,
    ),
    vi.fn(),
  ],
}));

const OAUTH_AUTHORIZE_PATH = "/api/v1/auth/oauth/authorize";
const RETURN_TO =
  "/api/v1/auth/oauth/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback";
const AUTHORIZED_CONTEXT = {
  authenticated: true,
  authorized: true,
  returnTo: RETURN_TO,
  clientId: "client-1",
  clientName: "Example forms, organizations, and users client",
  requestedScopes: ["forms:read", "organizations:read", "users:read"],
  grantedScopes: ["forms:read", "organizations:read", "users:read"],
  userEmail: "staff@example.test",
  staffEmail: "staff@example.test",
};
let container: HTMLDivElement;

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input), window.location.origin);
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitFor(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition() && Date.now() < deadline) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  expect(condition()).toBe(true);
}

/**
 * The control a visible label points at. Resolving it through `for`/`id` is
 * the assertion as much as the lookup: the screen no longer writes a
 * hand-picked id, so a label that pointed nowhere would leave the field
 * nameless and this would find nothing.
 */
function controlLabeled(labelText: string): HTMLInputElement | null {
  const label = Array.from(container.querySelectorAll("label")).find((el) =>
    (el.textContent ?? "").trim().startsWith(labelText),
  );
  if (!label) return null;
  const id = label.getAttribute("for");
  expect(id, `the "${labelText}" label points at nothing`).toBeTruthy();
  return container.querySelector<HTMLInputElement>(`#${id!}`);
}

function buttonLabeled(text: string): HTMLButtonElement | undefined {
  return Array.from(container.querySelectorAll("button")).find((el) => (el.textContent ?? "").trim() === text);
}

/** The value beside a term in the screen's metadata list. */
function definitionFor(term: string): string | undefined {
  const list = container.querySelector("dl");
  const children = Array.from(list?.children ?? []);
  const index = children.findIndex((el) => el.tagName === "DT" && el.textContent?.trim() === term);
  return index < 0 ? undefined : children[index + 1]?.textContent?.trim();
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(() => {
  void act(() => render(null, container));
  container.remove();
  window.location.hash = "";
  vi.unstubAllGlobals();
});

describe("portal MCP authorization", () => {
  it("offers canonical sign-in for an unauthenticated user", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO })}`;
    const requests: Array<{ path: string; method: string; body: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? "GET";
        requests.push({ path: url.pathname, method, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (method === "GET") {
          return Response.json({
            authenticated: false,
            authorized: false,
            returnTo: RETURN_TO,
            clientId: "client-1",
            clientName: "Test client",
            requestedScopes: ["events:read"],
            grantedScopes: [],
            userEmail: null,
            staffEmail: null,
          });
        }
        return Response.json({ success: true, sentTo: "staff@example.test" });
      }),
    );

    await act(() => render(<McpAuthorization />, container));
    await waitFor(() => controlLabeled("Portal email") !== null);
    const email = controlLabeled("Portal email")!;
    expect(email.type).toBe("email");
    expect(email.required).toBe(true);
    // The control is on the shared contract now, so its value lives in state
    // rather than being read back out of the DOM at submit time: typing has to
    // be modelled as an input event, the way a person produces one.
    await act(() => {
      email.value = "staff@example.test";
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() => {
      container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit"));
    });
    await waitFor(() => container.textContent?.includes("you'll receive a sign-in link") ?? false);

    // The confirmation is a live region, not just a green box.
    expect(container.querySelector('[role="status"]')?.textContent).toContain("you'll receive a sign-in link");
    expect(requests.some(({ path, method }) => path === OAUTH_AUTHORIZE_PATH && method === "GET")).toBe(true);

    const posted = requests.find(({ method }) => method === "POST");
    expect(posted?.path).toBe(OAUTH_AUTHORIZE_PATH);
    // Comparing the literal back would only restate what the component sent.
    // Parsing it through the shared contract is what proves the server would
    // accept it — including the discriminator the route switches on.
    expect(mcpOauthAuthorizeActionSchema.parse(posted?.body)).toEqual({
      action: "request-link",
      email: "staff@example.test",
      return_to: RETURN_TO,
    });
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin") || path === "/api/v1/oauth/verify-link")).toBe(
      false,
    );
  });

  it.each([false, true])("redeems the standard user capability with same-tab navigation %s", async (sameTab) => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO, token: "user-token" })}`;
    const tokenHash = window.location.hash;
    if (sameTab) window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO })}`;
    let verified = false;
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? "GET";
        requests.push({ path: url.pathname, method });
        if (url.pathname === "/api/v1/auth/verify-link") {
          verified = true;
          return Response.json({
            ...portalSessionFixture({ staff: true }),
            expiresAt: "2026-08-30T00:00:00.000Z",
          });
        }
        return Response.json({
          authenticated: verified,
          authorized: verified,
          returnTo: RETURN_TO,
          clientId: "client-1",
          clientName: "Test client",
          requestedScopes: ["events:read"],
          grantedScopes: verified ? ["events:read"] : [],
          userEmail: verified ? "person@example.test" : null,
          staffEmail: verified ? "person@example.test" : null,
        });
      }),
    );

    await act(() => render(<McpAuthorization />, container));
    await flush();
    await flush();
    if (sameTab) {
      await waitFor(() => controlLabeled("Portal email") !== null);
      await act(() => {
        window.location.hash = tokenHash;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
    }
    await waitFor(() => definitionFor("Signed in as") === "person@example.test");

    expect(requests).toContainEqual({ path: "/api/v1/auth/verify-link", method: "POST" });
    // The identity and the client are a name/value list, so each value is
    // reachable through the term that names it rather than as loose bold text.
    expect(definitionFor("Signed in as")).toBe("person@example.test");
    expect(definitionFor("Client")).toBe("Test client");
    expect(container.textContent).toContain("events:read");
    expect(buttonLabeled("Approve")?.disabled).toBe(false);
    expect(buttonLabeled("Deny")).toBeTruthy();
    expect(window.location.pathname).toBe("/portal/");
    expect(window.location.hash).not.toContain("token=");
  });

  it.each(["context", "verification", "missing"])(
    "clears previous consent when a new authorization has a %s failure",
    async (failure) => {
      window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO })}`;
      const fetchMock = vi.fn(async () => Response.json(AUTHORIZED_CONTEXT));
      vi.stubGlobal("fetch", fetchMock);
      await act(() => render(<McpAuthorization />, container));
      await waitFor(() => buttonLabeled("Approve") !== undefined);
      expect(definitionFor("Client")).toBe(AUTHORIZED_CONTEXT.clientName);

      fetchMock.mockImplementation(async () =>
        Response.json(
          { error: { code: "UPSTREAM_UNAVAILABLE", message: "New consent unavailable." } },
          { status: 503 },
        ),
      );
      const query = new URLSearchParams({ return_to: RETURN_TO.replace("client-1", "client-2") });
      if (failure === "verification") query.set("token", "new-email-token");
      await act(() => {
        window.location.hash = failure === "missing" ? "#/auth/oauth" : `#/auth/oauth?${query}`;
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      if (failure !== "missing")
        await waitFor(() => container.textContent?.includes("New consent unavailable.") ?? false);
      else await flush();

      expect(buttonLabeled("Approve")).toBeUndefined();
      expect(buttonLabeled("Deny")).toBeUndefined();
      expect(container.querySelector("dl")).toBeNull();
      expect(container.textContent).not.toContain(AUTHORIZED_CONTEXT.clientName);
    },
  );

  it("removes a redeemed email token before a failed consent lookup and retries without replaying it", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO, token: "email-token" })}`;
    let verifications = 0;
    let consentUnavailable = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        if (requestUrl(input).pathname === "/api/v1/auth/verify-link") {
          verifications += 1;
          return Response.json(portalSessionFixture({ staff: true }));
        }
        return consentUnavailable
          ? Response.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Consent unavailable." } }, { status: 503 })
          : Response.json(AUTHORIZED_CONTEXT);
      }),
    );
    await act(() => render(<McpAuthorization />, container));
    await waitFor(() => container.textContent?.includes("Consent unavailable.") ?? false);
    expect(new URLSearchParams(window.location.hash.split("?", 2)[1]).has("token")).toBe(false);
    expect(buttonLabeled("Approve")).toBeUndefined();

    consentUnavailable = false;
    await act(() => render(null, container));
    await act(() => render(<McpAuthorization />, container));
    await waitFor(() => buttonLabeled("Approve") !== undefined);
    expect(verifications).toBe(1);
    expect(definitionFor("Client")).toBe(AUTHORIZED_CONTEXT.clientName);
  });

  it.each([false, true])("returns to sign-in after expiry when context recovery fails: %s", async (recoveryFails) => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO })}`;
    let expired = false;
    let decision: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          decision = JSON.parse(String(init.body));
          expired = true;
          return Response.json(
            { error: { code: "AUTH_EXPIRED", message: "Your authorization session expired. Sign in again." } },
            { status: 401 },
          );
        }
        if (expired && recoveryFails) {
          return Response.json(
            { error: { code: "UPSTREAM_UNAVAILABLE", message: "Temporary consent failure." } },
            { status: 503 },
          );
        }
        return Response.json({
          authenticated: !expired,
          authorized: !expired,
          returnTo: RETURN_TO,
          clientId: "client-1",
          clientName: "Example forms, organizations, and users client",
          requestedScopes: ["forms:read", "organizations:read", "users:read"],
          grantedScopes: expired ? [] : ["forms:read", "organizations:read", "users:read"],
          userEmail: expired ? null : "staff@example.test",
          staffEmail: expired ? null : "staff@example.test",
        });
      }),
    );

    await act(() => render(<McpAuthorization />, container));
    await waitFor(() => buttonLabeled("Approve") !== undefined);
    await act(() => buttonLabeled("Approve")!.click());
    await waitFor(() => controlLabeled("Portal email") !== null);

    const request = mcpOauthAuthorizeActionSchema.parse(decision);
    expect(request.action).toBe("approve");
    if (request.action !== "approve") throw new Error("Expected approval");
    expect(request.return_to).toBe(RETURN_TO);
    expect(request.scopes).toEqual(["forms:read", "organizations:read", "users:read"]);
    expect(buttonLabeled("Approve")).toBeUndefined();
    expect(buttonLabeled("Deny")).toBeUndefined();
    expect(container.querySelector("dl")).toBeNull();
    if (recoveryFails) expect(container.textContent).not.toContain(AUTHORIZED_CONTEXT.clientName);
    expect(container.textContent).not.toContain("forms:read");
    expect(container.textContent).not.toContain("staff@example.test");
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Sign in again.");
    expect(window.location.hash).toContain(encodeURIComponent(RETURN_TO));
  });

  it("hides approval and login controls from a signed-in identity without staff authorization", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO })}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          authenticated: true,
          authorized: false,
          returnTo: RETURN_TO,
          clientId: "client-1",
          clientName: "Test client",
          requestedScopes: ["events:read"],
          grantedScopes: [],
          userEmail: "member@example.test",
          staffEmail: null,
        }),
      ),
    );

    await act(() => render(<McpAuthorization />, container));
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    // A refusal that is only amber says nothing to a reader who cannot see it,
    // so the reason is announced and written out in words.
    const refusal = container.querySelector('[role="alert"]');
    expect(refusal?.textContent).toContain("Signed in as member@example.test");
    expect(refusal?.textContent).toContain("does not have permission");
    expect(controlLabeled("Portal email")).toBeNull();
    expect(buttonLabeled("Approve")).toBeUndefined();
    expect(buttonLabeled("Deny and return to client")).toBeTruthy();
  });

  it("starts read-only, supports mixed-domain presets and individual permissions, and submits the shared subset contract", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO })}`;
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          return Response.json(
            { error: { code: "SCOPE_REQUIRED", message: "Permissions changed. Review again." } },
            { status: 403 },
          );
        }
        return Response.json({
          ...AUTHORIZED_CONTEXT,
          clientName: "Example forms client",
          requestedScopes: [
            "forms:read",
            "forms:write",
            "organizations:read",
            "organizations:write",
            "users:read",
            "users:anonymize",
          ],
          grantedScopes: ["forms:read", "forms:write", "organizations:read", "organizations:write", "users:read"],
        });
      }),
    );
    await act(() => render(<McpAuthorization />, container));
    await waitFor(() => buttonLabeled("Approve") !== undefined);
    const choice = (label: string) =>
      Array.from(container.querySelectorAll("label"))
        .find((el) => el.textContent?.startsWith(label))!
        .querySelector("input")!;
    expect(choice("Read forms").checked).toBe(true);
    expect(choice("Create and edit forms").checked).toBe(false);
    expect(choice("Anonymize users").disabled).toBe(true);
    await act(() => buttonLabeled("Read and write organizations")!.click());
    await act(() => {
      const control = choice("Read users");
      control.checked = false;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(choice("Create and edit organizations").checked).toBe(true);
    expect(choice("Read users").checked).toBe(false);
    await act(() => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true }));
    });
    await waitFor(() => posted.length === 1);
    const request = mcpOauthAuthorizeActionSchema.parse(posted[0]);
    expect(request.action).toBe("approve");
    if (request.action !== "approve") throw new Error("Expected approval");
    expect(request.scopes).toEqual(["forms:read", "organizations:read", "organizations:write"]);
    await waitFor(() => container.textContent?.includes("Permissions changed. Review again.") ?? false);
    await act(() => buttonLabeled("No forms access")!.click());
    await act(() => buttonLabeled("No organizations access")!.click());
    expect(buttonLabeled("Approve")!.disabled).toBe(true);
    expect(buttonLabeled("Deny")!.disabled).toBe(false);
  });

  it("announces a failed context lookup and offers nothing to approve", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO })}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "UPSTREAM_UNAVAILABLE", message: "The authorization request could not be read." } },
          { status: 502 },
        ),
      ),
    );

    await act(() => render(<McpAuthorization />, container));
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The authorization request could not be read.",
    );
    // Nothing is known about the request, so nothing may be granted on it.
    expect(buttonLabeled("Approve")).toBeUndefined();
    expect(container.querySelector("dl")).toBeNull();
  });
});
