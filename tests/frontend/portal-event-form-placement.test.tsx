// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { GroupEventDetail } from "../../assets/ts/member-flows/portal/sections/management/GroupEventDetail";
import { EventFormPlacementEditor } from "../../assets/ts/member-flows/portal/sections/management/EventFormPlacementEditor";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const FORM_ID = "30000000-0000-4000-8000-000000000001";
const PLACEMENT_ID = "40000000-0000-4000-8000-000000000001";
const NOW = "2026-08-01T00:00:00.000Z";
const NEXT = "2026-08-01T00:00:01.000Z";
const mounted: HTMLElement[] = [];

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
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

function eventForm(purpose: "event_registration" | "proposal_submission", attached = true) {
  return {
    eventUpdatedAt: attached ? NOW : NEXT,
    purpose,
    form: attached
      ? {
          placement: {
            id: PLACEMENT_ID,
            formId: FORM_ID,
            ownerGroupId: GROUP_ID,
            contextType: "event",
            contextRef: EVENT_ID,
            audience: purpose === "event_registration" ? "attendee" : "speaker",
            active: true,
            opensAt: null,
            closesAt: null,
            createdAt: NOW,
            updatedAt: NOW,
          },
          form: { id: FORM_ID, key: "event-form", title: "Event form", description: "Questions" },
        }
      : null,
  };
}

function availableForms() {
  return {
    forms: [
      { id: FORM_ID, key: "event-form", title: "Event form", description: "Questions", updatedAt: NOW },
      {
        id: "30000000-0000-4000-8000-000000000002",
        key: "other-form",
        title: "Other form",
        description: null,
        updatedAt: NOW,
      },
    ],
    page: { limit: 25, offset: 0, total: 2, count: 2, hasMore: false },
  };
}

