// @vitest-environment jsdom
/**
 * The occurrence list under a meeting series, and the editor for one row.
 *
 * Both used to end in a `d-flex` action row where the failure alert shared a
 * line with the submit button. What is asserted here is what the surface
 * exposes rather than how it is arranged: the table's name, the disclosure
 * that opens a row, and the announced failure.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EventOccurrence, GroupEventSeries } from "../../assets/shared/schemas/event-series";
import { eventOccurrenceUpdateSchema } from "../../assets/shared/schemas/event-series";
import { confirmAction } from "../../assets/ts/components/ConfirmDialog";
import { MeetingOccurrenceEditor } from "../../assets/ts/member-flows/portal/sections/management/MeetingOccurrenceEditor";
import { MeetingOccurrences } from "../../assets/ts/member-flows/portal/sections/management/MeetingOccurrences";
import { buttonNamed, controlFor, typeInto } from "./helpers/labelled-control";

const navigate = vi.fn();
vi.mock("../../assets/ts/components/ConfirmDialog", () => ({ confirmAction: vi.fn(async () => true) }));

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

function series(overrides: Partial<GroupEventSeries> = {}): GroupEventSeries {
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
    occurrenceCount: 1,
    ...overrides,
  };
}

function occurrence(overrides: Partial<EventOccurrence> = {}): EventOccurrence {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    seriesId: "60000000-0000-4000-8000-000000000005",
    startsAt: "2026-09-01T13:00:00.000Z",
    endsAt: "2026-09-01T14:00:00.000Z",
    status: "scheduled",
    locationOverride: null,
    location: "Online",
    providerConfigured: false,
    guestCount: 0,
    joinConfirmedCount: 0,
    attendanceVerifiedCount: 0,
    invitationsRound: 0,
    invitationsSentAt: null,
    invitedCount: 0,
    calendarSequence: 0,
    rsvp: { accepted: 0, declined: 0, tentative: 0 },
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-25T10:00:00.000Z",
    ...overrides,
  };
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
  navigate.mockReset();
});

describe("meeting occurrence list", () => {
  it("cancels selected occurrences with the loaded revision and refreshes the list", async () => {
    const requests: unknown[] = [];
    let canceled = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") {
          requests.push(eventOccurrenceUpdateSchema.parse(JSON.parse(String(init.body))));
          canceled = true;
          return json({ occurrence: occurrence({ status: "cancelled" }) });
        }
        return json({
          occurrences: [occurrence({ status: canceled ? "cancelled" : "scheduled" })],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }),
    );
    const changed = vi.fn();
    const container = mount(<MeetingOccurrences groupId={GROUP_ID} series={series()} onSeriesChanged={changed} />);
    await settle();
    const select = container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]');
    expect(select).not.toBeNull();
    await act(async () => select!.click());
    await act(async () => buttonNamed(container, "Cancel selected…").click());
    await settle();
    expect(confirmAction).toHaveBeenCalled();
    expect(requests).toEqual([{ expectedUpdatedAt: occurrence().updatedAt, status: "cancelled" }]);
    expect(changed).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(container.textContent).toContain("Cancelled"));
  });

  it("names the table after its series and opens a row as the occurrence's own page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          json({ occurrences: [occurrence()], page: { limit: 50, offset: 0, total: 1, hasMore: false } }),
        ),
      ),
    );

    const container = mount(
      <MeetingOccurrences groupId={GROUP_ID} series={series()} onSeriesChanged={() => undefined} />,
    );
    await settle();

    // A series page shows more than one table, so this one says whose
    // occurrences it lists rather than being a second nameless "table".
    expect(container.querySelector("table caption")?.textContent).toBe("Scheduled occurrences of Architecture call");

    // The row is a link to the occurrence's own address (#126) — a record
    // with facets, never an expansion under the row — and it names what it
    // opens.
    const open = container.querySelector<HTMLAnchorElement>("a.pk-table__row-link");
    expect(open?.textContent).toMatch(/^Open the occurrence starting /);
    expect(open?.getAttribute("href")).toBe(
      `#/groups/${GROUP_ID}/meetings/${series().id}/occurrences/${occurrence().id}`,
    );
    expect(container.querySelector("form")).toBeNull();
    // Who was told, and what their calendars answered, is a column each.
    const headers = [...container.querySelectorAll("thead th")].map((cell) => cell.textContent?.trim() ?? "");
    expect(headers.some((header) => header.startsWith("Invited"))).toBe(true);
    expect(headers.some((header) => header.startsWith("Accepted"))).toBe(true);
  });

  it("announces a rejected occurrence creation below the actions, not beside them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init: RequestInit = {}) => {
        if ((init.method ?? "GET") === "POST") {
          return Promise.resolve(new Response("That slot overlaps another occurrence.", { status: 409 }));
        }
        return Promise.resolve(json({ occurrences: [], page: { limit: 50, offset: 0, total: 0, hasMore: false } }));
      }),
    );

    // Adding is a page of its own, under the reserved `new` segment, rather
    // than a disclosure that unfolds above the list it adds to.
    const list = mount(<MeetingOccurrences groupId={GROUP_ID} series={series()} onSeriesChanged={() => undefined} />);
    await settle();
    expect(list.querySelector("form")).toBeNull();
    expect(buttonNamed(list, "Add occurrence")).toBeTruthy();

    const container = mount(
      <MeetingOccurrences
        groupId={GROUP_ID}
        series={series()}
        occurrenceSegment="new"
        onSeriesChanged={() => undefined}
      />,
    );
    await settle();
    expect(container.querySelector("table")).toBeNull();

    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    // The form stays open with what was entered, rather than closing as if
    // the occurrence had been created.
    expect(container.querySelector("form")).not.toBeNull();
  });
});

describe("meeting occurrence editor", () => {
  it("announces a rejected save and leaves the control usable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("Another editor saved first.", { status: 412 }))),
    );

    const onChanged = vi.fn(() => Promise.resolve());
    const container = mount(
      <MeetingOccurrenceEditor
        endpoint="/api/v1/groups/test/meetings/series/test/occurrences/test"
        occurrence={occurrence({ locationOverride: "Room 1" })}
        timeZone="Europe/Amsterdam"
        onChanged={onChanged}
      />,
    );

    // Something has to change, or the editor short-circuits with "no changes
    // to save" and never reaches the server.
    await typeInto(controlFor(container, "Location override"), "Room 2");
    await act(async () => {
      container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent).not.toBe("");
    expect(onChanged).not.toHaveBeenCalled();
    // The draft survives the failure rather than snapping back.
    expect(controlFor(container, "Location override").value).toBe("Room 2");
    const submit = container.querySelector<HTMLButtonElement>('button[type="submit"]');
    expect(submit?.disabled).toBe(false);
    expect(submit?.hasAttribute("aria-busy")).toBe(false);
  });
});
