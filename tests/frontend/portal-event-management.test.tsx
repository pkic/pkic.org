// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { GroupEventDetail } from "../../assets/ts/member-flows/portal/sections/management/GroupEventDetail";
import { GroupEventEditor } from "../../assets/ts/member-flows/portal/sections/management/GroupEventEditor";

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

const responseEvent: GroupEvent = {
  id: "architecture-workshop",
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
  location: "Online",
  links: ["https://example.test/architecture-workshop"],
  nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  capabilities: ["view", "manage"],
};

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal event management", () => {
  it("does not advertise registration for a no-registration event", () => {
    const container = mount(
      <GroupEventDetail
        event={{ ...responseEvent, basePath: "/events/no-registration-event/", capabilities: ["view", "register"] }}
        groupId={GROUP_ID}
      />,
    );

    expect(container.textContent).not.toContain("Open registration");
    expect(container.textContent).not.toContain("Registration is available");
  });

  it("creates and updates events through the shared group event contracts", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ url, method, body });
        if (url.pathname === `/api/v1/groups/${GROUP_ID}/events/profiles`) {
          return json({
            profiles: [
              {
                key: "conference",
                label: "D1 conference label",
                description: "Configured conference profile",
                standaloneEligible: true,
              },
              {
                key: "workshop",
                label: "D1 workshop label",
                description: "Configured workshop profile",
                standaloneEligible: true,
              },
              {
                key: "meeting",
                label: "D1 meeting label",
                description: "Series only",
                standaloneEligible: false,
              },
            ],
          });
        }
        return json({ event: responseEvent });
      }),
    );

    const onSaved = vi.fn();
    const create = mount(<GroupEventEditor groupId={GROUP_ID} event={null} onSaved={onSaved} />);
    await settle();
    expect(
      Array.from(create.querySelectorAll<HTMLSelectElement>("#group-event-profile-new option")).map(
        (option) => option.value,
      ),
    ).toEqual(["conference", "workshop"]);
    expect(create.textContent).toContain("Configured workshop profile");
    expect(create.textContent).not.toContain("D1 meeting label");

    const name = create.querySelector<HTMLInputElement>("#group-event-name-new")!;
    name.value = "Architecture workshop";
    name.dispatchEvent(new Event("input", { bubbles: true }));
    await settle();
    await act(async () => {
      create.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(requests.find(({ method }) => method === "POST")).toMatchObject({
      url: expect.objectContaining({ pathname: `/api/v1/groups/${GROUP_ID}/events` }),
      body: {
        slug: "architecture-workshop",
        name: "Architecture workshop",
        profileKey: "workshop",
        registrationPolicy: "no_registration",
        links: [],
      },
    });
    expect(onSaved).toHaveBeenCalledWith(responseEvent);

    const edit = mount(<GroupEventEditor groupId={GROUP_ID} event={responseEvent} onSaved={onSaved} />);
    await act(async () => {
      edit.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(requests.find(({ method }) => method === "PATCH")).toMatchObject({
      url: expect.objectContaining({ pathname: `/api/v1/groups/${GROUP_ID}/events/${responseEvent.id}/settings` }),
      body: {
        expectedUpdatedAt: responseEvent.updatedAt,
        links: responseEvent.links,
        location: responseEvent.location,
      },
    });
  });

  it("manages terms and attendance days from the event context with one shared event revision", async () => {
    const requests: Array<{ pathname: string; method: string; body?: unknown }> = [];
    let revision = responseEvent.updatedAt;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ pathname: url.pathname, method, body });
        if (url.pathname.endsWith("/terms")) {
          if (method === "PUT") {
            revision = "2026-08-01T00:00:01.000Z";
            return json({ success: true, eventUpdatedAt: revision });
          }
          return json({
            eventUpdatedAt: revision,
            terms: {
              attendee: [
                {
                  id: "term-1",
                  audience_type: "attendee",
                  term_key: "event-terms",
                  version: "1.0",
                  required: 1,
                  content_ref: "https://example.test/terms",
                  display_text: "I agree to the event terms",
                  help_text: null,
                },
              ],
              speaker: [],
              presentation: [],
            },
          });
        }
        if (url.pathname.endsWith("/days")) {
          if (method === "PUT") {
            revision = "2026-08-01T00:00:02.000Z";
            return json({
              success: true,
              eventUpdatedAt: revision,
              skipped: [],
            });
          }
          return json({ eventUpdatedAt: revision, days: [] });
        }
        throw new Error(`Unexpected request: ${method} ${url.pathname}`);
      }),
    );

    const container = mount(<GroupEventDetail event={responseEvent} groupId={GROUP_ID} />);
    await settle();
    expect(container.textContent).toContain("Registration setup");
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>("input")).some(
        (input) => input.value === "I agree to the event terms",
      ),
    ).toBe(true);

    const saveTerms = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save terms",
    )!;
    await act(async () => saveTerms.click());
    await settle();
    expect(requests.find(({ pathname, method }) => pathname.endsWith("/terms") && method === "PUT")).toMatchObject({
      body: {
        expectedUpdatedAt: responseEvent.updatedAt,
        configuration: {
          attendee: [
            {
              termKey: "event-terms",
              version: "1.0",
              required: true,
              contentRef: "https://example.test/terms",
              displayText: "I agree to the event terms",
            },
          ],
          speaker: [],
          presentation: [],
        },
      },
    });

    const saveDays = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(
      (button) => button.textContent === "Save days",
    )!;
    await act(async () => saveDays.click());
    await settle();
    expect(requests.find(({ pathname, method }) => pathname.endsWith("/days") && method === "PUT")).toMatchObject({
      body: {
        expectedUpdatedAt: "2026-08-01T00:00:01.000Z",
        configuration: { days: [] },
      },
    });
  });
});
