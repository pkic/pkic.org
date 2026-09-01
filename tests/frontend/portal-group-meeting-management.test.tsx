// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventOccurrence, GroupEventSeries } from "../../assets/shared/schemas/event-series";
import { GroupMeetingSeriesDetail } from "../../assets/ts/member-flows/portal/sections/management/GroupMeetingSeriesDetail";
import { MeetingGuests } from "../../assets/ts/member-flows/portal/sections/management/MeetingGuests";
import { MeetingOccurrenceEditor } from "../../assets/ts/member-flows/portal/sections/management/MeetingOccurrenceEditor";
import { MeetingSeriesSettings } from "../../assets/ts/member-flows/portal/sections/management/MeetingSeriesSettings";
import { isCurrentTab, tabs } from "./helpers/tabs";

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
  return {
    id: "60000000-0000-4000-8000-000000000005",
    eventId: "70000000-0000-4000-8000-000000000005",
    ownerGroupId: GROUP_ID,
    eventName: "Architecture call",
    eventSlug: "architecture-call",
    profileKey: "meeting",
    registrationPolicy: "no_registration",
    visibility: "group_members",
    memberEligibility: "owner_group",
    guestPolicy: "occurrence_invitation",
    startsAt: "2026-09-01T15:00:00.000Z",
    recurrenceRule: "FREQ=WEEKLY;INTERVAL=1",
    timezone: "Europe/Amsterdam",
    durationMinutes: 60,
    location: "Online",
    providerType: null,
    providerConfigured: false,
    active: true,
    inviteWindow: { startsAt: null, endsAt: null, timezone: "Europe/Amsterdam" },
    nextOccurrenceAt: "2026-09-01T15:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    capabilities: ["view", "manage"],
    occurrenceCount: 0,
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
    for (const suffix of ["start", "recurrence", "timezone", "duration"]) {
      expect(
        container.querySelector<HTMLInputElement>(`#meeting-series-settings-${series.id}-${suffix}`)?.disabled,
      ).toBe(true);
    }
    const name = container.querySelector<HTMLInputElement>(`#meeting-series-settings-${series.id}-name`)!;
    name.value = "Updated materialized call";
    void act(() => {
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
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
    const locationInput = container.querySelector<HTMLInputElement>(
      `#meeting-occurrence-settings-${occurrence.id}-location`,
    )!;
    expect(locationInput.value).toBe("");
    expect(container.querySelector(`#meeting-occurrence-settings-${occurrence.id}-provider-action`)).toBeNull();
    const provider = container.querySelector<HTMLInputElement>(
      `#meeting-occurrence-settings-${occurrence.id}-provider-url`,
    )!;
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
    const provider = container.querySelector<HTMLInputElement>(
      `#meeting-occurrence-settings-${occurrence.id}-provider-url`,
    )!;
    expect(provider.required).toBe(false);
    const locationInput = container.querySelector<HTMLInputElement>(
      `#meeting-occurrence-settings-${occurrence.id}-location`,
    )!;
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
    const occurrence: EventOccurrence = {
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
    };
    const seriesInviteWindow = {
      startsAt: "2026-09-01T13:00:00.000Z",
      endsAt: "2026-09-29T14:00:00.000Z",
      timezone: "UTC",
    };
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
        seriesInviteWindow={seriesInviteWindow}
        timeZone="UTC"
      />,
    );
    await settle();

    expect(container.querySelector(`#meeting-guest-expiry-${occurrence.id}`)).toBeNull();
    const addGuest = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Add guest",
    )!;
    await act(async () => addGuest.click());

    const expiry = container.querySelector<HTMLInputElement>(`#meeting-guest-expiry-${occurrence.id}`)!;
    expect(expiry.value).toBe("2026-09-08T13:00");
    expect(expiry.max).toBe("2026-09-08T14:00");
    const seriesWide = container.querySelector<HTMLInputElement>(`#guest-series-wide-${occurrence.id}`)!;
    seriesWide.checked = true;
    void act(() => {
      seriesWide.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(expiry.value).toBe("2026-09-01T13:00");
    expect(expiry.max).toBe("2026-09-29T14:00");

    const email = container.querySelector<HTMLInputElement>(`#meeting-guest-email-${occurrence.id}`)!;
    email.value = "guest@example.test";
    void act(() => {
      email.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const name = container.querySelector<HTMLInputElement>(`#meeting-guest-name-${occurrence.id}`)!;
    name.value = "External Guest";
    void act(() => {
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();

    expect(requests.find((request) => request.method === "POST")?.body).toEqual({
      email: "guest@example.test",
      name: "External Guest",
      affiliation: null,
      expiresAt: "2026-09-01T13:00:00.000Z",
      seriesWide: true,
    });
  });

  it("opens the tab given by an initial resourceTab", async () => {
    const series = baseSeries();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ occurrences: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })),
    );

    const container = mount(
      <GroupMeetingSeriesDetail groupId={GROUP_ID} series={series} initialTab="settings" onChanged={() => {}} />,
    );

    const settingsTab = tabs(container).find((item) => item.textContent === "Series settings");
    expect(isCurrentTab(settingsTab)).toBe(true);
    expect(container.textContent).toContain("Save series");
  });

  it("falls back to the default tab for an unrecognized or unavailable resourceTab", async () => {
    const series = baseSeries({ capabilities: ["view"] });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ occurrences: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })),
    );

    const container = mount(
      <GroupMeetingSeriesDetail groupId={GROUP_ID} series={series} initialTab="settings" onChanged={() => {}} />,
    );

    expect(tabs(container)).toHaveLength(1);
    const occurrencesTab = tabs(container)[0];
    expect(isCurrentTab(occurrencesTab)).toBe(true);
    expect(occurrencesTab?.textContent).toBe("Occurrences");
  });

  it("navigates to the canonical series tab URL when a tab is clicked", async () => {
    const series = baseSeries();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ occurrences: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } })),
    );

    const container = mount(<GroupMeetingSeriesDetail groupId={GROUP_ID} series={series} onChanged={() => {}} />);

    const settingsTab = tabs(container).find((item) => item.textContent === "Series settings")!;
    expect(settingsTab.getAttribute("href")).toBe(`#/groups/${GROUP_ID}/meetings/${series.id}/settings`);

    await act(async () => {
      settingsTab.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(navigate).toHaveBeenCalledWith(`/groups/${GROUP_ID}/meetings/${series.id}/settings`);
  });
});
