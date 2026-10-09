// @vitest-environment jsdom
/**
 * The access-control commands that act on a record already on screen —
 * revoke a grant, unassign a role, scope an assignment to an event — through
 * the canonical routes. The list and form surfaces themselves are covered in
 * portal-access-control-surfaces.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { Grants } from "../../assets/ts/member-flows/portal/sections/access-control/Grants";
import { RoleAssignForm } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleAssignForm";
import { RoleDetail } from "../../assets/ts/member-flows/portal/sections/access-control/roles/RoleDetail";
import { userRoleAssignSchema } from "../../assets/shared/schemas/access-control";
import {
  ASSIGNMENT,
  CANDIDATE,
  GRANT,
  json,
  pathOf,
  pickCandidate,
  ROLE,
  settle,
} from "./helpers/access-control-fixtures";
import { confirmationButton } from "./helpers/confirm-dialog";
import { chooseComboboxOption, chooseOption, controlFor } from "./helpers/labelled-control";
import { runRowAction } from "./helpers/row-actions";

const EVENT_TARGET = { id: "event-meeting-1", type: "event", name: "PQC Conference 2026" };

const mounted: HTMLElement[] = [];

function mount(node: preact.ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

/** Stubs `fetch` with `answer`, recording every request it receives. */
function stubApi(answer: (path: string, method: string) => Response) {
  const requests: Array<{ method: string; path: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = pathOf(input);
      const method = init?.method ?? "GET";
      requests.push({ method, path, body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined });
      return answer(path, method);
    }),
  );
  return requests;
}

function deletions(requests: Array<{ method: string; path: string }>): string[] {
  return requests.filter((request) => request.method === "DELETE").map((request) => request.path);
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("revoking a grant", () => {
  it("revokes only after the named confirmation, through the canonical route, then reloads the list", async () => {
    const requests = stubApi((path, method) => {
      if (path === "/api/v1/permissions/grants" && method === "GET") {
        return json({ grants: [GRANT], page: { limit: 50, offset: 0, total: 1, hasMore: false } });
      }
      if (path === `/api/v1/permissions/grants/${GRANT.id}` && method === "DELETE") return json({ success: true });
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const container = mount(
      <>
        <ConfirmDialogHost />
        <Grants canGrant canRevoke onNavigate={() => {}} />
      </>,
    );
    await settle();

    await runRowAction(container, `${GRANT.permission} granted to ${GRANT.userEmail}`, "Revoke grant");
    expect(container.textContent).toContain(`Revoke the "${GRANT.permission}" grant from ${GRANT.userEmail}?`);
    expect(deletions(requests)).toEqual([]);

    await act(() => confirmationButton("Revoke grant", container)?.click());
    await settle();

    expect(deletions(requests)).toEqual([`/api/v1/permissions/grants/${GRANT.id}`]);
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(2);
  });
});

describe("assigning and unassigning a role", () => {
  it("unassigns a person only after the named confirmation, through the user's own role route", async () => {
    const requests = stubApi((path, method) => {
      if (path === `/api/v1/roles/${ROLE.id}`) return json({ role: ROLE });
      if (path === `/api/v1/roles/${ROLE.id}/assignments`) {
        return json({ assignments: [ASSIGNMENT], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
      }
      if (path === `/api/v1/users/${ASSIGNMENT.userId}/roles/${ASSIGNMENT.userRoleId}` && method === "DELETE") {
        return json({ success: true });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const container = mount(
      <>
        <ConfirmDialogHost />
        <RoleDetail roleId={ROLE.id} canGrant canRevoke />
      </>,
    );
    await settle();
    await settle();

    await runRowAction(container, ASSIGNMENT.name, "Unassign role");
    expect(container.textContent).toContain(`Remove this role from ${ASSIGNMENT.name}?`);
    expect(deletions(requests)).toEqual([]);

    await act(() => confirmationButton("Unassign role", container)?.click());
    await settle();

    expect(deletions(requests)).toEqual([`/api/v1/users/${ASSIGNMENT.userId}/roles/${ASSIGNMENT.userRoleId}`]);
  });

  it("scopes an assignment to the event the reader picks from the event catalog", async () => {
    const requests = stubApi((path, method) => {
      if (path === "/api/v1/permissions/subjects") {
        return json({ users: [CANDIDATE], page: { limit: 8, offset: 0, total: 1, hasMore: false } });
      }
      if (path === "/api/v1/permissions/targets") {
        return json({ targets: [EVENT_TARGET], page: { limit: 25, offset: 0, total: 1, hasMore: false } });
      }
      if (path === `/api/v1/users/${CANDIDATE.id}/roles` && method === "POST") {
        return json({
          role: {
            ...ASSIGNMENT,
            id: ASSIGNMENT.userRoleId,
            roleId: ROLE.id,
            roleName: ROLE.name,
            userId: CANDIDATE.id,
            contextType: "event",
            contextId: EVENT_TARGET.id,
          },
        });
      }
      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    const onAssigned = vi.fn();
    const container = mount(<RoleAssignForm roleId={ROLE.id} onAssigned={onAssigned} />);
    await pickCandidate(container);

    await chooseOption(controlFor(container, "Target"), "event");
    await settle();
    await chooseComboboxOption(container, "Event", EVENT_TARGET.id);
    await act(async () => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const posted = requests.find((request) => request.method === "POST");
    const parsed = userRoleAssignSchema.parse(posted?.body);
    expect(parsed.contextType).toBe("event");
    expect(parsed.contextId).toBe(EVENT_TARGET.id);
    expect(onAssigned).toHaveBeenCalledTimes(1);
  });
});
