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

const REQUEST_ID = "00000000-0000-4000-8000-000000000001";
const onSessionExpired = vi.fn(async () => {});
const RETURN_TO =
  "/api/v1/auth/oauth/authorize?client_id=client-1&redirect_uri=https%3A%2F%2Fclient.example%2Fcallback";
const CONTEXT_BASE = {
  returnTo: RETURN_TO,
  clientId: "client-1",
  actingIdentityId: null,
  redirectHost: "client.example",
};
const AREAS = [
  {
    key: "forms",
    label: "Forms",
    permissions: [
      {
        permission: "forms:read",
        label: "View forms and responses",
        access: "read",
        allResources: true,
        resourceCount: 0,
      },
      {
        permission: "forms:write",
        label: "Manage forms and responses",
        access: "write",
        allResources: true,
        resourceCount: 0,
      },
    ],
  },
  {
    key: "users",
    label: "Users",
    permissions: [
      { permission: "users:read", label: "View user records", access: "read", allResources: false, resourceCount: 2 },
    ],
  },
];
const ALL_SCOPES = ["forms:read", "forms:write", "users:read"];
const AUTHORIZED_CONTEXT = {
  ...CONTEXT_BASE,
  authenticated: true,
  authorized: true,
  clientName: "Example forms and users client",
  requestedScopes: ALL_SCOPES,
  grantedScopes: ALL_SCOPES,
  userEmail: "person@example.test",
  staffEmail: "person@example.test",
  areas: AREAS,
};

/** A context with no account behind it: signed out, or signed in without staff authorization. */
function contextWithout(overrides: Partial<typeof AUTHORIZED_CONTEXT>) {
  return {
    ...AUTHORIZED_CONTEXT,
    authenticated: false,
    authorized: false,
    grantedScopes: [],
    userEmail: null,
    staffEmail: null,
    areas: [],
    ...overrides,
  };
}

const PROFILE = {
  userId: "00000000-0000-4000-8000-000000000001",
  identityId: null,
  emailId: null,
  email: "person@example.test",
  emailAddresses: [],
  firstName: "Robin",
  lastName: "Example",
  preferredName: null,
  jobTitle: null,
  biography: null,
  links: [],
  membershipCategory: null,
  organizationId: null,
  organizationName: null,
  memberSince: null,
  showOnOrgProfile: false,
  headshotUrl: null,
  isOrgContact: false,
  organizationIdentities: null,
  activeIdentities: [],
};

/** The account behind an authorized consent: the session and the person's own profile. */
function accountResponse(path: string): Response | null {
  if (path === "/api/v1/auth/session") return Response.json(portalSessionFixture({ staff: true }));
  if (path === "/api/v1/users/current") return Response.json(PROFILE);
  return null;
}
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

/** A row's Read or Write checkbox, found by its accessible name. */
function toggle(name: string): HTMLInputElement {
  return checkbox(name);
}

function checkbox(label: string): HTMLInputElement {
  const wrapper = Array.from(container.querySelectorAll("label")).find((el) => el.textContent?.includes(label));
  return wrapper!.querySelector("input")!;
}

