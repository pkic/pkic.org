// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AccessControl } from "../../assets/ts/member-flows/portal/sections/access-control";
import { Grants } from "../../assets/ts/member-flows/portal/sections/access-control/Grants";
import { Roles } from "../../assets/ts/member-flows/portal/sections/access-control/Roles";
import { RoleList } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleList";
import { UserRoles } from "../../assets/ts/member-flows/portal/sections/access-control/UserRoles";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { roleCreateSchema, roleUpdateSchema, userRoleAssignSchema } from "../../assets/shared/schemas/access-control";
import { PERMISSIONS } from "../../assets/shared/schemas/permissions";
import { buttonNamed, controlFor } from "./helpers/labelled-control";
import { tabs } from "./helpers/tabs";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
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

beforeEach(() => {
  navigate.mockReset();
});

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const ROLE: {
  id: string;
  name: string;
  description: string | null;
  isSystemRole: boolean;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
} = {
  id: "role-custom-1",
  name: "custom_reviewer",
  description: "Reviews things",
  isSystemRole: false,
  permissions: ["events:read"],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("portal system access control", () => {
  it("uses canonical grants endpoints and puts creation behind an explicit action", async () => {
    const paths: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        paths.push(url.pathname);
        if (url.pathname === "/api/v1/permissions/grants") {
          return json({
            grants: [
              {
                id: "00000000-0000-4000-8000-000000000001",
                userId: "00000000-0000-4000-8000-000000000002",
                userEmail: "staff@example.test",
                permission: "access:grant",
                contextType: null,
                contextId: null,
                expiresAt: null,
                createdAt: "2026-01-01T00:00:00.000Z",
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    // A revoke-only caller sees no way to create a grant at all.
    const revokeOnly = mount(<Grants canGrant={false} canRevoke />);
    await settle();
    expect(revokeOnly.textContent).not.toContain("New grant");
    expect(revokeOnly.textContent).not.toContain("Grant a permission");
    const revokeTrigger = revokeOnly.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]');
    expect(revokeTrigger).toBeTruthy();
    void act(() => revokeTrigger!.click());
    expect(revokeOnly.textContent).toContain("Revoke grant");

    // A grant-authorized caller sees the action, not an always-open form.
    void act(() => render(null, revokeOnly));
    const grantAuthorized = mount(<Grants canGrant canRevoke />);
    await settle();
    expect(grantAuthorized.textContent).toContain("New grant");
    expect(grantAuthorized.textContent).not.toContain("Grant a permission");
    const newGrantButton = Array.from(grantAuthorized.querySelectorAll("button")).find(
      (button) => button.textContent === "New grant",
    );
    expect(newGrantButton).toBeTruthy();
    void act(() => newGrantButton!.click());
    expect(grantAuthorized.textContent).toContain("Grant a permission");

    expect(paths).toEqual(["/api/v1/permissions/grants", "/api/v1/permissions/grants"]);
    expect(paths.some((path) => path.startsWith("/api/v1/admin/"))).toBe(false);
  });

  it("navigates the top-level tabs to their canonical /system/access-control/:tab URLs", () => {
    const container = mount(<AccessControl canGrant canRevoke resourceId="roles" />);
    const tabButtons = Array.from(tabs(container));
    expect(tabButtons.map((button) => button.textContent)).toEqual(["Access Grants", "Roles", "People"]);

    const peopleTab = tabButtons.find((button) => button.textContent === "People")!;
    void act(() => (peopleTab as HTMLButtonElement).click());
    expect(navigate).toHaveBeenCalledWith("/system/access-control/people");

    const grantsTab = tabButtons.find((button) => button.textContent === "Access Grants")!;
    void act(() => (grantsTab as HTMLButtonElement).click());
    expect(navigate).toHaveBeenCalledWith("/system/access-control/grants");
  });

  it("rewrites the bare section path to the tab it is actually showing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    mount(<AccessControl canGrant canRevoke />);
    await settle();
    // Replaced rather than pushed: Back belongs to whoever linked here.
    expect(navigate).toHaveBeenCalledWith("/system/access-control/grants", { replace: true });
  });

  it("leaves a URL that already names its tab alone", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    mount(<AccessControl canGrant canRevoke resourceId="grants" />);
    await settle();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("falls back to the grants tab for an unrecognized resourceId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ grants: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const container = mount(<AccessControl canGrant canRevoke resourceId="not-a-real-tab" />);
    await settle();
    const activeTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(activeTab?.textContent).toBe("Access Grants");
  });

  describe("Roles: list-first, create behind an action, and a URL-addressed detail", () => {
    it("shows a list with a New role action instead of an always-open create form", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ roles: [ROLE], page: { limit: 50, offset: 0, total: 1, hasMore: false } })),
      );
      const onNavigate = vi.fn();
      const container = mount(<Roles canGrant canRevoke onNavigate={onNavigate} />);
      await settle();

      expect(container.textContent).not.toContain("Create a custom role");
      expect(container.textContent).toContain("custom_reviewer");
      const newRoleButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "New role",
      );
      expect(newRoleButton).toBeTruthy();
      void act(() => newRoleButton!.click());
      expect(onNavigate).toHaveBeenCalledWith("new");

      const openButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Open",
      );
      void act(() => openButton!.click());
      expect(onNavigate).toHaveBeenCalledWith(ROLE.id);
    });

    it("hides role creation and deletion without the corresponding authority, but keeps inspection", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ roles: [ROLE], page: { limit: 50, offset: 0, total: 1, hasMore: false } })),
      );
      const container = mount(<Roles canGrant={false} canRevoke={false} onNavigate={vi.fn()} />);
      await settle();

      expect(container.textContent).not.toContain("New role");
      expect(container.textContent).not.toContain("Delete");
      expect(container.textContent).toContain("custom_reviewer");
    });

    it("summarizes a long permission list instead of flooding the row with chips", async () => {
      const fewPermissions = {
        ...ROLE,
        id: "role-few",
        name: "few_perms",
        permissions: ["events:read", "events:write"],
      };
      const someOverflow = {
        ...ROLE,
        id: "role-some",
        name: "some_perms",
        permissions: ["events:read", "events:write", "events:manage", "groups:read", "groups:write", "forms:read"],
      };
      const admin = { ...ROLE, id: "role-admin", name: "admin", permissions: [...PERMISSIONS] };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          json({
            roles: [fewPermissions, someOverflow, admin],
            page: { limit: 50, offset: 0, total: 3, hasMore: false },
          }),
        ),
      );
      const container = mount(<RoleList canGrant canRevoke onOpenRole={vi.fn()} onCreateNew={vi.fn()} />);
      await settle();

      // Four or fewer permissions: every chip shows, no overflow text.
      expect(container.textContent).toContain("events:read");
      expect(container.textContent).toContain("events:write");
      expect(container.textContent).not.toContain("+0 more");

      // Between the chip cap and the count-only threshold: the first four chips plus a "+N more".
      expect(container.textContent).toContain("events:manage");
      expect(container.textContent).toContain("groups:read");
      expect(container.textContent).not.toContain("forms:read");
      expect(container.textContent).toContain("+2 more");

      // Past the count-only threshold: no chips at all, just a count.
      expect(container.textContent).toContain(`${PERMISSIONS.length} permissions`);
      expect(container.textContent).not.toContain("admin:read");
    });

    it("submits a new role through the shared roleCreateSchema-shaped body and navigates to its detail", async () => {
      let captured: { body: unknown } | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            location.origin,
          );
          if (url.pathname === "/api/v1/roles" && init?.method === "POST") {
            captured = { body: JSON.parse(init.body as string) };
            return json({ role: { ...ROLE, id: "role-new", name: "brand_new" } });
          }
          throw new Error(`Unexpected request: ${url.pathname}`);
        }),
      );
      const onNavigate = vi.fn();
      const container = mount(<Roles canGrant roleSegment="new" onNavigate={onNavigate} />);

      const nameInput = controlFor<HTMLInputElement>(container, "Name");
      void act(() => {
        nameInput.value = "brand_new";
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const form = container.querySelector("form")!;
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(captured).toBeTruthy();
      const parsed = roleCreateSchema.parse(captured!.body);
      expect(parsed.name).toBe("brand_new");
      expect(onNavigate).toHaveBeenCalledWith("role-new");
    });

    it("redirects away from the create view when the caller cannot create roles", () => {
      const onNavigate = vi.fn();
      mount(<Roles canGrant={false} roleSegment="new" onNavigate={onNavigate} />);
      expect(onNavigate).toHaveBeenCalledWith();
    });

    it("shows a role's detail with its assignees and posts an assignment through the canonical endpoint", async () => {
      let assignBody: { body: unknown } | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            location.origin,
          );
          if (
            url.pathname === `/api/v1/roles/${ROLE.id}` &&
            (!init || init.method === undefined || init.method === "GET")
          ) {
            return json({ role: ROLE });
          }
          if (url.pathname === `/api/v1/roles/${ROLE.id}/assignments`) {
            return json({
              assignments: [
                {
                  userRoleId: "10000000-0000-4000-8000-000000000001",
                  userId: "20000000-0000-4000-8000-000000000001",
                  name: "Ada Lovelace",
                  email: "ada@example.test",
                  contextType: null,
                  contextId: null,
                  expiresAt: null,
                  createdAt: "2026-01-02T00:00:00.000Z",
                },
              ],
              page: { limit: 25, offset: 0, total: 1, hasMore: false },
            });
          }
          if (url.pathname === "/api/v1/permissions/subjects") {
            return json({
              users: [
                {
                  id: "30000000-0000-4000-8000-000000000001",
                  email: "grace@example.test",
                  first_name: "Grace",
                  last_name: "Hopper",
                  organization_name: null,
                },
              ],
              page: { limit: 8, offset: 0, total: 1, hasMore: false },
            });
          }
          if (url.pathname === "/api/v1/users/30000000-0000-4000-8000-000000000001/roles" && init?.method === "POST") {
            assignBody = { body: JSON.parse(init.body as string) };
            return json({
              role: {
                id: "40000000-0000-4000-8000-000000000001",
                userId: "30000000-0000-4000-8000-000000000001",
                roleId: ROLE.id,
                roleName: ROLE.name,
                contextType: null,
                contextId: null,
                expiresAt: null,
                createdAt: "2026-01-03T00:00:00.000Z",
              },
            });
          }
          throw new Error(`Unexpected request: ${url.pathname} ${init?.method ?? "GET"}`);
        }),
      );

      const onNavigate = vi.fn();
      const container = mount(<Roles canGrant canRevoke roleSegment={ROLE.id} onNavigate={onNavigate} />);
      await settle();
      await settle();

      expect(container.textContent).toContain("custom_reviewer");
      expect(container.textContent).toContain("Ada Lovelace");
      expect(container.textContent).toContain("ada@example.test");

      // UserPicker debounces its search by 250ms (see assets/ts/components/UserPicker.tsx);
      // advance fake timers past it rather than racing a real one.
      vi.useFakeTimers();
      const userInput = container.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
      void act(() => {
        userInput.value = "grace";
        userInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(250);
      });
      vi.useRealTimers();
      await settle();
      const graceOption = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent?.includes("grace@example.test"),
      );
      expect(graceOption).toBeTruthy();
      void act(() => graceOption!.click());

      const assignForm = Array.from(container.querySelectorAll("form")).find((f) => f.textContent?.includes("Assign"))!;
      await act(async () => {
        assignForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(assignBody).toBeTruthy();
      const parsedAssignment = userRoleAssignSchema.parse(assignBody!.body);
      expect(parsedAssignment.roleId).toBe(ROLE.id);
    });

    it("saves an edit through the shared roleUpdateSchema-shaped PATCH body", async () => {
      let patchBody: { body: unknown } | undefined;
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            location.origin,
          );
          if (url.pathname === `/api/v1/roles/${ROLE.id}` && (!init?.method || init.method === "GET")) {
            return json({ role: ROLE });
          }
          if (url.pathname === `/api/v1/roles/${ROLE.id}/assignments`) {
            return json({ assignments: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
          }
          if (url.pathname === `/api/v1/roles/${ROLE.id}` && init?.method === "PATCH") {
            patchBody = { body: JSON.parse(init.body as string) };
            return json({
              role: { ...ROLE, description: "Updated description", updatedAt: "2026-01-04T00:00:00.000Z" },
            });
          }
          throw new Error(`Unexpected request: ${url.pathname} ${init?.method ?? "GET"}`);
        }),
      );

      const container = mount(<Roles canGrant canRevoke roleSegment={ROLE.id} onNavigate={vi.fn()} />);
      await settle();

      const editButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent === "Edit",
      )!;
      void act(() => editButton.click());

      // Reached through the `for`/`id` pair the Field emits rather than a
      // hand-written id, so the lookup fails exactly when the label stops
      // naming its control.
      const descriptionInput = controlFor(container, "Description");
      void act(() => {
        descriptionInput.value = "Updated description";
        descriptionInput.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const saveForm = Array.from(container.querySelectorAll("form")).find((f) =>
        f.textContent?.includes("Save changes"),
      )!;
      await act(async () => {
        saveForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      expect(patchBody).toBeTruthy();
      const parsed = roleUpdateSchema.parse(patchBody!.body);
      expect(parsed.revision).toBe(ROLE.updatedAt);
      expect(parsed.description).toBe("Updated description");
    });

    it("keeps a refused edit on screen beside the form instead of a toast that fades", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            location.origin,
          );
          if (url.pathname === `/api/v1/roles/${ROLE.id}` && init?.method === "PATCH") {
            return new Response(
              JSON.stringify({ error: { code: "CONFLICT", message: "Someone else changed this role." } }),
              { status: 409, headers: { "content-type": "application/json" } },
            );
          }
          if (url.pathname === `/api/v1/roles/${ROLE.id}/assignments`) {
            return json({ assignments: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
          }
          return json({ role: ROLE });
        }),
      );

      const container = mount(<Roles canGrant canRevoke roleSegment={ROLE.id} onNavigate={vi.fn()} />);
      await settle();
      void act(() =>
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent === "Edit")!
          .click(),
      );

      // The name is required, so the form refuses to submit an empty one
      // before it ever reaches the server.
      const name = controlFor(container, "Name");
      expect(name.required).toBe(true);
      const describedBy = name.getAttribute("aria-describedby");
      expect(container.querySelector(`[id="${describedBy!}"]`)?.textContent).toContain("must start with a letter");

      const saveForm = Array.from(container.querySelectorAll("form")).find((form) =>
        form.textContent?.includes("Save changes"),
      )!;
      await act(async () => {
        saveForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });

      // The failure is announced and stays put; the editor keeps the values
      // that were rejected rather than closing over them.
      const alert = container.querySelector('[role="alert"]');
      expect(alert?.textContent).toContain("Someone else changed this role.");
      expect(controlFor(container, "Name").value).toBe(ROLE.name);
    });

    it("surfaces a load error for an unknown role instead of a blank detail", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Role not found" } }), {
              status: 404,
              headers: { "content-type": "application/json" },
            }),
        ),
      );
      const container = mount(<Roles canGrant canRevoke roleSegment="missing-role" onNavigate={vi.fn()} />);
      await settle();
      expect(container.textContent).toContain("Role not found");
    });
  });

  it("renames the former staff tab to People without touching the underlying schema field", () => {
    const container = mount(<UserRoles canGrant={false} canRevoke={false} />);
    expect(container.textContent).toContain("People");
    expect(container.textContent).not.toContain("Staff management");
    expect(container.textContent).not.toContain("Assign");
  });

  it("only deletes a role through the confirm dialog when the deletion is confirmed", async () => {
    const requests: Array<{ method: string; pathname: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init?.method ?? "GET";
        requests.push({ method, pathname: url.pathname });
        if (url.pathname === `/api/v1/roles/${ROLE.id}` && method === "DELETE") return json({ success: true });
        if (url.pathname === "/api/v1/roles") {
          return json({ roles: [ROLE], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const container = mount(
      <>
        <ConfirmDialogHost />
        <RoleList canGrant canRevoke onOpenRole={vi.fn()} onCreateNew={vi.fn()} />
      </>,
    );
    await settle();

    function openRowMenuAndSelectDelete() {
      const trigger = container.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!;
      void act(() => trigger.click());
      void act(() => buttonNamed(container, "Delete role").click());
    }

    // Cancel: the confirm dialog names the role, but dismissing it must not delete it.
    openRowMenuAndSelectDelete();
    expect(container.textContent).toContain('Delete the role "custom_reviewer"?');
    void act(() => buttonNamed(container, "Cancel").click());
    await settle();
    expect(requests.some((r) => r.method === "DELETE")).toBe(false);

    // Confirm: the dialog's own "Delete role" button deletes it through the canonical route.
    openRowMenuAndSelectDelete();
    void act(() => buttonNamed(container, "Delete role").click());
    await settle();
    const deleteRequest = requests.find((r) => r.method === "DELETE");
    expect(deleteRequest?.pathname).toBe(`/api/v1/roles/${ROLE.id}`);
  });
});
