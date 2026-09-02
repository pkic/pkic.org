// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventOccurrenceGuestInviteSchema,
  type EventOccurrence,
  type GroupEventSeries,
} from "../../assets/shared/schemas/event-series";
import { MeetingGuests } from "../../assets/ts/member-flows/portal/sections/management/MeetingGuests";
import { MeetingOccurrenceEditor } from "../../assets/ts/member-flows/portal/sections/management/MeetingOccurrenceEditor";
import { MeetingSeriesSettings } from "../../assets/ts/member-flows/portal/sections/management/MeetingSeriesSettings";
import { buttonNamed, controlFor, labelNames, typeInto } from "./helpers/labelled-control";
import { groupEventSeriesFixture } from "./helpers/meeting-series-fixture";

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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  navigate.mockReset();
});

function baseSeries(overrides: Partial<GroupEventSeries> = {}): GroupEventSeries {
  return groupEventSeriesFixture(GROUP_ID, overrides);
}

const SERIES_INVITE_WINDOW = {
  startsAt: "2026-09-01T13:00:00.000Z",
  endsAt: "2026-09-29T14:00:00.000Z",
  timezone: "UTC",
};

function guestOccurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: "80000000-0000-4000-8000-000000000004",
    seriesId: "60000000-0000-4000-8000-000000000004",
    startsAt: "2026-09-08T13:00:00.000Z",
    endsAt: "2026-09-08T14:00:00.000Z",
    status: "scheduled",
    locationOverride: null,
    location: "Online",
    providerConfigured: true,
    guestCount: 0,
    joinConfirmedCount: 0,
    attendanceVerifiedCount: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

