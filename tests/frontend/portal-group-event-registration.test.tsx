// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventFormsResponse } from "../../assets/shared/schemas/forms";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { GroupEventRegistrationPanel } from "../../assets/ts/member-flows/portal/sections/management/GroupEventRegistrationPanel";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
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

const event: GroupEvent = {
  id: EVENT_ID,
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
  registrationPolicy: "required",
  visibility: "group_members",
  inviteLimitAttendee: 5,
  location: "Online",
  links: [],
  nextOccurrenceAt: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "register"],
};

const term = {
  termKey: "event-terms",
  version: "2026-01",
  required: true,
  contentRef: null,
  displayText: "I agree to the event terms",
  helpText: null,
} as const;

const field = {
  id: "30000000-0000-4000-8000-000000000001",
  key: "role",
  label: "Role",
  fieldType: "text" as const,
  required: false,
  options: null,
  optionSource: null,
  validation: null,
  sortOrder: 0,
  updatedAt: "2026-08-01T00:00:00.000Z",
  archivedAt: null,
};

function config(overrides: Partial<EventFormsResponse> = {}): EventFormsResponse {
  return {
    event: { id: EVENT_ID, slug: event.slug, name: event.name },
    purpose: "event_registration",
    form: {
      id: field.id,
      key: "registration",
      title: "Registration details",
      description: "Tell the event team how you plan to participate.",
      fields: [field],
    },
    requiredTerms: [term],
    allowedSessionTypes: [],
    eventDays: [],
    ...overrides,
  };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal group event registration", () => {
  it("loads dynamic fields and terms, submits attendance and answers, and reports success", async () => {
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
        if (method === "POST") {
          return json({
            success: true,
            registrationId: "40000000-0000-4000-8000-000000000001",
            status: "registered",
            dayAttendance: [],
            dayWaitlist: [],
            shareUrl: null,
            manageUrl: null,
            manageToken: null,
          });
        }
        return json(config());
      }),
    );

    const container = mount(<GroupEventRegistrationPanel groupId={GROUP_ID} event={event} />);
    await settle();
    expect(container.textContent).toContain("Role");
    expect(container.textContent).toContain("Registration details");
    expect(container.textContent).toContain("Tell the event team how you plan to participate.");
    expect(container.textContent).toContain("I agree to the event terms");
    expect(container.textContent).toContain("How will you attend?");

    const form = container.querySelector("form")!;
    const role = form.querySelector<HTMLInputElement>("input[name='custom.role']")!;
    role.value = "Engineer";
    role.dispatchEvent(new Event("input", { bubbles: true }));
    const attendance = form.querySelector<HTMLInputElement>("input[name='attendanceType'][value='virtual']")!;
    attendance.checked = true;
    attendance.dispatchEvent(new Event("change", { bubbles: true }));
    // The consent is a real checkbox now, so the test agrees to it the way
    // a reader does rather than by clicking a styling class.
    form.querySelector<HTMLInputElement>("input[name='consents']")?.click();
    await settle();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests.find(({ method }) => method === "POST")).toMatchObject({
      url: expect.objectContaining({ pathname: `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/registrations` }),
      body: {
        attendanceType: "virtual",
        customAnswers: { role: "Engineer" },
        consents: [{ termKey: "event-terms", version: "2026-01" }],
      },
    });
    expect(requests.find(({ method }) => method === "POST")?.body).not.toHaveProperty("email");
    expect(container.textContent).toContain("Registration submitted.");
  });

  it("renders and submits per-day attendance instead of a global attendance type", async () => {
    const requests: Array<{ method: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        requests.push({ method, body });
        return method === "POST"
          ? json({
              success: true,
              registrationId: "40000000-0000-4000-8000-000000000001",
              status: "registered",
              dayAttendance: [],
              dayWaitlist: [],
              shareUrl: null,
              manageUrl: null,
              manageToken: null,
            })
          : json(
              config({
                eventDays: [
                  {
                    dayDate: "2026-09-01",
                    label: "Day one",
                    inPersonCapacity: null,
                    sortOrder: 0,
                    attendanceOptions: [{ value: "in_person", label: "In person" }],
                  },
                ],
              }),
            );
      }),
    );

    const container = mount(<GroupEventRegistrationPanel groupId={GROUP_ID} event={event} />);
    await settle();
    expect(container.textContent).toContain("Day one");
    expect(container.querySelector("input[name='attendanceType']")).toBeNull();
    const form = container.querySelector("form")!;
    const attendance = form.querySelector<HTMLInputElement>("input[name='dayAttendance.2026-09-01']")!;
    attendance.checked = true;
    attendance.dispatchEvent(new Event("change", { bubbles: true }));
    // The consent is a real checkbox now, so the test agrees to it the way
    // a reader does rather than by clicking a styling class.
    form.querySelector<HTMLInputElement>("input[name='consents']")?.click();
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests.find(({ method }) => method === "POST")?.body).toMatchObject({
      dayAttendance: [{ dayDate: "2026-09-01", attendanceType: "in_person" }],
      consents: [{ termKey: "event-terms", version: "2026-01" }],
    });
    expect(requests.find(({ method }) => method === "POST")?.body).not.toHaveProperty("attendanceType");
  });

  it.each([
    ["no attendee terms", []],
    ["only optional attendee terms", [{ ...term, required: false }]],
  ])("keeps registration unavailable with %s", async (_description, requiredTerms) => {
    const fetchSpy = vi.fn(async () => json(config({ requiredTerms })));
    vi.stubGlobal("fetch", fetchSpy);

    const container = mount(<GroupEventRegistrationPanel groupId={GROUP_ID} event={event} />);
    await settle();

    expect(container.textContent).toContain("required event terms have not been configured");
    expect(container.querySelector<HTMLButtonElement>("button[type='submit']")?.disabled).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("shows a bounded API error instead of a broken registration form", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({ error: { code: "EVENT_REGISTRATION_ACCESS_REQUIRED", message: "Registration access changed" } }, 403),
      ),
    );

    const container = mount(<GroupEventRegistrationPanel groupId={GROUP_ID} event={event} />);
    await settle();

    expect(container.textContent).toContain("Registration access changed");
    expect(container.querySelector("form")).toBeNull();
  });

  it("does not fetch or render a panel without register capability", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const container = mount(
      <GroupEventRegistrationPanel groupId={GROUP_ID} event={{ ...event, capabilities: ["view"] }} />,
    );
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.textContent).toBe("");
  });
});
