// @vitest-environment jsdom
/**
 * A meeting occurrence's attendance list, and the detail band it opens in.
 *
 * What a screenshot cannot check: whether the table says which table it is,
 * whether each row's verify control names the person it acts on rather than
 * being one of a column of identical "Verify" buttons, whether verification
 * is stated in words as well as by a tone, and what the surface says when the
 * endpoint refuses.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  eventAttendanceListResponseSchema,
  type EventOccurrence,
  type GroupEventSeries,
} from "../../assets/shared/schemas/event-series";
import { MeetingAttendance } from "../../assets/ts/member-flows/portal/sections/management/MeetingAttendance";
import { MeetingOccurrenceDetail } from "../../assets/ts/member-flows/portal/sections/management/MeetingOccurrenceDetail";
import { isCurrentTab, tabs } from "./helpers/tabs";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

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

describe("meeting occurrence attendance", () => {
  const BASE = `/api/v1/groups/${GROUP_ID}/meetings/series/60000000-0000-4000-8000-000000000004`;

  /** Contract-checked on the way out, the way `getJson` checks it on the way in. */
  function attendancePage(confirmations: unknown[]): Response {
    return json(
      eventAttendanceListResponseSchema.parse({
        confirmations,
        page: { limit: 50, offset: 0, total: confirmations.length, hasMore: false },
      }),
    );
  }

  function confirmation(overrides: Record<string, unknown> = {}) {
    return {
      id: "90000000-0000-4000-8000-000000000001",
      occurrenceId: "80000000-0000-4000-8000-000000000004",
      userId: null,
      guestId: null,
      name: "Ada Lovelace",
      affiliation: "Analytical Engines Ltd",
      joinCount: 2,
      confirmedAt: "2026-09-08T13:05:00.000Z",
      attendanceVerifiedAt: null,
      attendanceVerificationSource: null,
      ...overrides,
    };
  }

  it("names the table and each row's verify control after the person it acts on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => attendancePage([confirmation()])),
    );

    const container = mount(<MeetingAttendance base={BASE} occurrence={guestOccurrence()} />);
    await settle();

    expect(container.querySelector("caption")?.textContent).toBe("Meeting attendance");
    // A column of controls all reading "Verify" is nothing to choose between
    // when they are listed on their own.
    const verify = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Verify attendance for Ada Lovelace"]',
    );
    expect(verify).not.toBeNull();
    // Verification state is stated in words, not carried by a tint.
    expect(container.querySelector("tbody")?.textContent).toContain("Not verified");
  });

  it("offers no verify control for an attendee already verified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => attendancePage([confirmation({ attendanceVerifiedAt: "2026-09-08T14:00:00.000Z" })])),
    );

    const container = mount(<MeetingAttendance base={BASE} occurrence={guestOccurrence()} />);
    await settle();

    expect(container.querySelector('button[aria-label^="Verify attendance"]')).toBeNull();
    expect(container.querySelector("tbody")?.textContent).toContain("Verified");
  });

  it("names the verification filter and sends the choice to the attendance query", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input), location.origin));
        return attendancePage([]);
      }),
    );

    const container = mount(<MeetingAttendance base={BASE} occurrence={guestOccurrence()} />);
    await settle();

    const filter = container.querySelector<HTMLSelectElement>('select[aria-label="Attendance verification"]')!;
    expect(filter).not.toBeNull();
    // The default view is the server default: no `verified` parameter at all.
    expect(requests.some((url) => url.searchParams.has("verified"))).toBe(false);

    filter.value = "false";
    await act(async () => {
      filter.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await settle();

    expect(requests.some((url) => url.searchParams.get("verified") === "false")).toBe(true);
  });

  it("states a refused attendance listing as a sentence rather than an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: "no" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<MeetingAttendance base={BASE} occurrence={guestOccurrence()} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(alert?.textContent).not.toContain("HTTP 403");
    expect(container.querySelector("table")).toBeNull();
  });

  it("opens the occurrence as a named panel whose tab points at the panel it controls", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => attendancePage([])),
    );

    const occurrence = guestOccurrence();
    const container = mount(
      <MeetingOccurrenceDetail
        base={BASE}
        occurrence={occurrence}
        series={baseSeries()}
        canManage={false}
        canManageAttendance
        onChanged={vi.fn()}
      />,
    );
    await settle();

    const panel = container.querySelector(`#meeting-occurrence-detail-${occurrence.id}`);
    expect(panel?.getAttribute("aria-label")).toBe("Occurrence of Architecture call");
    const tab = tabs(container).find(isCurrentTab)!;
    expect(tab.textContent).toBe("Attendance");
    // The tab names the region it swaps in, rather than promising a panel that
    // is not there.
    const controlled = tab.getAttribute("aria-controls")!;
    expect(container.querySelector(`#${controlled}`)?.getAttribute("role")).toBe("tabpanel");
  });
});
