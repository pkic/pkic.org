import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpAuthorization } from "../../assets/ts/member-flows/portal/shell/McpAuthorization";
import { mcpOauthAuthorizeActionSchema } from "../../assets/shared/schemas/mcp-oauth";
import { portalSessionFixture } from "../helpers/portal-session";

const OAUTH_AUTHORIZE_PATH = "/api/v1/auth/oauth/authorize";
const RETURN_TO =
  "/api/v1/auth/oauth/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback";
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
  it("requests a canonical user sign-in link without an admin or OAuth verification endpoint", async () => {
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

  it("redeems the standard user capability and renders the permission decision", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ return_to: RETURN_TO, token: "user-token" })}`;
    const requests: Array<{ path: string; method: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = requestUrl(input);
        const method = init?.method ?? "GET";
        requests.push({ path: url.pathname, method });
        if (url.pathname === "/api/v1/auth/verify-link") {
          return Response.json({
            ...portalSessionFixture({ staff: true }),
            expiresAt: "2026-08-30T00:00:00.000Z",
          });
        }
        return Response.json({
          authenticated: true,
          authorized: true,
          returnTo: RETURN_TO,
          clientId: "client-1",
          clientName: "Test client",
          requestedScopes: ["events:read"],
          grantedScopes: ["events:read"],
          userEmail: "person@example.test",
          staffEmail: "person@example.test",
        });
      }),
    );

    await act(() => render(<McpAuthorization />, container));
    await flush();
    await flush();
    await waitFor(() => definitionFor("Signed in as") === "person@example.test");

    expect(requests[0]).toEqual({ path: "/api/v1/auth/verify-link", method: "POST" });
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
