// @vitest-environment jsdom
/**
 * The group's event list and its history panel.
 *
 * `portal-group-collections.test.tsx` covers what they load; this covers what
 * they say when a load fails, and the names each gives to a reader who cannot
 * see the layout — the row's own action, and the panel's caption.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupAuditLog } from "../../assets/ts/member-flows/portal/sections/management/GroupAuditLog";
import { GroupEvents } from "../../assets/ts/member-flows/portal/sections/management/GroupEvents";

const navigate = vi.fn();

vi.mock("wouter/use-hash-location", () => ({
  useHashLocation: () => ["", navigate],
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const mounted: HTMLElement[] = [];

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const groupEvent = {
  id: "70000000-0000-4000-8000-000000000005",
  ownerGroupId: GROUP_ID,
  seriesId: null,
  slug: "architecture-workshop",
  basePath: null,
  name: "Architecture workshop",
  timezone: "Europe/Amsterdam",
  startsAt: "2026-09-01T15:00:00.000Z",
  endsAt: "2026-09-01T16:00:00.000Z",
  profileKey: "workshop",
  sourceMode: "portal",
  registrationPolicy: "no_registration",
  visibility: "group_members",
  inviteLimitAttendee: 5,
  location: "Online",
  links: [],
  nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "manage"],
};

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  navigate.mockReset();
});

describe("group events list", () => {
  it("makes the whole row the way in, with a name that says which event it opens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(json({ events: [groupEvent], page: { limit: 50, offset: 0, total: 1, hasMore: false } })),
      ),
    );

    const container = mount(<GroupEvents groupId={GROUP_ID} canManage />);
    await settle();

    // The row used to end in a "Details" button in a nameless last column,
    // which meant every row offered a control with the same accessible name
    // and the row itself was inert.
    const controls = [...container.querySelectorAll("a, button")].map((control) => control.textContent);
    expect(controls).toContain("Open Architecture workshop");
    expect(controls).not.toContain("Details");
    expect(container.querySelector("table caption")?.textContent).toBe("Group events");
  });

  it("announces a failed event load as an alert instead of an empty list", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("events unavailable", { status: 503 }))),
    );

    const container = mount(<GroupEvents groupId={GROUP_ID} canManage />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    // The empty-state sentence would claim the group has no events, which is
    // a different and wrong thing to tell a reader about a failed request.
    expect(container.textContent).not.toContain("No events yet");
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("group history panel", () => {
  it("names the history table after the group rather than being a fourth 'Audit history'", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          json({
            auditLog: [
              {
                id: "audit-1",
                created_at: "2026-08-21T12:00:00.000Z",
                actor_type: "admin",
                actor_id: null,
                actor_display: "Group Manager",
                action: "group_updated",
                entity_type: "group",
                entity_id: GROUP_ID,
                details: null,
              },
            ],
            page: { limit: 50, offset: 0, total: 1, hasMore: false },
          }),
        ),
      ),
    );

    const container = mount(<GroupAuditLog groupId={GROUP_ID} />);
    await settle();

    expect(container.querySelector("table caption")?.textContent).toBe("Group history");
    expect(container.textContent).toContain("group_updated");
  });

  it("announces a failed history load as an alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("audit log unavailable", { status: 500 }))),
    );

    const container = mount(<GroupAuditLog groupId={GROUP_ID} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    expect(container.textContent).not.toContain("No audit log entries.");
  });
});
