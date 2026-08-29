import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpAuthorization } from "../../assets/ts/member-flows/portal/shell/McpAuthorization";
import { portalSessionFixture } from "../helpers/portal-session";

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
    await waitFor(() => container.querySelector("#mcp-oauth-email") !== null);
    const email = container.querySelector<HTMLInputElement>("#mcp-oauth-email")!;
    email.value = "staff@example.test";
    await act(() => {
      container.querySelector<HTMLFormElement>("form")!.dispatchEvent(new Event("submit"));
    });
    await waitFor(() => container.textContent?.includes("you'll receive a sign-in link") ?? false);

    expect(container.textContent).toContain("you'll receive a sign-in link");
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "/api/v1/auth/oauth/authorize", method: "GET" }),
        expect.objectContaining({
          path: "/api/v1/auth/oauth/authorize",
          method: "POST",
          body: { action: "request-link", email: "staff@example.test", return_to: RETURN_TO },
        }),
      ]),
    );
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
    await waitFor(() => container.textContent?.includes("Signed in as person@example.test") ?? false);

    expect(requests[0]).toEqual({ path: "/api/v1/auth/verify-link", method: "POST" });
    expect(container.textContent).toContain("Signed in as person@example.test");
    expect(container.textContent).toContain("events:read");
    expect(container.querySelector<HTMLButtonElement>("button.btn-success")?.disabled).toBe(false);
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
    await waitFor(() => container.textContent?.includes("does not have permission") ?? false);

    expect(container.textContent).toContain("Signed in as member@example.test");
    expect(container.querySelector("#mcp-oauth-email")).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((button) => button.textContent === "Approve")).toBe(
      false,
    );
    expect(container.textContent).toContain("Deny and return to client");
  });
});
