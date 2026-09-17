// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventTeamRoleCreateResponseSchema,
  eventTeamRoleCreateSchema,
  eventTeamRolesResponseSchema,
} from "../../assets/shared/schemas/event-team";
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { Team } from "../../assets/ts/member-flows/portal/sections/events/detail/Team";
import { rowActionControlNames, runRowAction } from "./helpers/row-actions";

/*
 * The surface addresses its own add page, so it reads the portal's location
 * hook. The hook is wouter's, which is React's under preact/compat and has no
 * dispatcher in a bare mount — the same mock every other surface test that
 * navigates uses.
 */
const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

const ROLE_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "10000000-0000-4000-8000-000000000002";
const GRANTER_ID = "10000000-0000-4000-8000-000000000003";
/** The person the add page finds through the user picker. */
const CANDIDATE = {
  id: "10000000-0000-4000-8000-000000000006",
  email: "organizer@example.test",
  first_name: "Olive",
  last_name: "Organizer",
  organization_name: null,
};
const mounted: HTMLElement[] = [];

interface CapturedRequest {
  path: string;
  method: string;
  body?: unknown;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function roleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: ROLE_ID,
    userEmail: "moderator@example.test",
    userId: USER_ID,
    userFirstName: null,
    userLastName: null,
    headshotUrl: null,
    role: "moderator",
    grantedByUserId: GRANTER_ID,
    expiresAt: null,
    createdAt: "2026-08-29T10:00:00.000Z",
    granterEmail: "organizer@example.test",
    ...overrides,
  };
}

function rolesResponse(roles: Array<Record<string, unknown>> = [roleRow()]) {
  return eventTeamRolesResponseSchema.parse({
    roles,
    page: { limit: 100, offset: 0, total: roles.length, hasMore: false },
  });
}

/**
 * The surface's transport, recorded. `post` lets a test decide what the
 * assignment endpoint answers with, which is the only thing that differs
 * between the success and the failure paths.
 */
function stubFetch({
  roles = rolesResponse(),
  post = () =>
    json(
      eventTeamRoleCreateResponseSchema.parse({
        role: { ...roleRow(), id: "10000000-0000-4000-8000-000000000004", userEmail: "organizer@example.test" },
      }),
      201,
    ),
}: {
  roles?: ReturnType<typeof rolesResponse>;
  post?: () => Response;
} = {}): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      const method = init.method ?? "GET";
      const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
      requests.push({ path: url.pathname, method, body });
      if (method === "POST") return Promise.resolve(post());
      if (method === "DELETE") return Promise.resolve(json({ success: true }));
      if (url.pathname === "/api/v1/users") {
        return Promise.resolve(json({ users: [CANDIDATE], page: { limit: 8, offset: 0, total: 1, hasMore: false } }));
      }
      return Promise.resolve(json(roles));
    }),
  );
  return requests;
}

function mount(teamSegment?: string): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() =>
    render(
      <>
        <ConfirmDialogHost />
        <Team slug="architecture-workshop" teamSegment={teamSegment} />
      </>,
      container,
    ),
  );
  return container;
}

function buttonNamed(container: HTMLElement, label: string): HTMLButtonElement {
  const button = [...container.querySelectorAll("button")].find((candidate) => candidate.textContent === label);
  if (!button) throw new Error(`missing button: ${label}`);
  return button;
}

