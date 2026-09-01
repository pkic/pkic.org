// @vitest-environment jsdom
/**
 * The attendance-days editor after its move onto the design system.
 *
 * The Bootstrap version labelled every control with a bare `form-label`, drew
 * the day cards with `card`/`row`/`col-md-*`, and reported the outcome of a
 * save in a `text-muted` / `text-danger` span. These assert what replaced
 * them: labels bound to real controls, an announced empty state, and a save
 * result that carries a role rather than only a hue.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GroupEvent } from "../../assets/shared/schemas/group-events";
import { groupEventDaysReplaceSchema } from "../../assets/shared/schemas/group-events";
import { EventDaysEditor } from "../../assets/ts/member-flows/portal/sections/management/EventDaysEditor";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "architecture-workshop";
const DAYS_PATH = `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/days`;

const event: GroupEvent = {
  id: EVENT_ID,
  ownerGroupId: GROUP_ID,
  seriesId: null,
  slug: EVENT_ID,
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
  nextOccurrenceAt: null,
  updatedAt: "2026-08-01T00:00:00.000Z",
  proposalAccess: null,
  capabilities: ["view", "manage"],
};

const oneDay = {
  eventUpdatedAt: "2026-08-01T00:00:00.000Z",
  days: [
    {
      id: "33333333-3333-4333-8333-333333333333",
      date: "2026-09-01",
      label: "Workshop day",
      startsAt: "2026-09-01T07:00:00.000Z",
      endsAt: "2026-09-01T15:00:00.000Z",
      sortOrder: 10,
      attendanceOptions: [{ value: "in_person", label: "In person", capacity: 40 }],
      attendanceCounts: {},
    },
  ],
};

const noDays = { eventUpdatedAt: "2026-08-01T00:00:00.000Z", days: [] };

const mounted: HTMLElement[] = [];

interface Captured {
  method: string;
  body?: string;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function stubDays(listed: unknown, replace: () => Response): Captured[] {
  const captured: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = init.method ?? "GET";
      captured.push({ method, body: typeof init.body === "string" ? init.body : undefined });
      expect(new URL(url, location.origin).pathname).toBe(DAYS_PATH);
      return method === "PUT" ? replace() : json(listed);
    }),
  );
  return captured;
}

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector("form");
  expect(form).not.toBeNull();
  await act(async () => {
    form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await settle();
}

/** `useId` emits ids a CSS selector would have to escape, and jsdom has no `CSS.escape`. */
function byId(container: HTMLElement, id: string): HTMLElement | null {
  return [...container.querySelectorAll<HTMLElement>("[id]")].find((element) => element.id === id) ?? null;
}

function labelled(container: HTMLElement, text: string): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")]
    .filter((label) => (label.textContent ?? "").startsWith(text))
    .map((label) => byId(container, label.htmlFor))
    .filter((element): element is HTMLInputElement => element instanceof HTMLInputElement);
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event attendance days editor", () => {
  it("binds every label to the control it names and marks the required ones", async () => {
    stubDays(oneDay, () => json({ success: true, eventUpdatedAt: oneDay.eventUpdatedAt, skipped: [] }));

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();

    expect(container.querySelector("form")?.classList.contains("pk")).toBe(true);

    const labels = [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(byId(container, label.htmlFor), `label "${label.textContent ?? ""}" points at nothing`).not.toBeNull();
    }

    const [date] = labelled(container, "Date");
    expect(date.value).toBe("2026-09-01");
    expect(date.required).toBe(true);
    // The asterisk is decorative; the word behind it is what is announced.
    expect(labels.find((label) => (label.textContent ?? "").startsWith("Date"))?.textContent).toContain("(required)");

    // The end-to-end flow reaches the option's label with `getByLabel("Label")
    // .last()`, so the day's own label must keep coming first in the DOM.
    const labelFields = labelled(container, "Label");
    expect(labelFields.map((input) => input.value)).toEqual(["Workshop day", "In person"]);

    // The times are the event's wall clock, not the raw UTC instant.
    expect(labelled(container, "Starts at")[0].value).toBe("09:00");
    const startsHelp = labelled(container, "Starts at")[0].getAttribute("aria-describedby") ?? "";
    expect(byId(container, startsHelp)?.textContent).toContain("Europe/Amsterdam");

    // Each remove control says which option it removes; twenty buttons all
    // called "Remove" are indistinguishable control by control.
    const removeOption = [...container.querySelectorAll("button")].filter((button) =>
      (button.textContent ?? "").startsWith("Remove attendance option"),
    );
    expect(removeOption.map((button) => button.textContent)).toEqual(["Remove attendance option 1"]);
  });

  it("announces an empty configuration instead of a muted sentence", async () => {
    stubDays(noDays, () => json({ success: true, eventUpdatedAt: noDays.eventUpdatedAt, skipped: [] }));

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();

    const empty = container.querySelector(".pk-empty-state");
    expect(empty?.getAttribute("role")).toBe("status");
    expect(empty?.textContent).toContain("No attendance days configured");
    expect(container.querySelector(".text-muted")).toBeNull();
  });

  it("sends the shared replace contract and announces the saved revision", async () => {
    const onRevision = vi.fn();
    const captured = stubDays(oneDay, () =>
      json({ success: true, eventUpdatedAt: "2026-08-02T00:00:00.000Z", skipped: ["2026-09-02"] }),
    );

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={onRevision} />,
    );
    await settle();
    await submit(container);

    const put = captured.find(({ method }) => method === "PUT");
    expect(put).toBeDefined();
    // Parsed through the shared request schema, so a body that drifts from the
    // contract fails here rather than at the endpoint.
    expect(groupEventDaysReplaceSchema.parse(JSON.parse(put!.body!))).toEqual({
      expectedUpdatedAt: event.updatedAt,
      configuration: {
        days: [
          {
            date: "2026-09-01",
            label: "Workshop day",
            startTime: "09:00",
            endTime: "17:00",
            sortOrder: 10,
            attendanceOptions: [{ value: "in_person", label: "In person", capacity: 40 }],
          },
        ],
      },
    });

    expect(onRevision).toHaveBeenCalledWith("2026-08-02T00:00:00.000Z");
    const announced = container.querySelector('[role="status"].pk-alert');
    expect(announced?.textContent).toContain("retained dates in use: 2026-09-02");
  });

  it("interrupts with a rejected save and leaves the form usable", async () => {
    const onRevision = vi.fn();
    stubDays(oneDay, () => json({ error: { code: "CONFLICT", message: "Someone else changed this event." } }, 409));

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={onRevision} />,
    );
    await settle();
    await submit(container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain("pk-alert");
    expect(alert?.textContent).toContain("Someone else changed this event.");
    expect(onRevision).not.toHaveBeenCalled();
    // The conflict has to be resolvable, so nothing stays disabled.
    expect(container.querySelector("fieldset")?.disabled).toBe(false);
    expect(container.querySelector('[role="status"].pk-alert')).toBeNull();
  });

  it("reports a failed load through the shared error alert", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: { code: "FORBIDDEN", message: "Event management is required." } }, 403)),
    );

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();

    expect(container.querySelector('[role="alert"]')?.textContent).toContain("Event management is required.");
    expect(container.querySelector("form")).toBeNull();
  });
});