beforeEach(() => {
  window.localStorage.clear();
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
  it("returns an expired session to the portal login without offering another login form", async () => {
    window.location.hash = `#/auth/oauth?request=${REQUEST_ID}`;
    onSessionExpired.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(contextWithout({ clientName: "Test client" }))),
    );
    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => onSessionExpired.mock.calls.length === 1);
    expect(container.querySelector("form")).toBeNull();
  });

  it("sets read and write per area and for every area, and reads a partial choice as custom", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ request: REQUEST_ID })}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: RequestInfo | URL) =>
          accountResponse(requestUrl(input).pathname) ?? Response.json(AUTHORIZED_CONTEXT),
      ),
    );
    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => buttonLabeled("Authorize") !== undefined);

    // Everything the client asked for and this person can delegate starts chosen.
    expect(toggle("Write: All areas").checked).toBe(true);
    expect(toggle("Write: Forms").checked).toBe(true);
    // An area with nothing to write keeps the column, disabled.
    expect(toggle("Write: Users").disabled).toBe(true);
    expect(container.textContent).toContain("Limited to where you have this permission");

    await act(() => toggle("Write: All areas").click());
    expect(toggle("Write: Forms").checked).toBe(false);
    expect(toggle("Read: Forms").checked).toBe(true);

    await act(() => toggle("Read: Users").click());
    expect(toggle("Read: All areas").checked).toBe(false);
    expect(container.textContent).toContain("Custom, 1 of 3 permissions");

    await act(() => toggle("Read: All areas").click());
    await act(() => toggle("Read: All areas").click());
    expect(buttonLabeled("Authorize")?.disabled).toBe(true);
  });

  it("lists an area's permissions only when a column stands for more than one", async () => {
    const events = {
      key: "events",
      label: "Events",
      permissions: [
        {
          permission: "events:read",
          label: "View event configuration",
          access: "read",
          allResources: true,
          resourceCount: 0,
        },
        {
          permission: "events:write",
          label: "Update event configuration",
          access: "write",
          allResources: true,
          resourceCount: 0,
        },
        { permission: "events:manage", label: "Manage events", access: "write", allResources: true, resourceCount: 0 },
      ],
    };
    const scopes = [...ALL_SCOPES, "events:read", "events:write", "events:manage"];
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ request: REQUEST_ID })}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (input: RequestInfo | URL) =>
          accountResponse(requestUrl(input).pathname) ??
          Response.json({
            ...AUTHORIZED_CONTEXT,
            requestedScopes: scopes,
            grantedScopes: scopes,
            areas: [...AREAS, events],
          }),
      ),
    );
    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => buttonLabeled("Authorize") !== undefined);

    // One read and one write: the columns already say it all.
    expect(container.querySelector('[aria-label="Forms permissions"]')).toBeNull();
    const disclosure = container.querySelector<HTMLButtonElement>('[aria-label="Events permissions"]')!;
    await act(() => disclosure.click());
    await act(() => checkbox("Manage events").click());
    expect(toggle("Write: Events").checked).toBe(false);
    expect(toggle("Read: Events").checked).toBe(true);
    expect(container.textContent).toContain("Custom, 2 of 3");
  });

  it("authorizes the chosen permissions and follows the completed redirect", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ request: REQUEST_ID })}`;
    let decision: unknown;
    let polls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = requestUrl(input).pathname;
        if (init?.method === "POST") {
          decision = JSON.parse(String(init.body));
          return Response.json(
            { authorizationId: "00000000-0000-4000-8000-000000000009", status: "pending" },
            { status: 202 },
          );
        }
        if (path.endsWith("/completion")) {
          polls += 1;
          return Response.json(
            polls < 2
              ? { status: "pending" }
              : { status: "active", redirectTo: `${window.location.href.split("#", 1)[0]}#/returned` },
          );
        }
        return accountResponse(path) ?? Response.json(AUTHORIZED_CONTEXT);
      }),
    );
    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => buttonLabeled("Authorize") !== undefined);
    await act(() => toggle("Write: Forms").click());
    await act(() => buttonLabeled("Authorize")!.click());
    await waitFor(() => window.location.hash === "#/returned");

    expect(mcpOauthAuthorizeActionSchema.parse(decision)).toEqual({
      action: "approve",
      return_to: RETURN_TO,
      scopes: ["forms:read", "users:read"],
      actingIdentityId: null,
    });
    expect(polls).toBe(2);

    // The next request from the same app starts from this choice.
    await act(() => render(null, container));
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ request: REQUEST_ID })}`;
    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => buttonLabeled("Authorize") !== undefined);
    expect(toggle("Write: Forms").checked).toBe(false);
    expect(toggle("Read: Forms").checked).toBe(true);
    expect(toggle("Read: Users").checked).toBe(true);
  });

  it.each(["context", "missing"])(
    "clears previous consent when a new authorization has a %s failure",
    async (failure) => {
      window.location.hash = `#/auth/oauth?request=${REQUEST_ID}`;
      let available = true;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) =>
          available
            ? (accountResponse(requestUrl(input).pathname) ?? Response.json(AUTHORIZED_CONTEXT))
            : Response.json(
                { error: { code: "UPSTREAM_UNAVAILABLE", message: "New consent unavailable." } },
                { status: 503 },
              ),
        ),
      );
      await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
      await waitFor(() => buttonLabeled("Authorize") !== undefined);
      available = false;
      await act(() => {
        window.location.hash =
          failure === "missing" ? "#/auth/oauth" : "#/auth/oauth?request=00000000-0000-4000-8000-000000000002";
        window.dispatchEvent(new HashChangeEvent("hashchange"));
      });
      if (failure !== "missing")
        await waitFor(() => container.textContent?.includes("New consent unavailable.") ?? false);
      else await flush();
      expect(buttonLabeled("Authorize")).toBeUndefined();
      expect(buttonLabeled("Cancel")).toBeUndefined();
      expect(container.textContent).not.toContain(AUTHORIZED_CONTEXT.clientName);
    },
  );

  it("clears consent and delegates expired approval recovery to the normal portal session", async () => {
    window.location.hash = `#/auth/oauth?request=${REQUEST_ID}`;
    onSessionExpired.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
        init?.method === "POST"
          ? Response.json({ error: { code: "AUTH_EXPIRED", message: "Sign in again." } }, { status: 401 })
          : (accountResponse(requestUrl(input).pathname) ?? Response.json(AUTHORIZED_CONTEXT)),
      ),
    );
    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => buttonLabeled("Authorize") !== undefined);
    await act(() => buttonLabeled("Authorize")!.click());
    await waitFor(() => onSessionExpired.mock.calls.length === 1);
    expect(buttonLabeled("Authorize")).toBeUndefined();
    expect(buttonLabeled("Cancel")).toBeUndefined();
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("person@example.test");
    expect(window.location.hash).toContain(REQUEST_ID);
  });

  it("hides approval and login controls from a signed-in identity without staff authorization", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ request: REQUEST_ID })}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          contextWithout({ authenticated: true, clientName: "Test client", userEmail: "member@example.test" }),
        ),
      ),
    );

    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    const refusal = container.querySelector('[role="alert"]');
    expect(refusal?.textContent).toContain("Signed in as member@example.test");
    expect(refusal?.textContent).toContain("does not have permission");
    expect(controlLabeled("Portal email")).toBeNull();
    expect(buttonLabeled("Authorize")).toBeUndefined();
    expect(buttonLabeled("Deny and go back")).toBeTruthy();
  });

  it("announces a failed context lookup and offers nothing to approve", async () => {
    window.location.hash = `#/auth/oauth?${new URLSearchParams({ request: REQUEST_ID })}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { error: { code: "UPSTREAM_UNAVAILABLE", message: "The authorization request could not be read." } },
          { status: 502 },
        ),
      ),
    );

    await act(() => render(<McpAuthorization onSessionExpired={onSessionExpired} />, container));
    await waitFor(() => container.querySelector('[role="alert"]') !== null);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "The authorization request could not be read.",
    );
    expect(buttonLabeled("Authorize")).toBeUndefined();
  });
});
