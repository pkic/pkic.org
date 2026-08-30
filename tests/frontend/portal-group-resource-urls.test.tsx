// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupEvents } from "../../assets/ts/member-flows/portal/sections/management/GroupEvents";
import { GroupForms } from "../../assets/ts/member-flows/portal/sections/management/GroupForms";

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
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
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
});

describe("URL-addressed group sub-resources", () => {
  it("opens an event's detail from its URL-addressed initial event and reports a failed detail fetch", async () => {
    const eventId = "architecture-workshop";
    const page = { limit: 50, offset: 0, total: 1, hasMore: false };
    const event = {
      id: eventId,
      ownerGroupId: GROUP_ID,
      seriesId: null,
      slug: eventId,
      basePath: `/events/2026/${eventId}/`,
      name: "Architecture workshop",
      timezone: "Europe/Amsterdam",
      startsAt: "2026-09-01T15:00:00.000Z",
      endsAt: "2026-09-01T16:00:00.000Z",
      profileKey: "workshop",
      sourceMode: "portal",
      registrationPolicy: "no_registration",
      visibility: "group_members",
      inviteLimitAttendee: 0,
      location: "Online",
      links: [],
      nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z",
      capabilities: ["view"],
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/events")) return json({ events: [event], page });
        if (url.pathname.endsWith(`/events/${eventId}`)) {
          return new Response(JSON.stringify({ message: "Not allowed" }), { status: 403 });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = mount(<GroupEvents groupId={GROUP_ID} initialEventId={eventId} />);
    await settle();

    expect(container.textContent).toContain("HTTP 403");
  });

  it("navigates to and from a form placement's canonical URL and reports its detail load", async () => {
    const placementId = "80000000-0000-4000-8000-000000000002";
    const formId = "80000000-0000-4000-8000-000000000001";
    const page = { limit: 50, offset: 0, total: 1, hasMore: false };
    const row = {
      form: {
        id: formId,
        key: "architecture-survey",
        purpose: "survey",
        status: "active",
        title: "Architecture survey",
        description: "Collect group priorities.",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      placement: {
        id: placementId,
        formId,
        ownerGroupId: GROUP_ID,
        contextType: "group",
        contextRef: GROUP_ID,
        audience: "group_members",
        active: true,
        opensAt: null,
        closesAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      capabilities: ["view_definition", "submit"],
      acceptingResponses: true,
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/forms")) return json({ forms: [row], page });
        if (url.pathname.endsWith(`/forms/${placementId}`)) {
          return json({
            form: row.form,
            placement: row.placement,
            fields: [],
            capabilities: row.capabilities,
            acceptingResponses: row.acceptingResponses,
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = mount(<GroupForms groupId={GROUP_ID} canManage={false} />);
    await settle();
    const details = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Details");
    await act(async () => {
      details?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(container.textContent).toContain("Architecture survey");
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/forms/${placementId}`);

    const hide = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Hide");
    await act(async () => {
      hide?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/forms`);
  });

  it("opens a form placement from its URL-addressed initial placement and reports a failed detail fetch", async () => {
    const placementId = "80000000-0000-4000-8000-000000000002";
    const page = { limit: 50, offset: 0, total: 1, hasMore: false };
    const row = {
      form: {
        id: "80000000-0000-4000-8000-000000000001",
        key: "architecture-survey",
        purpose: "survey",
        status: "active",
        title: "Architecture survey",
        description: null,
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      placement: {
        id: placementId,
        formId: "80000000-0000-4000-8000-000000000001",
        ownerGroupId: GROUP_ID,
        contextType: "group",
        contextRef: GROUP_ID,
        audience: "group_members",
        active: true,
        opensAt: null,
        closesAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      capabilities: ["view_definition"],
      acceptingResponses: false,
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/forms")) return json({ forms: [row], page });
        if (url.pathname.endsWith(`/forms/${placementId}`)) {
          return new Response(JSON.stringify({ message: "Not allowed" }), { status: 403 });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = mount(<GroupForms groupId={GROUP_ID} canManage={false} initialPlacementId={placementId} />);
    await settle();
    await settle();

    expect(container.textContent).toContain("HTTP 403");
  });

  it("threads the group form's resourceTab through GroupForms so a responses deep link opens the responses tab", async () => {
    const placementId = "80000000-0000-4000-8000-000000000002";
    const page = { limit: 50, offset: 0, total: 1, hasMore: false };
    const row = {
      form: {
        id: "80000000-0000-4000-8000-000000000001",
        key: "architecture-survey",
        purpose: "survey",
        status: "active",
        title: "Architecture survey",
        description: null,
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      placement: {
        id: placementId,
        formId: "80000000-0000-4000-8000-000000000001",
        ownerGroupId: GROUP_ID,
        contextType: "group",
        contextRef: GROUP_ID,
        audience: "group_members",
        active: true,
        opensAt: null,
        closesAt: null,
        createdAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
      capabilities: ["view_definition", "submit", "view_responses"],
      acceptingResponses: true,
    } as const;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        if (url.pathname.endsWith("/forms")) return json({ forms: [row], page });
        if (url.pathname.endsWith("/submissions")) {
          return json({ form: row.form, placement: row.placement, submissions: [], page });
        }
        if (url.pathname.endsWith(`/forms/${placementId}`)) {
          return json({
            form: row.form,
            placement: row.placement,
            fields: [],
            capabilities: row.capabilities,
            acceptingResponses: row.acceptingResponses,
          });
        }
        throw new Error(`Unexpected request: ${url.pathname}`);
      }),
    );

    const container = mount(
      <GroupForms
        groupId={GROUP_ID}
        canManage={false}
        initialPlacementId={placementId}
        initialPlacementTab="responses"
      />,
    );
    await settle();
    await settle();

    const responsesTab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (item) => item.textContent?.trim() === "Responses",
    );
    expect(responsesTab?.getAttribute("aria-selected")).toBe("true");

    const statisticsTab = Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]')).find(
      (item) => item.textContent?.trim() === "Statistics",
    )!;
    expect(statisticsTab.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/forms/${placementId}/statistics`);
    await act(async () => {
      statisticsTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/forms/${placementId}/statistics`);
  });
});