function definition(purpose: "event_registration" | "proposal_submission") {
  return {
    form: {
      id: FORM_ID,
      key: "event-form",
      purpose,
      status: "active",
      title: "Event form",
      description: "Questions",
      updatedAt: NOW,
    },
    placement: {
      ...eventForm(purpose).form!.placement,
      audience: purpose === "event_registration" ? "attendee" : "speaker",
    },
    capabilities: ["view_definition", "manage"],
    acceptingResponses: true,
    fields: [],
  };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal event form placement management", () => {
  it("selects an available form through the server-backed catalog", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ path: url.pathname, method, body });
        if (url.pathname.endsWith("/available")) return json(availableForms());
        if (method === "PUT") return json(eventForm("proposal_submission"));
        return json(eventForm("proposal_submission", false));
      }),
    );

    const container = mount(
      <EventFormPlacementEditor
        groupId={GROUP_ID}
        eventId={EVENT_ID}
        purpose="proposal_submission"
        expectedUpdatedAt={NOW}
        onRevision={() => undefined}
      />,
    );
    await settle();
    await settle();
    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Proposal submission questions"]')!;
    expect(select.querySelectorAll("option")).toHaveLength(3);
    select.value = "30000000-0000-4000-8000-000000000002";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await act(async () => container.querySelector<HTMLButtonElement>("button.btn-success")!.click());
    await settle();
    expect(requests.find(({ method }) => method === "PUT")).toMatchObject({
      path: `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/forms/proposal_submission`,
      body: {
        expectedUpdatedAt: NOW,
        formId: "30000000-0000-4000-8000-000000000002",
      },
    });
  });

  it("uses the purpose-specific canonical route for listing, selecting, and clearing forms", async () => {
    const requests: Array<{ path: string; method: string; body?: unknown }> = [];
    let attached = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ path: url.pathname, method, body });
        if (url.pathname.endsWith("/available")) return json(availableForms());
        if (method === "PUT") {
          attached = body?.formId !== null;
          return json(eventForm("event_registration", attached));
        }
        return json(eventForm("event_registration", attached));
      }),
    );

    const onRevision = vi.fn();
    const container = mount(
      <EventFormPlacementEditor
        groupId={GROUP_ID}
        eventId={EVENT_ID}
        purpose="event_registration"
        expectedUpdatedAt={NOW}
        onRevision={onRevision}
      />,
    );
    await settle();
    expect(requests[0]).toMatchObject({
      path: `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/forms/event_registration`,
      method: "GET",
    });
    expect(requests.some(({ path }) => path.endsWith("/registration-settings"))).toBe(false);
    expect(requests.some(({ path }) => path.startsWith("/api/v1/admin"))).toBe(false);

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Registration questions"]')!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await settle();
    await act(async () => container.querySelector<HTMLButtonElement>("button.btn-success")!.click());
    await settle();
    expect(requests.find(({ method }) => method === "PUT")).toMatchObject({
      path: `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/forms/event_registration`,
      body: { expectedUpdatedAt: NOW, formId: null },
    });
    expect(onRevision).toHaveBeenCalledWith(NEXT);
  });

  it("uses the same lifecycle for proposal forms, including create and definition editing", async () => {
    const requests: Array<{ path: string; method: string; body?: Record<string, unknown> }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
        requests.push({ path: url.pathname, method, body });
        if (url.pathname.endsWith("/available")) return json(availableForms());
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/forms/${PLACEMENT_ID}`)
          return json(definition("proposal_submission"));
        if (method === "POST") {
          return json(
            {
              ...eventForm("proposal_submission", true),
              purpose: "proposal_submission",
              form: {
                ...eventForm("proposal_submission", true).form,
                form: {
                  id: FORM_ID,
                  key: "proposal-form",
                  title: "Proposal form",
                  description: null,
                },
              },
            },
            201,
          );
        }
        return json(eventForm("proposal_submission", true));
      }),
    );

    const container = mount(
      <EventFormPlacementEditor
        groupId={GROUP_ID}
        eventId={EVENT_ID}
        purpose="proposal_submission"
        expectedUpdatedAt={NOW}
        onRevision={vi.fn()}
      />,
    );
    await settle();
    expect(container.textContent).toContain("Proposal submission questions");
    expect(container.querySelector('select[aria-label="Proposal submission questions"]')).not.toBeNull();

    await act(async () => container.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!.click());
    await settle();
    const editor = Array.from(container.querySelectorAll<HTMLElement>(".card")).find((card) =>
      card.textContent?.includes("New proposal submission form"),
    );
    expect(editor).toBeDefined();
    const inputs = editor!.querySelectorAll<HTMLInputElement>(".row.g-2.mb-3 input");
    inputs[0].value = "proposal-form";
    inputs[0].dispatchEvent(new InputEvent("input", { bubbles: true }));
    inputs[1].value = "Proposal form";
    inputs[1].dispatchEvent(new InputEvent("input", { bubbles: true }));
    await settle();
    await act(async () => {
      editor!
        .querySelector<HTMLFormElement>("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(requests.find(({ method }) => method === "POST")).toMatchObject({
      path: `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/forms/proposal_submission`,
      body: {
        expectedUpdatedAt: NOW,
        definition: { key: "proposal-form", title: "Proposal form", status: "active" },
      },
    });

    const edit = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Edit attached form",
    );
    expect(edit).not.toBeNull();
    await act(async () => edit!.click());
    await settle();
    expect(requests).toContainEqual({
      path: `/api/v1/groups/${GROUP_ID}/forms/${PLACEMENT_ID}`,
      method: "GET",
    });
    expect(container.textContent).toContain("Edit proposal submission form");
  });

  it("exposes event-form configuration only to event managers, not proposal reviewers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const path = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        ).pathname;
        if (path.endsWith("/terms"))
          return json({ eventUpdatedAt: NOW, terms: { attendee: [], speaker: [], presentation: [] } });
        if (path.endsWith("/days")) return json({ eventUpdatedAt: NOW, days: [] });
        if (path.endsWith("/registration-settings"))
          return json({ eventUpdatedAt: NOW, registrationPolicy: "no_registration", form: null });
        if (path.includes("/forms/proposal_submission")) return json(eventForm("proposal_submission", false));
        if (path.includes("/forms/event_registration")) return json(eventForm("event_registration", false));
        throw new Error(`Unexpected request ${path}`);
      }),
    );
    const event: GroupEvent = {
      id: EVENT_ID,
      ownerGroupId: GROUP_ID,
      seriesId: null,
      slug: "event",
      basePath: null,
      name: "Managed event",
      timezone: "Europe/Amsterdam",
      startsAt: NOW,
      endsAt: NEXT,
      profileKey: "workshop",
      sourceMode: "portal",
      registrationPolicy: "no_registration",
      visibility: "group_members",
      inviteLimitAttendee: 5,
      location: null,
      links: [],
      nextOccurrenceAt: NOW,
      updatedAt: NOW,
      proposalAccess: null,
      capabilities: ["view", "manage"],
    };
    const manager = mount(<GroupEventDetail event={event} groupId={GROUP_ID} />);
    await settle();
    expect(manager.textContent).toContain("Proposal submission questions");
    const reviewer = mount(<GroupEventDetail event={{ ...event, capabilities: ["view"] }} groupId={GROUP_ID} />);
    await settle();
    expect(reviewer.textContent).not.toContain("Proposal submission questions");
    expect(reviewer.textContent).not.toContain("Registration setup");
  });
});
