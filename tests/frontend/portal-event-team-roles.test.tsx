// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventTeamRoleCreateSchema,
  eventTeamRoleCreateResponseSchema,
  eventTeamRosterResponseSchema,
} from "../../assets/shared/schemas/event-team";
import { EventTeamSettings } from "../../assets/ts/member-flows/portal/sections/events/detail/settings/EventTeamSettings";
const navigate = vi.fn();
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", navigate] }));
const USER_ID = "10000000-0000-4000-8000-000000000002";
const ROLE_ID = "10000000-0000-4000-8000-000000000001";
const person = {
  userId: USER_ID,
  firstName: "Ada",
  lastName: "Lovelace",
  headshotUrl: null,
  accessRoles: [{ id: ROLE_ID, role: "moderator", expiresAt: null, createdAt: "2026-10-12T12:00:00.000Z" }],
  staffing: null,
  duties: [],
};
let container: HTMLElement;
const requests: Array<{ url: string; method: string; body?: unknown }> = [];
function setup(people: unknown[] = [person]) {
  requests.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init: RequestInit = {}) => {
      requests.push({
        url: String(input),
        method: init.method ?? "GET",
        body: typeof init.body === "string" ? JSON.parse(init.body) : undefined,
      });
      const data =
        init.method === "POST"
          ? eventTeamRoleCreateResponseSchema.parse({
              role: {
                id: ROLE_ID,
                userId: USER_ID,
                userEmail: "ada@example.test",
                userFirstName: "Ada",
                userLastName: "Lovelace",
                headshotUrl: null,
                role: "organizer",
                grantedByUserId: null,
                granterEmail: null,
                createdAt: "2026-10-12T12:00:00.000Z",
                expiresAt: null,
              },
            })
          : eventTeamRosterResponseSchema.parse({
              people,
              page: { limit: 50, offset: 0, total: people.length, hasMore: false },
            });
      return new Response(JSON.stringify(data), { headers: { "content-type": "application/json" } });
    }),
  );
  container = document.createElement("div");
  document.body.append(container);
}
async function mount(props: Partial<Parameters<typeof EventTeamSettings>[0]> = {}) {
  await act(async () =>
    render(
      <EventTeamSettings
        slug="workshop"
        teamPath="/events/workshop/settings/team"
        timeZone="Europe/Amsterdam"
        canManage
        canEditStaffing={false}
        {...props}
      />,
      container,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
afterEach(() => {
  if (container) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe("one event team roster", () => {
  it("uses one searchable person roster without email or separate staffing navigation", async () => {
    setup();
    await mount({ canReadStaffing: true });
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.querySelectorAll("table")).toHaveLength(1);
    expect(container.querySelector('input[placeholder="Search people…"]')).not.toBeNull();
    expect(container.querySelector("h2,h3")).toBeNull();
    expect(container.textContent).not.toMatch(/@|Back to|Add eligible|Access roles/);
    const create = container.querySelector<HTMLButtonElement>('button[aria-label="Add team member"]');
    expect(create).not.toBeNull();
    await act(async () => create!.click());
    expect(navigate).toHaveBeenCalledWith("/events/workshop/settings/team/new");
  });
  it("handles an empty roster without an error", async () => {
    setup([]);
    await mount();
    expect(container.textContent).toContain("No team members yet");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("opens a person read-only and hides scheduling actions without that permission", async () => {
    setup();
    await mount({ section: USER_ID });
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("Moderator");
    expect(container.textContent).not.toContain("Scheduling duties");
    expect(requests[0]?.url).toContain(`userId=${USER_ID}`);
    expect(requests.every((request) => request.method === "GET")).toBe(true);
  });
  it("rejects direct staffing edit navigation when staffing write is unavailable", async () => {
    setup();
    await mount({ section: USER_ID, personId: "edit", canReadStaffing: true });
    expect(container.textContent).toContain("Editing scheduling duties is not available");
    expect(container.querySelector("form")).toBeNull();
    expect(requests.some((request) => request.url.endsWith("/agenda"))).toBe(false);
  });
  it("grants access explicitly to the selected person with the canonical contract", async () => {
    setup();
    await mount({ section: USER_ID, personId: "access" });
    const form = container.querySelector("form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const request = requests.find((request) => request.method === "POST");
    expect(request).toBeDefined();
    expect(eventTeamRoleCreateSchema.parse(request!.body)).toMatchObject({ userId: USER_ID, role: "organizer" });
    expect(request!.url).toContain("/roles");
  });
});