function labelFor(container: HTMLElement, text: string): HTMLLabelElement {
  const label = [...container.querySelectorAll("label")].find((candidate) => candidate.textContent?.startsWith(text));
  if (!label) throw new Error(`missing label: ${text}`);
  return label;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/**
 * Adding is a page of its own, under the reserved `new` segment: the action
 * on the list navigates rather than unfolding a panel, so a test that wants
 * the form mounts the page.
 */
async function openAddForm(container: HTMLElement): Promise<HTMLElement> {
  await act(async () => buttonNamed(container, "Add team member").click());
  const page = mount("new");
  await settle();
  return page;
}

/** Drives the debounced user picker to the candidate, as a reader would. */
async function pickPerson(container: HTMLElement): Promise<void> {
  vi.useFakeTimers();
  const search = container.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
  void act(() => {
    search.value = "olive";
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
  if (!option) throw new Error("the user picker offered no match");
  await act(async () => option.click());
}

async function submitAddForm(container: HTMLElement): Promise<void> {
  await act(async () => {
    container
      .querySelector<HTMLFormElement>("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await settle();
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event team role management", () => {
  it("lists, assigns, and revokes roles through the canonical event resource", async () => {
    const requests = stubFetch();

    const container = mount();
    await settle();
    await settle();

    expect(requests[0]).toMatchObject({ path: "/api/v1/events/architecture-workshop/roles", method: "GET" });
    expect(container.textContent).toContain("moderator@example.test");
    expect(container.textContent).toContain("Moderator");
    expect(requests.some(({ path }) => path.includes("/api/v1/admin/"))).toBe(false);

    // One action, so the row shows it — named after the team member it would
    // remove, since every row's action reads "Revoke".
    expect(rowActionControlNames(container)).toEqual(["Actions for moderator@example.test"]);
    await runRowAction(container, "moderator@example.test", "Revoke");

    const dialog = container.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Revoke the Moderator role from moderator@example.test?");
    expect(dialog?.textContent).toContain("moderator@example.test loses moderator access to this event");

    await act(async () => {
      buttonNamed(container, "Revoke role").click();
    });
    await settle();

    expect(requests.find(({ method }) => method === "DELETE")).toEqual({
      path: `/api/v1/events/architecture-workshop/roles/${ROLE_ID}`,
      method: "DELETE",
      body: undefined,
    });

    expect(container.querySelector("form")).toBeNull();
    const addPage = await openAddForm(container);
    // Nothing leads back to the list but the breadcrumb and Cancel: the tab
    // above already is the list (#88).
    expect([...addPage.querySelectorAll("button")].some((b) => b.textContent?.includes("All team members"))).toBe(
      false,
    );

    // A team member is an existing person, found with the picker (#88); the
    // page has no address field to type an unknown person into.
    expect(addPage.querySelector('input[type="email"]')).toBeNull();
    await pickPerson(addPage);
    const role = addPage.querySelector<HTMLSelectElement>("select")!;
    await act(async () => {
      role.value = "organizer";
      role.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await submitAddForm(addPage);

    const posted = requests.find(({ method }) => method === "POST");
    expect(posted?.path).toBe("/api/v1/events/architecture-workshop/roles");
    // The body is checked against the endpoint's own request contract rather
    // than a literal, so a schema change cannot leave this asserting a shape
    // the server no longer accepts.
    expect(eventTeamRoleCreateSchema.parse(posted?.body)).toEqual({
      userId: CANDIDATE.id,
      role: "organizer",
    });

    // A successful assignment returns to the list, which is an address rather
    // than the disappearance of a layer.
    expect(navigate).toHaveBeenCalledWith("/events/architecture-workshop/settings/team");
  });

  it("names its table and pairs every control with its label", async () => {
    stubFetch();
    const container = mount();
    await settle();
    await settle();

    // Four unnamed tables on a page are announced as four tables.
    expect(container.querySelector("caption")?.textContent).toBe("Event team members");

    const addPage = await openAddForm(container);

    const form = addPage.querySelector<HTMLFormElement>("form")!;
    expect(form.getAttribute("aria-label")).toBe("Add team member");

    const person = addPage.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
    expect(person.id).not.toBe("");
    expect(labelFor(addPage, "Person").getAttribute("for")).toBe(person.id);
    expect(person.required).toBe(true);

    const role = addPage.querySelector<HTMLSelectElement>("select")!;
    expect(labelFor(addPage, "Role").getAttribute("for")).toBe(role.id);

    // The optional expiry explains itself through a described-by relationship
    // rather than a floating paragraph nothing points at.
    const expires = addPage.querySelector<HTMLInputElement>('input[type="datetime-local"]')!;
    expect(labelFor(addPage, "Expires").getAttribute("for")).toBe(expires.id);
    const helpId = expires.getAttribute("aria-describedby");
    expect(helpId).toBeTruthy();
    expect(addPage.querySelector(`#${helpId!}`)?.textContent).toContain("never expires");
  });

  it("keeps the form open and announces the reason when an assignment is rejected", async () => {
    const requests = stubFetch({
      post: () =>
        json({ error: { code: "ROLE_ALREADY_ASSIGNED", message: "That person already holds this role." } }, 409),
    });

    const container = mount();
    await settle();
    await settle();
    const addPage = await openAddForm(container);
    // From here on, any navigation is the submit's own.
    navigate.mockClear();

    await pickPerson(addPage);
    await submitAddForm(addPage);

    expect(requests.some(({ method }) => method === "POST")).toBe(true);

    const alert = addPage.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("That person already holds this role.");

    // The page survives the failure with the picked person intact, so the fix
    // is one edit away rather than a re-entry from scratch — and the reader is
    // not sent back to the list with nothing to correct.
    const stillThere = addPage.querySelector<HTMLInputElement>('input[placeholder="Search by email or name…"]')!;
    expect(stillThere.value).toBe(CANDIDATE.email);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("says in words that an assignment has run out, not only in colour", async () => {
    stubFetch({
      roles: rolesResponse([
        roleRow({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        roleRow({
          id: "10000000-0000-4000-8000-000000000005",
          userEmail: "volunteer@example.test",
          role: "volunteer",
          expiresAt: "2099-01-01T00:00:00.000Z",
        }),
      ]),
    });

    const container = mount();
    await settle();
    await settle();

    const rows = [...container.querySelectorAll("tbody tr")];
    const expiredRow = rows.find((row) => row.textContent?.includes("moderator@example.test"));
    const currentRow = rows.find((row) => row.textContent?.includes("volunteer@example.test"));
    expect(expiredRow?.textContent).toContain("Expired");
    expect(currentRow?.textContent).not.toContain("Expired");
  });
});
