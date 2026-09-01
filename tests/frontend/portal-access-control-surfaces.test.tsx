// @vitest-environment jsdom
/**
 * The two access-control surfaces that have adopted the design system:
 * `Grants` and `roles/RoleDetail`.
 *
 * What is asserted here is deliberately what a visual review cannot see and
 * the isolation gate cannot either — the label/control pairs, the table
 * captions, the accessible names on the icon-only row menus, the live region
 * a rejected submission lands in — plus the failure paths, which is where a
 * migrated form most easily loses the only thing that told the reader what
 * went wrong.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Grants } from "../../assets/ts/member-flows/portal/sections/access-control/Grants";
import { RoleDetail } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleDetail";
import { accessGrantCreateSchema } from "../../assets/shared/schemas/access-control";

const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function apiError(code: string, message: string, status: number): Response {
  return json({ error: { code, message } }, status);
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function mount(node: preact.ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

function pathOf(input: RequestInfo | URL): string {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(href, location.origin).pathname;
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

/** The control a `<label>` points at, resolved through the `for`/`id` pair. */
function controlFor(container: HTMLElement, labelText: string): HTMLElement {
  const label = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent === labelText);
  if (!label) throw new Error(`missing label: ${labelText}`);
  const target = label.getAttribute("for");
  expect(target, `label "${labelText}" points at no control`).toBeTruthy();
  const control = container.querySelector<HTMLElement>(`[id="${target!}"]`);
  if (!control) throw new Error(`label "${labelText}" points at a missing id: ${target!}`);
  return control;
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const GRANT = {
  id: "00000000-0000-4000-8000-000000000001",
  userId: "00000000-0000-4000-8000-000000000002",
  userEmail: "staff@example.test",
  permission: "access:grant",
  contextType: null,
  contextId: null,
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const CANDIDATE = {
  id: "30000000-0000-4000-8000-000000000001",
  email: "grace@example.test",
  first_name: "Grace",
  last_name: "Hopper",
  organization_name: null,
};

const ROLE = {
  id: "role-custom-1",
  name: "custom_reviewer",
  description: "Reviews things",
  isSystemRole: false,
  permissions: ["events:read", "events:write"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const ASSIGNMENT = {
  userRoleId: "10000000-0000-4000-8000-000000000001",
  userId: "20000000-0000-4000-8000-000000000001",
  name: "Ada Lovelace",
  email: "ada@example.test",
  contextType: null,
  contextId: null,
  expiresAt: null,
  createdAt: "2026-01-02T00:00:00.000Z",
};

/**
 * Stubs the grants list plus whatever the caller adds, and records every
 * request so a test can assert that a rejected submission never reached the
 * network.
 */
function stubGrantsApi(extra?: (path: string, init?: RequestInit) => Response | undefined) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathOf(input);
      const method = init?.method ?? "GET";
      requests.push({
        method,
        path,
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const handled = extra?.(path, init);
      if (handled) return handled;
      if (path === "/api/v1/permissions/grants" && method === "GET") {
        return json({ grants: [GRANT], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }
      if (path === "/api/v1/permissions/subjects") {
        return json({ users: [CANDIDATE], page: { limit: 8, offset: 0, total: 1, hasMore: false } });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    }),
  );
  return requests;
}

/** Drives the debounced UserPicker to a selection, as a reader would. */
async function pickCandidate(container: HTMLElement): Promise<void> {
  vi.useFakeTimers();
  const search = container.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
  void act(() => {
    search.value = "grace";
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(250);
  });
  vi.useRealTimers();
  await settle();
  const option = [...container.querySelectorAll("button")].find((button) =>
    button.textContent?.includes(CANDIDATE.email),
  );
  if (!option) throw new Error("UserPicker offered no match");
  void act(() => option.click());
}

function submitGrantForm(container: HTMLElement): Promise<void> {
  const form = container.querySelector<HTMLFormElement>('form[aria-label="Grant a permission"]')!;
  return act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Grants on the design system", () => {
  it("names its controls, its table and its row menu for assistive technology", async () => {
    stubGrantsApi();
    const container = mount(<Grants canGrant canRevoke />);
    await settle();

    // The list names itself, so a page holding several tables does not
    // announce several anonymous ones.
    expect(container.querySelector("caption")?.textContent).toBe("Permission grants");

    // The icon-only row menu says which row it belongs to.
    const rowMenu = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(rowMenu?.getAttribute("aria-label")).toBe(`Actions for the ${GRANT.permission} grant to ${GRANT.userEmail}`);

    void act(() => buttonNamed(container, "New grant").click());

    // Single-control fields are labelled by a real for/id pair …
    expect(controlFor(container, "Permission").tagName).toBe("SELECT");
    const expires = controlFor(container, "Expires (optional)");
    expect(expires.getAttribute("type")).toBe("datetime-local");

    // … and their guidance is wired, not merely adjacent.
    const describedBy = expires.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toBe(
      "Leave empty for a grant that never expires.",
    );

    // The two multi-control pickers have no single control to point a `for`
    // at, so each is named by its group's legend instead.
    const legends = [...container.querySelectorAll("legend")].map((legend) => legend.textContent);
    expect(legends).toEqual(["User", "Target"]);
  });

  it("refuses an incomplete grant in a live region and sends nothing", async () => {
    const requests = stubGrantsApi();
    const container = mount(<Grants canGrant canRevoke />);
    await settle();
    void act(() => buttonNamed(container, "New grant").click());

    await submitGrantForm(container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Pick a user first.");
    expect(requests.some((request) => request.method === "POST")).toBe(false);
    // The form stays open on the control that needs fixing.
    expect(container.querySelector('form[aria-label="Grant a permission"]')).toBeTruthy();
  });

  it("keeps a rejected grant's reason on the form instead of only in a toast", async () => {
    stubGrantsApi((path, init) =>
      path === "/api/v1/permissions/grants" && init?.method === "POST"
        ? apiError("FORBIDDEN", "You cannot grant that permission.", 403)
        : undefined,
    );
    const container = mount(<Grants canGrant canRevoke />);
    await settle();
    void act(() => buttonNamed(container, "New grant").click());
    await pickCandidate(container);

    await submitGrantForm(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("You cannot grant that permission.");
    expect(container.querySelector('form[aria-label="Grant a permission"]')).toBeTruthy();
  });

  it("posts a body the shared accessGrantCreateSchema accepts, then closes the form", async () => {
    const requests = stubGrantsApi((path, init) =>
      path === "/api/v1/permissions/grants" && init?.method === "POST"
        ? json({ grant: { ...GRANT, userId: CANDIDATE.id, userEmail: CANDIDATE.email } })
        : undefined,
    );
    const container = mount(<Grants canGrant canRevoke />);
    await settle();
    void act(() => buttonNamed(container, "New grant").click());
    await pickCandidate(container);

    await submitGrantForm(container);

    const posted = requests.find((request) => request.method === "POST");
    expect(posted).toBeTruthy();
    const parsed = accessGrantCreateSchema.parse(posted!.body);
    expect(parsed.userId).toBe(CANDIDATE.id);
    expect(parsed.contextType).toBeNull();
    expect(container.querySelector('form[aria-label="Grant a permission"]')).toBeNull();
  });
});

describe("RoleDetail on the design system", () => {
  function stubRoleApi(role: typeof ROLE, roleResponse?: Response) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = pathOf(input);
        if (path === `/api/v1/roles/${role.id}`) return roleResponse ?? json({ role });
        if (path === `/api/v1/roles/${role.id}/assignments`) {
          return json({ assignments: [ASSIGNMENT], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
        }
        if (path === "/api/v1/permissions/subjects") {
          return json({ users: [CANDIDATE], page: { limit: 8, offset: 0, total: 1, hasMore: false } });
        }
        throw new Error(`Unexpected request: ${path}`);
      }),
    );
  }

  it("announces the wait, then titles both panels and names the assignee table", async () => {
    stubRoleApi(ROLE);
    const container = mount(<RoleDetail roleId={ROLE.id} canGrant canRevoke onBack={vi.fn()} />);

    // The wait is announced rather than mimed by a grey rectangle.
    const busy = container.querySelector('[role="status"]');
    expect(busy?.textContent).toContain("Loading role…");

    await settle();
    await settle();

    // Two panels, two real headings, in document order — the role, then its
    // assignees. A migrated surface that dropped one would leave the page's
    // outline with a nameless region.
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      ROLE.name,
      "Assignees",
    ]);
    expect(container.querySelector("caption")?.textContent).toBe(`${ROLE.name} assignees`);
    expect(container.querySelector('[aria-haspopup="menu"]')?.getAttribute("aria-label")).toBe(
      `Actions for ${ASSIGNMENT.name}`,
    );
    expect(container.textContent).toContain(ASSIGNMENT.name);
    expect(container.textContent).toContain(ASSIGNMENT.email);

    // Permissions are listed as identifiers, in the monospace face.
    expect([...container.querySelectorAll(".pk-mono")].map((node) => node.textContent)).toEqual(
      expect.arrayContaining(ROLE.permissions),
    );
  });

  it("says a system role is a system role in words, and offers no Edit", async () => {
    const systemRole = { ...ROLE, id: "role-system-1", name: "group_lead", isSystemRole: true };
    stubRoleApi(systemRole);
    const container = mount(<RoleDetail roleId={systemRole.id} canGrant canRevoke onBack={vi.fn()} />);
    await settle();
    await settle();

    // The tone is not the message: the badge carries the word "System".
    expect(container.querySelector(".pk-badge")?.textContent).toBe("System");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "Edit")).toBe(false);
  });

  it("shows why a role could not be loaded and renders no empty panels behind it", async () => {
    stubRoleApi(ROLE, apiError("NOT_FOUND", "Role not found", 404));
    const container = mount(<RoleDetail roleId={ROLE.id} canGrant canRevoke onBack={vi.fn()} />);
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Role not found");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelectorAll("h3")).toHaveLength(0);
    // The way back out of the failure is still there.
    expect(buttonNamed(container, "← All roles")).toBeTruthy();
  });

  it("returns to the list through a real button rather than a clickable div", async () => {
    stubRoleApi(ROLE);
    const onBack = vi.fn();
    const container = mount(<RoleDetail roleId={ROLE.id} canGrant canRevoke onBack={onBack} />);
    await settle();

    const back = buttonNamed(container, "← All roles");
    expect(back.tagName).toBe("BUTTON");
    expect(back.getAttribute("type")).toBe("button");
    void act(() => back.click());
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
