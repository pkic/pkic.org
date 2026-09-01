// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sponsorAttendeesListQuerySchema,
  sponsorAttendeesListResponseSchema,
  sponsorCapacitySchema,
} from "../../assets/shared/schemas/sponsor-access";
import { SponsorAttendees } from "../../assets/ts/member-flows/portal/sections/sponsors/Attendees";

const SPONSOR_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000002";
const REGISTRATION_ID = "20000000-0000-4000-8000-000000000003";
const ATTENDEES_PATH = `/api/v1/sponsors/${SPONSOR_ID}/events/spring-summit/attendees`;
const mounted: HTMLElement[] = [];

const capacity = sponsorCapacitySchema.parse({
  sponsorId: SPONSOR_ID,
  eventId: EVENT_ID,
  eventSlug: "spring-summit",
  eventName: "Spring Summit",
  tier: "Gold",
  contactEmail: "sponsor@example.test",
});

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function attendeesResponse(attendees: Array<Record<string, unknown>>) {
  return sponsorAttendeesListResponseSchema.parse({
    attendees,
    page: { limit: 50, offset: 0, total: attendees.length, hasMore: false },
  });
}

const ONE_ATTENDEE = attendeesResponse([
  {
    registrationId: REGISTRATION_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@example.test",
    organizationName: "Analytical Engines",
    jobTitle: "Analyst",
    attendanceType: "in_person",
  },
]);

/** Every request the surface made, with its query already parsed apart. */
interface CapturedRequest {
  path: string;
  query: Record<string, string>;
}

function stubFetch(respond: () => Response): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.origin,
      );
      requests.push({ path: url.pathname, query: Object.fromEntries(url.searchParams) });
      return Promise.resolve(respond());
    }),
  );
  return requests;
}

function mount(onUnauthorized: () => void = () => undefined): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(<SponsorAttendees capacity={capacity} onUnauthorized={onUnauthorized} />, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("sponsor attendee roster", () => {
  it("requests a bounded page of the canonical sponsor resource and names the table it fills", async () => {
    const requests = stubFetch(() => json(ONE_ATTENDEE));

    const container = mount();
    await settle();
    await settle();

    expect(requests[0]?.path).toBe(ATTENDEES_PATH);
    // Checked against the endpoint's own query contract rather than literals,
    // so the assertion cannot outlive the shape the server accepts.
    expect(sponsorAttendeesListQuerySchema.parse(requests[0]?.query)).toMatchObject({
      sort: "name",
      limit: expect.any(Number) as number,
      offset: 0,
      format: "json",
    });

    // A table with no caption is announced as "table"; this page holds one and
    // it says which one.
    expect(container.querySelector("caption")?.textContent).toBe("Consenting attendees for Spring Summit");

    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["Name", "Email", "Organization", "Job title", "Attendance"]);

    const row = container.querySelector("tbody tr");
    expect(row?.textContent).toContain("Ada Lovelace");
    expect(row?.textContent).toContain("ada@example.test");
    expect(row?.textContent).toContain("In person");

    // The export is a navigation to another representation of this list, so it
    // has to be a link a reader can open, copy, or save.
    const download = container.querySelector<HTMLAnchorElement>("a[download]")!;
    expect(download.getAttribute("href")).toBe(`${ATTENDEES_PATH}?format=csv`);
    expect(download.getAttribute("download")).toBe("attendees-spring-summit.csv");
    expect(download.textContent).toBe("Download CSV");
  });

  it("announces an empty roster instead of an empty grid", async () => {
    stubFetch(() => json(attendeesResponse([])));

    const container = mount();
    await settle();
    await settle();

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No consenting attendees yet");
    expect(container.querySelectorAll("tbody tr")).toHaveLength(0);
  });

  it("explains an ineligible sponsorship in an announced message and shows no roster", async () => {
    stubFetch(() =>
      json({ error: { code: "SPONSOR_TIER_INELIGIBLE", message: "Attendee data access is not enabled." } }, 403),
    );

    const container = mount();
    await settle();
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("This sponsorship no longer has attendee data access");
    expect(alert?.textContent).toContain("Contact your PKIC representative");
    expect(container.querySelector("table")).toBeNull();
    expect(container.querySelector("a[download]")).toBeNull();
  });

  it("announces a failure that is not an access decision", async () => {
    stubFetch(() => json({ error: { code: "INTERNAL", message: "The attendee list could not be loaded." } }, 500));

    const container = mount();
    await settle();
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The attendee list could not be loaded.");
    // The failure replaces the roster rather than sitting above a stale one.
    expect(container.querySelector("table")).toBeNull();
  });

  it("hands an expired session back to the workspace rather than reporting it as a roster error", async () => {
    stubFetch(() => json({ error: { code: "UNAUTHORIZED", message: "HTTP 401" } }, 401));
    const onUnauthorized = vi.fn();

    const container = mount(onUnauthorized);
    await settle();
    await settle();

    expect(onUnauthorized).toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});
