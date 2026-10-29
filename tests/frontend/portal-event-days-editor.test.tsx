// @vitest-environment jsdom
import { beginRecordEdit } from "./helpers/record-edit";
/**
 * The attendance-days editor after its move onto the design system.
 *
 * The Bootstrap version labeled every control with a bare `form-label`, drew
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
import { axeViolations } from "./helpers/axe";

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
  city: null,
  country: null,
  meetingLocation: null,
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

function labeled(container: HTMLElement, text: string): HTMLInputElement[] {
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
  history.replaceState(null, "", location.pathname);
});

async function openOptions(container: HTMLElement): Promise<void> {
  const tab = [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) =>
    tab.textContent?.startsWith("Options"),
  );
  await act(() => tab!.click());
  await settle();
}

describe("event attendance days editor", () => {
  it.each([false, true])("shows the saved schedule and option details without editing (phone=%s)", async (phone) => {
    vi.stubGlobal("matchMedia", () => ({ matches: phone, addEventListener() {}, removeEventListener() {} }));
    const listed = {
      ...oneDay,
      days: [
        {
          ...oneDay.days[0],
          attendanceOptions: [
            { value: "in_person", label: "In person", description: "At the venue", capacity: 40 },
            { value: "virtual", label: "Virtual", description: "Live stream", enabled: false },
          ],
          attendanceCounts: { in_person: 40 },
        },
      ],
    };
    const captured = stubDays(listed, () => json({}));
    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();
    expect(container.querySelector("form, input, select")).toBeNull();
    expect(container.textContent).toContain("40 places");
    expect(container.textContent).toContain("40 / 40 registered");
    expect(container.textContent).toContain("Full · waitlist");
    expect(container.textContent).toContain("Not offered");
    expect(container.textContent).toContain("09:00 – 17:00");
    expect(container.textContent).toContain("Europe/Amsterdam");
    await openOptions(container);
    if (phone) await act(() => container.querySelector<HTMLElement>("summary")!.click());
    expect(container.textContent).toContain("At the venue");
    expect(container.textContent).toContain("in_person");
    expect(container.querySelector("form, input, select")).toBeNull();
    expect(await axeViolations(container)).toEqual([]);
    expect(captured.every((item) => item.method === "GET")).toBe(true);
    await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Options");
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("edits an option once for every day while preserving each capacity", async () => {
    const listed = {
      ...oneDay,
      days: [
        oneDay.days[0],
        {
          ...oneDay.days[0],
          id: "second-day",
          date: "2026-09-02",
          attendanceOptions: [{ value: "in_person", label: "In person", capacity: 12 }],
        },
      ],
    };
    const captured = stubDays(listed, () =>
      json({ success: true, eventUpdatedAt: "2026-08-02T00:00:00.000Z", skipped: [] }),
    );
    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();
    await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");
    await openOptions(container);
    expect(labeled(container, "Label")).toHaveLength(1);
    await act(() => {
      const label = labeled(container, "Label")[0];
      label.value = "On site";
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await submit(container);
    const body = groupEventDaysReplaceSchema.parse(JSON.parse(captured.find((item) => item.method === "PUT")!.body!));
    expect(body.configuration.days.map((day) => day.attendanceOptions[0])).toEqual([
      { value: "in_person", label: "On site", capacity: 40 },
      { value: "in_person", label: "On site", capacity: 12 },
    ]);
  });

  it("preserves a disabled option and capacity across phone tabs and a desktop resize", async () => {
    let phone = true;
    const listeners = new Set<() => void>();
    vi.stubGlobal("matchMedia", () => ({
      get matches() {
        return phone;
      },
      addEventListener: (_type: string, callback: () => void) => listeners.add(callback),
      removeEventListener: (_type: string, callback: () => void) => listeners.delete(callback),
    }));
    const listed = { ...oneDay, days: [{ ...oneDay.days[0], attendanceCounts: { in_person: 3 } }] };
    const captured = stubDays(listed, () =>
      json({ success: true, eventUpdatedAt: "2026-08-02T00:00:00.000Z", skipped: [] }),
    );
    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();
    await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");
    const availability = container.querySelector<HTMLInputElement>('input[role="switch"]')!;
    await act(() => availability.click());
    expect(availability.checked).toBe(false);
    await openOptions(container);
    await act(() => container.querySelector<HTMLElement>("summary")!.click());
    expect(labeled(container, "Key")[0].readOnly).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('[aria-label="In use by existing registrations"]')?.disabled,
    ).toBe(true);
    expect(await axeViolations(container)).toEqual([]);
    await act(() => {
      phone = false;
      for (const callback of listeners) callback();
    });
    expect(container.querySelector("table")).not.toBeNull();
    await submit(container);
    const body = groupEventDaysReplaceSchema.parse(JSON.parse(captured.find((item) => item.method === "PUT")!.body!));
    expect(body.configuration.days[0].attendanceOptions).toEqual([
      { value: "in_person", label: "In person", capacity: 40, enabled: false },
    ]);
  });

  it("opens and focuses a refused option behind the other phone tab", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
    const captured = stubDays(oneDay, () =>
      json({ success: true, eventUpdatedAt: oneDay.eventUpdatedAt, skipped: [] }),
    );
    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();
    await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");
    await openOptions(container);
    await act(() => container.querySelector<HTMLElement>("summary")!.click());
    await act(() => {
      const label = labeled(container, "Label")[0];
      label.value = "";
      label.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(() =>
      [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
        .find((tab) => tab.textContent === "Schedule")!
        .click(),
    );
    await submit(container);
    await vi.waitFor(() => expect(document.activeElement).toBe(labeled(container, "Label")[0]));
    expect(labeled(container, "Label")[0].getAttribute("aria-invalid")).toBe("true");
    expect(captured.some((item) => item.method === "PUT")).toBe(false);
  });

  it("binds every label to the control it names and marks the required ones", async () => {
    stubDays(oneDay, () => json({ success: true, eventUpdatedAt: oneDay.eventUpdatedAt, skipped: [] }));

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();
    expect(container.querySelectorAll("input, select")).toHaveLength(0);
    await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");

    expect(container.querySelector("form")?.classList.contains("pk")).toBe(true);

    const labels = [...container.querySelectorAll<HTMLLabelElement>("label.pk-field__label")];
    expect(labels.length).toBeGreaterThan(0);
    for (const label of labels) {
      expect(byId(container, label.htmlFor), `label "${label.textContent ?? ""}" points at nothing`).not.toBeNull();
    }

    const [date] = labeled(container, "Date");
    expect(date.value).toBe("2026-09-01");
    expect(date.required).toBe(true);
    // The asterisk is decorative; the word behind it is what is announced.
    expect(labels.find((label) => (label.textContent ?? "").startsWith("Date"))?.textContent).toContain("(required)");

    expect(labeled(container, "Day label")[0].value).toBe("Workshop day");
    expect(labeled(container, "Starts at")[0].value).toBe("09:00");
    expect(container.textContent).toContain("Europe/Amsterdam");
    await openOptions(container);
    expect(labeled(container, "Label").map((input) => input.value)).toEqual(["In person"]);
    const remove = container.querySelector<HTMLButtonElement>('[aria-label="Remove In person"]');
    expect(remove?.disabled).toBe(false);
  });

  it("announces an empty configuration instead of a muted sentence", async () => {
    stubDays(noDays, () => json({ success: true, eventUpdatedAt: noDays.eventUpdatedAt, skipped: [] }));

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={vi.fn()} />,
    );
    await settle();
    expect(container.querySelectorAll("input, select")).toHaveLength(0);
    await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");

    const empty = container.querySelector(".pk-empty-state");
    expect(empty?.getAttribute("role")).toBe("status");
    expect(empty?.textContent).toContain("No attendance days configured");
    expect(container.querySelector(".text-muted")).toBeNull();
  });

  it.each(["people", "video_location", "video_people", "cocktail", "coffee", "dining"])(
    "sends the shared replace contract with %s and announces the saved revision",
    async (selectedIcon) => {
      const onRevision = vi.fn();
      const captured = stubDays(oneDay, () =>
        json({ success: true, eventUpdatedAt: "2026-08-02T00:00:00.000Z", skipped: ["2026-09-02"] }),
      );

      const container = mount(
        <EventDaysEditor
          groupId={GROUP_ID}
          event={event}
          expectedUpdatedAt={event.updatedAt}
          onRevision={onRevision}
        />,
      );
      await settle();
      expect(container.querySelectorAll("input, select")).toHaveLength(0);
      await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");
      await openOptions(container);
      const icon = container.querySelector<HTMLSelectElement>('select[name$=".icon"]')!;
      await act(() => {
        icon.value = selectedIcon;
        icon.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const description = container.querySelector<HTMLInputElement>('input[name$=".description"]')!;
      await act(() => {
        description.value = "Watch together at a partner venue";
        description.dispatchEvent(new Event("input", { bubbles: true }));
      });
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
              sortOrder: 0,
              attendanceOptions: [
                {
                  value: "in_person",
                  label: "In person",
                  capacity: 40,
                  icon: selectedIcon,
                  description: "Watch together at a partner venue",
                },
              ],
            },
          ],
        },
      });

      expect(onRevision).toHaveBeenCalledWith("2026-08-02T00:00:00.000Z");
      const announced = container.querySelector('[role="alert"].pk-alert');
      expect(announced?.textContent).toContain("retained dates in use: 2026-09-02");
    },
  );

  it("interrupts with a rejected save and leaves the form usable", async () => {
    const onRevision = vi.fn();
    stubDays(oneDay, () => json({ error: { code: "CONFLICT", message: "Someone else changed this event." } }, 409));

    const container = mount(
      <EventDaysEditor groupId={GROUP_ID} event={event} expectedUpdatedAt={event.updatedAt} onRevision={onRevision} />,
    );
    await settle();
    expect(container.querySelectorAll("input, select")).toHaveLength(0);
    await beginRecordEdit(container, "Attendance days actions", "Edit attendance days");
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
