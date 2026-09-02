// @vitest-environment jsdom
/**
 * The People tab of Access Control: what it sends when a role is assigned,
 * what it says when the assignment is refused, and what it names for a reader
 * who never sees the panel it is drawn in.
 */
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userRoleAssignSchema } from "../../assets/shared/schemas/access-control";
import { UserRoles } from "../../assets/ts/member-flows/portal/sections/access-control/UserRoles";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000002";
const ROLE_ID = "00000000-0000-4000-8000-000000000003";
const USER_EMAIL = "assignee@example.test";
const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(delay = 0): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, delay));
  });
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function pageOf(url: URL, total: number, rowCount: number) {
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return { limit, offset, total, hasMore: offset + rowCount < total };
}

function subject() {
  return {
    id: USER_ID,
    email: USER_EMAIL,
    first_name: "Assign",
    last_name: "Ee",
    organization_name: null,
    role: "user",
    active: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    member_id: null,
    member_category: null,
    member_status: null,
    member_organization_id: null,
    member_organization_name: null,
    links: [],
    membership: null,
    type: "contact_only",
    organizationNames: [],
    organizationCount: 0,
  };
}

function assignableRole() {
  return {
    id: ROLE_ID,
    name: "membership_processor",
    description: null,
    isSystemRole: true,
    permissions: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function assignment() {
  return {
    id: ASSIGNMENT_ID,
    userId: USER_ID,
    roleId: ROLE_ID,
    roleName: "membership_processor",
    contextType: null,
    contextId: null,
    expiresAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * The collection reads every route this surface touches; `onAssign` decides
 * what the POST does, which is the only thing that differs between the cases.
 */
function stubApi(onAssign: (body: unknown) => Response): URL[] {
  const seen: URL[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      seen.push(url);
      if (url.pathname === `/api/v1/users/${USER_ID}/roles` && init?.method === "POST") {
        return onAssign(JSON.parse(init.body as string));
      }
      if (url.pathname === "/api/v1/permissions/subjects") {
        return jsonResponse({ users: [subject()], page: pageOf(url, 1, 1) });
      }
      if (url.pathname === "/api/v1/roles") {
        return jsonResponse({ roles: [assignableRole()], page: pageOf(url, 1, 1) });
      }
      if (url.pathname === `/api/v1/users/${USER_ID}/roles`) {
        return jsonResponse({ roles: [assignment()], page: pageOf(url, 1, 1) });
      }
      throw new Error(`Unexpected request: ${init?.method ?? "GET"} ${url.pathname}`);
    }),
  );
  return seen;
}

/** Picks the one matching person through the suggestion list's accessible name. */
async function pickUser(container: HTMLElement): Promise<void> {
  const search = container.querySelector<HTMLInputElement>('.portal-access-role-user-picker input[type="text"]')!;
  search.value = "assignee";
  void act(() => {
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(300);
  const suggestions = container.querySelector('[role="group"][aria-label="Matching users"]')!;
  void act(() => (suggestions.querySelector("button") as HTMLButtonElement).click());
  await settle();
}

async function submitAssignForm(container: HTMLElement): Promise<void> {
  const form = container.querySelector<HTMLFormElement>(`form[aria-label="Assign a role to ${USER_EMAIL}"]`)!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("UserRoles", () => {
  it("posts an assignment the shared contract accepts", async () => {
    let captured: unknown;
    stubApi((body) => {
      captured = body;
      return jsonResponse({ role: assignment() }, 201);
    });

    const container = mount(<UserRoles />);
    await pickUser(container);
    await submitAssignForm(container);

    // Parsed through the contract rather than compared field by field: a
    // literal comparison passes even when the schema has moved on.
    const parsed = userRoleAssignSchema.parse(captured);
    expect(parsed.roleId).toBe(ROLE_ID);
    expect(parsed.contextType).toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("keeps a refused assignment on screen, in words, beside the form", async () => {
    stubApi(() => jsonResponse({ error: { code: "CONFLICT", message: "That role is already assigned" } }, 409));

    const container = mount(<UserRoles />);
    await pickUser(container);
    await submitAssignForm(container);

    // role="alert" rather than a toast: the sentence outlives the moment and
    // stays with the control it is about.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That role is already assigned");
    // The form is still there to correct and resubmit.
    expect(container.querySelector(`form[aria-label="Assign a role to ${USER_EMAIL}"]`)).not.toBeNull();
    const assign = [...container.querySelectorAll("button")].find((button) => button.textContent === "Assign")!;
    expect(assign.getAttribute("aria-busy")).toBeNull();
  });

  it("names the roster, the form, and every control group it draws", async () => {
    stubApi(() => jsonResponse({ role: assignment() }, 201));

    const container = mount(<UserRoles />);
    await pickUser(container);

    // A table announced as "table" is indistinguishable from the next one; the
    // caption says whose roles these are.
    expect(container.querySelector("caption")?.textContent).toBe(`Roles assigned to ${USER_EMAIL}`);
    // Both multi-control groups are named by a legend, because neither has a
    // single control for a label's `for` to point at.
    const legends = [...container.querySelectorAll("legend")].map((legend) => legend.textContent);
    expect(legends).toEqual(expect.arrayContaining(["User", "Target"]));
    // The one single-control field keeps a real label/control pair.
    const expires = [...container.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Expires"))!;
    expect(container.querySelector(`[id="${expires.htmlFor}"]`)).not.toBeNull();
  });

  it("offers no way in before a person is chosen, and none to revoke without the permission", async () => {
    stubApi(() => jsonResponse({ role: assignment() }, 201));

    const container = mount(<UserRoles canGrant={false} canRevoke={false} />);
    expect(container.textContent).toContain("Pick a user to view and manage their role assignments.");
    expect(container.querySelector("table")).toBeNull();

    await pickUser(container);
    expect(container.querySelector(`form[aria-label="Assign a role to ${USER_EMAIL}"]`)).toBeNull();
    // No row commands: the head's column menus are the table's own, not a way in.
    expect(container.querySelector('tbody [aria-haspopup="menu"]')).toBeNull();
    expect(container.querySelector("caption")?.textContent).toBe(`Roles assigned to ${USER_EMAIL}`);
  });
});