describe("portal group meeting management", () => {
  it("sends a true series patch and keeps materialized schedule fields locked", async () => {
    const requests: Array<{ url: URL; method: string; body?: unknown }> = [];
    const series: GroupEventSeries = {
      id: "60000000-0000-4000-8000-000000000002",
      eventId: "70000000-0000-4000-8000-000000000002",
      ownerGroupId: GROUP_ID,
      eventName: "Materialized call",
      eventSlug: "materialized-call",
      profileKey: "meeting",
      registrationPolicy: "no_registration",
      visibility: "group_members",
      memberEligibility: "owner_group",
      guestPolicy: "occurrence_invitation",
      startsAt: "2026-09-01T13:00:00.000Z",
      recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
      timezone: "Europe/Amsterdam",
      durationMinutes: 60,
      location: "Online",
      providerType: null,
      providerConfigured: false,
      active: true,
      inviteWindow: {
        startsAt: "2026-09-01T13:00:00.000Z",
        endsAt: "2026-09-08T14:00:00.000Z",
        timezone: "Europe/Amsterdam",
      },
      nextOccurrenceAt: "2026-09-01T13:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
      capabilities: ["view", "manage"],
      occurrenceCount: 2,
    };
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
        return json({ series: { ...series, eventName: "Updated materialized call", active: false } });
      }),
    );
    const onChanged = vi.fn(async () => {});
    const container = mount(<MeetingSeriesSettings groupId={GROUP_ID} series={series} onChanged={onChanged} />);
    expect(container.textContent).toContain("recurring schedule is locked");
    // Every control is inside a `Field`, which pairs label and control by
    // generated id, so each is resolved through that pair — the lookup then
    // fails exactly when the labelling contract is broken rather than when an
    // id is renamed.
    for (const label of ["Repeats", "Time zone", "First occurrence", "Duration (minutes)"]) {
      expect(controlFor(container, label).disabled).toBe(true);
    }
    await typeInto(controlFor(container, "Meeting name"), "Updated materialized call");
    const active = container.querySelector<HTMLInputElement>(`#meeting-series-active-${series.id}`)!;
    active.checked = false;
    void act(() => {
      active.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      method: "PATCH",
      body: {
        eventName: "Updated materialized call",
        active: false,
        expectedUpdatedAt: series.updatedAt,
      },
    });
    expect(requests[0].body).not.toHaveProperty("startsAt");
    expect(requests[0].body).not.toHaveProperty("recurrenceRule");
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("adds the first encrypted provider URL without copying an inherited location into the override", async () => {
    const requests: Array<{ body?: unknown }> = [];
    const occurrence: EventOccurrence = {
      id: "80000000-0000-4000-8000-000000000001",
      seriesId: "60000000-0000-4000-8000-000000000001",
      startsAt: "2026-09-01T13:00:00.000Z",
      endsAt: "2026-09-01T14:00:00.000Z",
      status: "scheduled",
      locationOverride: null,
      location: "Inherited series location",
      providerConfigured: false,
      guestCount: 0,
      joinConfirmedCount: 0,
      attendanceVerifiedCount: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
        return json({ occurrence: { ...occurrence, providerConfigured: true } });
      }),
    );
    const onChanged = vi.fn(async () => {});
    const container = mount(
      <MeetingOccurrenceEditor
        endpoint="/api/v1/groups/test/meetings/series/test/occurrences/test"
        occurrence={occurrence}
        timeZone="Europe/Amsterdam"
        onChanged={onChanged}
      />,
    );
    const locationInput = controlFor(container, "Location override");
    expect(locationInput.value).toBe("");
    // No provider is configured, so the reader is asked for a URL rather than
    // what to do with one that does not exist.
    expect(controlFor(container, "Meeting-provider URL").tagName).toBe("INPUT");
    const provider = controlFor(container, "Meeting-provider URL");
    provider.value = "https://meet.example.test/new-room";
    void act(() => {
      provider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests[0].body).toEqual({
      providerJoinUrl: "https://meet.example.test/new-room",
      expectedUpdatedAt: occurrence.updatedAt,
    });
    expect(onChanged).toHaveBeenCalledOnce();
  });

  it("updates an occurrence without requiring a provider URL that has never been configured", async () => {
    const requests: Array<{ body?: unknown }> = [];
    const occurrence: EventOccurrence = {
      id: "80000000-0000-4000-8000-000000000003",
      seriesId: "60000000-0000-4000-8000-000000000001",
      startsAt: "2026-09-01T13:00:00.000Z",
      endsAt: "2026-09-01T14:00:00.000Z",
      status: "scheduled",
      locationOverride: null,
      location: "Inherited series location",
      providerConfigured: false,
      guestCount: 0,
      joinConfirmedCount: 0,
      attendanceVerifiedCount: 0,
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-25T10:00:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        requests.push({ body: typeof init.body === "string" ? JSON.parse(init.body) : undefined });
        return json({ occurrence: { ...occurrence, locationOverride: "Room 2", location: "Room 2" } });
      }),
    );
    const container = mount(
      <MeetingOccurrenceEditor
        endpoint="/api/v1/groups/test/meetings/series/test/occurrences/test"
        occurrence={occurrence}
        timeZone="Europe/Amsterdam"
        onChanged={() => {}}
      />,
    );
    const provider = controlFor(container, "Meeting-provider URL");
    expect(provider.required).toBe(false);
    const locationInput = controlFor(container, "Location override");
    locationInput.value = "Room 2";
    void act(() => {
      locationInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests[0].body).toEqual({
      locationOverride: "Room 2",
      expectedUpdatedAt: occurrence.updatedAt,
    });
  });

  it("defaults guest validity to the selected scope and submits the canonical shared contract", async () => {
    const requests: Array<{ method: string; body?: Record<string, unknown> }> = [];
    const occurrence = guestOccurrence();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        const method = init.method ?? "GET";
        const body = typeof init.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined;
        requests.push({ method, body });
        if (method === "POST") {
          return json({
            guest: {
              id: "90000000-0000-4000-8000-000000000004",
              occurrenceId: occurrence.id,
              seriesId: occurrence.seriesId,
              seriesWide: body?.seriesWide,
              userId: null,
              email: body?.email,
              name: body?.name,
              affiliation: body?.affiliation,
              expiresAt: body?.expiresAt,
              active: true,
              revokedAt: null,
              createdAt: "2026-08-27T00:00:00.000Z",
              updatedAt: "2026-08-27T00:00:00.000Z",
            },
          });
        }
        return json({ guests: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );
    const container = mount(
      <MeetingGuests
        base="/api/v1/groups/test/meetings/series/test"
        occurrence={occurrence}
        seriesInviteWindow={SERIES_INVITE_WINDOW}
        timeZone="UTC"
      />,
    );
    await settle();

    expect(labelNames(container)).not.toContain("Eligibility expires");
    await act(async () => buttonNamed(container, "Add guest").click());

    const expiry = controlFor(container, "Eligibility expires");
    expect(expiry.value).toBe("2026-09-08T13:00");
    expect(expiry.max).toBe("2026-09-08T14:00");
    const seriesWide = controlFor(container, "Eligible for every occurrence in this series");
    seriesWide.checked = true;
    void act(() => {
      seriesWide.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(expiry.value).toBe("2026-09-01T13:00");
    expect(expiry.max).toBe("2026-09-29T14:00");

    await typeInto(controlFor(container, "Email"), "guest@example.test");
    await typeInto(controlFor(container, "Name"), "External Guest");
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    // Parsed through the shared contract rather than compared to a literal, so
    // the assertion fails if the surface stops sending what the endpoint takes.
    const posted = requests.find((request) => request.method === "POST")?.body;
    expect(eventOccurrenceGuestInviteSchema.parse(posted)).toEqual({
      email: "guest@example.test",
      name: "External Guest",
      affiliation: null,
      expiresAt: "2026-09-01T13:00:00.000Z",
      seriesWide: true,
    });
  });

  it("keeps the guest form open and states the reason when the invitation is rejected", async () => {
    const occurrence = guestOccurrence();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "POST") {
          return new Response(
            JSON.stringify({
              error: { code: "GUEST_ALREADY_ELIGIBLE", message: "That guest is already eligible for this occurrence." },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          );
        }
        return json({ guests: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } });
      }),
    );
    const container = mount(
      <MeetingGuests
        base="/api/v1/groups/test/meetings/series/test"
        occurrence={occurrence}
        seriesInviteWindow={SERIES_INVITE_WINDOW}
        timeZone="UTC"
      />,
    );
    await settle();
    await act(async () => buttonNamed(container, "Add guest").click());
    await typeInto(controlFor(container, "Email"), "guest@example.test");
    await typeInto(controlFor(container, "Name"), "External Guest");
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    // The failure is announced, not only toasted, and nothing the reviewer
    // typed is thrown away.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("already eligible");
    expect(controlFor(container, "Email").value).toBe("guest@example.test");
    expect(container.querySelector("form")).not.toBeNull();
  });

  it("names the guest table and every control the add form asks for", async () => {
    const occurrence = guestOccurrence();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ guests: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } })),
    );
    const container = mount(
      <MeetingGuests
        base="/api/v1/groups/test/meetings/series/test"
        occurrence={occurrence}
        seriesInviteWindow={SERIES_INVITE_WINDOW}
        timeZone="UTC"
      />,
    );
    await settle();

    expect(container.querySelector("table caption")?.textContent).toBe("External guests for this meeting occurrence");

    await act(async () => buttonNamed(container, "Add guest").click());
    expect(labelNames(container)).toEqual(
      expect.arrayContaining([
        "Email",
        "Name",
        "Affiliation",
        "Eligibility expires",
        "Eligible for every occurrence in this series",
      ]),
    );
    // A checkbox needs all three parts of the block: the label, the input, and
    // the text. Only the first renders an operating-system default control.
    const scope = controlFor(container, "Eligible for every occurrence in this series");
    expect(scope.classList.contains("pk-check__input")).toBe(true);
    const scopeLabel = scope.closest("label")!;
    expect(scopeLabel.classList.contains("pk-check")).toBe(true);
    expect(scopeLabel.querySelector(".pk-check__label")?.textContent).toBe(
      "Eligible for every occurrence in this series",
    );
    // Required fields say so through the attribute, not only the asterisk.
    expect(controlFor(container, "Email").required).toBe(true);
    expect(controlFor(container, "Affiliation").required).toBe(false);
  });

  it("draws the series' active switch as a real check block, and names the generate panel", () => {
    const series = baseSeries();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ series })),
    );

    const container = mount(<MeetingSeriesSettings groupId={GROUP_ID} series={series} onChanged={() => {}} />);

    // All three parts, or the browser draws its own box in its own accent —
    // which no gate can see and which looks like a bug beside our controls.
    const active = container.querySelector<HTMLLabelElement>("label.pk-check")!;
    expect(active.querySelector("input.pk-check__input")).not.toBeNull();
    expect(active.querySelector("span.pk-check__label")?.textContent).toBe("Active series");
    expect(container.querySelector<HTMLInputElement>(`#meeting-series-active-${series.id}`)).not.toBeNull();

    // The generation panel is a named region, not an unlabelled box among the
    // several this editor stacks up.
    const panel = [...container.querySelectorAll("section.pk-panel")].at(-1);
    const headingId = panel?.getAttribute("aria-labelledby");
    expect(headingId).toBeTruthy();
    expect(container.querySelector(`[id="${headingId!}"]`)?.textContent).toBe("Generate recurring occurrences");

    // And its one control is named by a real for/id pair.
    expect(controlFor(container, "Generate through").tagName.toLowerCase()).toBe("input");
  });

  it("keeps the series form open and announces a rejected save as an alert", async () => {
    const series = baseSeries();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "conflict" }), {
            status: 409,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<MeetingSeriesSettings groupId={GROUP_ID} series={series} onChanged={() => {}} />);
    await typeInto(controlFor(container, "Meeting name"), "Renamed call");
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    // The reader is told what happened in a sentence, not by a status code or
    // a red border, and the draft they typed is still there to retry.
    expect(alert?.textContent).toContain("Someone else changed this at the same time.");
    expect(controlFor<HTMLInputElement>(container, "Meeting name").value).toBe("Renamed call");
    expect(buttonNamed(container, "Save series")).toBeDefined();
  });
});
