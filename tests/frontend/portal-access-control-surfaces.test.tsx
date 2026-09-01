// @vitest-environment jsdom
/**
 * The access-control surfaces that have adopted the design system: `Grants`,
 * `roles/RoleList` and `roles/RoleDetail`.
 *
 * What is asserted here is deliberately what a visual review cannot see and
 * the isolation gate cannot either — the label/control pairs, the table
 * captions, the accessible names on the row's own controls, the live region
 * a rejected submission lands in — plus the failure paths, which is where a
 * migrated form most easily loses the only thing that told the reader what
 * went wrong.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Grants } from "../../assets/ts/member-flows/portal/sections/access-control/Grants";
import { RoleAssignForm } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleAssignForm";
import { RoleDetail } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleDetail";
import { RoleList } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleList";
import { PermissionCheckboxes } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RolePermissions";
import { PERMISSIONS, type Permission } from "../../assets/shared/schemas/permissions";
import { accessGrantCreateSchema, userRoleAssignSchema } from "../../assets/shared/schemas/access-control";
import { rowActionControlNames } from "./helpers/row-actions";

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

    // The row's commands live behind the `…` menu — even a single one — and
    // the trigger names the grant it acts on rather than being one
    // "Row actions" among a page of them.
    expect(rowActionControlNames(container)).toEqual([`Actions for ${GRANT.permission} granted to ${GRANT.userEmail}`]);

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
    expect(rowActionControlNames(container)).toEqual([`Actions for ${ASSIGNMENT.name}`]);
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

describe("the role assign form", () => {
  /** Records every request, so a refused submission can be shown to send nothing. */
  function stubAssignApi(assign?: Response) {
    const requests: Array<{ method: string; path: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const path = pathOf(input);
        const method = init?.method ?? "GET";
        requests.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
        if (path === "/api/v1/permissions/subjects") {
          return json({ users: [CANDIDATE], page: { limit: 8, offset: 0, total: 1, hasMore: false } });
        }
        if (path === `/api/v1/users/${CANDIDATE.id}/roles` && method === "POST") {
          return (
            assign ??
            json({
              role: {
                ...ASSIGNMENT,
                id: ASSIGNMENT.userRoleId,
                roleId: ROLE.id,
                roleName: ROLE.name,
                userId: CANDIDATE.id,
              },
            })
          );
        }
        throw new Error(`Unexpected request: ${method} ${path}`);
      }),
    );
    return requests;
  }

  function submitAssignForm(container: HTMLElement): Promise<void> {
    const form = container.querySelector<HTMLFormElement>('form[aria-label="Assign this role"]')!;
    return act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  it("names each group it is made of, rather than pointing three labels at nothing", () => {
    stubAssignApi();
    const container = mount(<RoleAssignForm roleId={ROLE.id} onAssigned={vi.fn()} />);

    // The three headings used to be <label> elements with no `for` — a label
    // pointing at nothing names nothing.
    expect([...container.querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual(["User", "Target"]);
    const expires = controlFor(container, "Expires (optional)");
    expect(expires.getAttribute("type")).toBe("datetime-local");
    const describedBy = expires.getAttribute("aria-describedby");
    expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toBe(
      "Leave empty for an assignment that never expires.",
    );
    expect(container.querySelector("form")?.getAttribute("aria-label")).toBe("Assign this role");
  });

  it("refuses an assignment with no user in a live region and sends nothing", async () => {
    const requests = stubAssignApi();
    const container = mount(<RoleAssignForm roleId={ROLE.id} onAssigned={vi.fn()} />);

    await submitAssignForm(container);

    // The reason stays beside the form; a toast would have faded before the
    // reader reached the control it was about.
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Pick a user first.");
    expect(requests.some((request) => request.method === "POST")).toBe(false);
  });

  it("keeps a rejected assignment's reason on the form and does not clear the picker", async () => {
    stubAssignApi(apiError("FORBIDDEN", "You cannot assign that role.", 403));
    const onAssigned = vi.fn();
    const container = mount(<RoleAssignForm roleId={ROLE.id} onAssigned={onAssigned} />);
    await pickCandidate(container);

    await submitAssignForm(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("You cannot assign that role.");
    expect(onAssigned).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')?.value).toBe(
      CANDIDATE.email,
    );
  });

  it("posts a body the shared userRoleAssignSchema accepts and reloads the list", async () => {
    const requests = stubAssignApi();
    const onAssigned = vi.fn();
    const container = mount(<RoleAssignForm roleId={ROLE.id} onAssigned={onAssigned} />);
    await pickCandidate(container);

    await submitAssignForm(container);

    const posted = requests.find((request) => request.method === "POST");
    expect(posted?.path).toBe(`/api/v1/users/${CANDIDATE.id}/roles`);
    // Parsed through the canonical contract rather than compared to a literal.
    const parsed = userRoleAssignSchema.parse(posted!.body);
    expect(parsed.roleId).toBe(ROLE.id);
    expect(parsed.contextType).toBeNull();
    expect(onAssigned).toHaveBeenCalledTimes(1);
  });
});

describe("the permission bundle grid", () => {
  it("renders every permission as a real check block, not a bare label", () => {
    const container = mount(
      <PermissionCheckboxes selected={new Set<Permission>([PERMISSIONS[0]])} onToggle={vi.fn()} />,
    );

    const blocks = [...container.querySelectorAll("label.pk-check")];
    expect(blocks).toHaveLength(PERMISSIONS.length);
    // All three parts, every time: a label carrying only `pk-check` renders
    // the operating system's own checkbox and no gate catches it.
    for (const block of blocks) {
      expect(block.querySelector("input.pk-check__input")).not.toBeNull();
      expect(block.querySelector("span.pk-check__label")).not.toBeNull();
    }
    // The label wraps its control, so there is no `for` left to point nowhere.
    expect(container.querySelector("label[for]")).toBeNull();
    const first = blocks[0].querySelector<HTMLInputElement>("input");
    expect(first?.checked).toBe(true);
    expect(blocks[0].textContent).toBe(PERMISSIONS[0]);
  });

  it("reports a toggle once and takes every control out of play while a save is in flight", () => {
    const onToggle = vi.fn();
    const container = mount(<PermissionCheckboxes selected={new Set<Permission>()} onToggle={onToggle} disabled />);

    const inputs = [...container.querySelectorAll<HTMLInputElement>("input.pk-check__input")];
    expect(inputs.every((input) => input.disabled)).toBe(true);
    // A disabled control reports nothing, so the in-flight save cannot be
    // raced by a second toggle.
    void act(() => inputs[0].click());
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("the roles list on the design system", () => {
  const ROLE = {
    id: "role-custom-1",
    name: "custom_reviewer",
    description: "Reviews things",
    isSystemRole: false,
    permissions: ["events:read"],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("names the roles table and every row control after the role it acts on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ roles: [ROLE], page: { limit: 50, offset: 0, total: 1, hasMore: false } })),
    );
    const container = mount(<RoleList canGrant canRevoke onOpenRole={vi.fn()} onCreateNew={vi.fn()} />);
    await settle();

    // A page of rows used to offer a column of buttons all called "Open" and
    // a column of menus all called "Row actions".
    expect(container.querySelector("caption")?.textContent).toBe("Roles");
    const rowLink = [...container.querySelectorAll("button.pk-table__row-link")].find(
      (control) => control.textContent === "Open custom_reviewer",
    );
    expect(rowLink).toBeTruthy();
    expect(rowActionControlNames(container)).toEqual(["Actions for custom_reviewer"]);
  });

  it("offers exactly one way out of an empty roles list to a caller who can create one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ roles: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const onCreateNew = vi.fn();
    const container = mount(<RoleList canGrant canRevoke onOpenRole={vi.fn()} onCreateNew={onCreateNew} />);
    await settle();

    const empty = container.querySelector('[role="status"]')!;
    expect(empty.textContent).toContain("No roles yet");
    // The empty state names the way out rather than cloning it: one command
    // reachable through one control, so "New role" is not two different
    // buttons to anyone navigating by name.
    expect(empty.textContent).toContain("New role");
    expect(empty.querySelectorAll("button")).toHaveLength(0);
    const actions = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "New role",
    );
    expect(actions).toHaveLength(1);
    void act(() => actions[0].click());
    expect(onCreateNew).toHaveBeenCalled();
  });
});
