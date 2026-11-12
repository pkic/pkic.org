// @vitest-environment jsdom
/**
 * The attendance-change list: the registrations behind the attendance
 * dashboard's detail views.
 *
 * What is asserted here is what a visual review cannot see: that each state
 * says what it means in words, that the filters live in their columns, that
 * the row's activation is a real control, and that a failed list is
 * announced rather than left blank.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  eventRegistrationsListResponseSchema,
  type EventRegistrationSummary,
} from "../../assets/shared/schemas/event-registrations";
import { RegistrationsList } from "../../assets/ts/member-flows/portal/sections/events/detail/Registrations";
import { chooseColumnFilter, columnFilterOptions, columnFilterSummary } from "./helpers/column-menu";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

const NOW = "2026-08-31T09:00:00.000Z";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function registration(overrides: Partial<EventRegistrationSummary> = {}): Record<string, unknown> {
  return {
    id: "40000000-0000-4000-8000-000000000001",
    user_id: "50000000-0000-4000-8000-000000000001",
    created_at: NOW,
    updated_at: NOW,
    user_email: "ada@example.test",
    display_name: "Ada Lovelace",
    headshot_url: null,
    organization_name: null,
    personal_email: false,
    waitlist_handled_last: false,
    job_title: null,
    referral_code: null,
    status: "registered",
    attendance_type: "in_person",
    source_type: "direct",
    rsvp_events_json: null,
    has_bounced: false,
    sponsor_consent: true,
    custom_answers_json: null,
    days: [],
    attendanceChangeHistory: [],
    lastAttendanceChange: null,
    ...overrides,
  };
}

/** Parsed through the shared list contract, so a fixture cannot drift from it. */
function listPage(rows: Array<Record<string, unknown>>): Record<string, unknown> {
  return eventRegistrationsListResponseSchema.parse({
    registrations: rows,
    page: { limit: 25, offset: 0, total: rows.length, count: rows.length, hasMore: false },
    event: { id: "20000000-0000-4000-8000-000000000001", slug: "pqc-2026", name: "PQC Conference 2026" },
    stats: {
      byAttendanceType: { in_person: 1 },
      attendanceStatusByType: { in_person: { total: 1, accepted: 1, waitlisted: 0, confirmed: 1 } },
      byStatus: { registered: 1, pending_email_confirmation: 2 },
      waitlistedCount: 0,
      confirmedCount: 0,
      bouncedCount: 3,
      consentCount: 1,
    },
  }) as unknown as Record<string, unknown>;
}

const mounted: HTMLElement[] = [];

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

/** Every filter control's accessible name, however it was given one. */
function filterNames(root: ParentNode): string[] {
  return [...root.querySelectorAll("select")].map((select) => {
    const labeled = select.id ? root.querySelector(`label[for="${select.id}"]`)?.textContent : null;
    return labeled ?? select.getAttribute("aria-label") ?? "";
  });
}

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("event registrations list", () => {
  it("narrows by status and email delivery from their columns, with no other filter control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<RegistrationsList slug="pqc-2026" attendanceChange="left_in_person" />);
    await settle();
    await settle();

    expect(filterNames(page)).toEqual([]);
    expect(columnFilterOptions(page, "Status")).toEqual([
      "All statuses",
      "Registered",
      "Pending confirmation",
      "Cancelled",
    ]);
    expect(columnFilterOptions(page, "Email")).toEqual(["All email statuses", "Bounced", "Not bounced"]);
  });

  it("sends the attendance change and the column filters to the registrations query", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(new URL(String(input), location.origin));
        return json(listPage([]));
      }),
    );

    const page = mount(<RegistrationsList slug="pqc-2026" attendanceChange="left_in_person" />);
    await settle();
    await settle();
    expect(requests.at(-1)?.searchParams.get("attendance_change")).toBe("left_in_person");

    await chooseColumnFilter(page, "Status", "Cancelled");
    await settle();
    expect(requests.at(-1)?.searchParams.get("status")).toBe("cancelled");
    expect(requests.at(-1)?.searchParams.get("attendance_change")).toBe("left_in_person");
    expect(requests.at(-1)?.searchParams.get("offset")).toBe("0");
    expect(columnFilterSummary(page, "Status")).toBe("Cancelled");
  });

  it("states email delivery in words in its own column, not as a second badge in the status cell", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration({ has_bounced: true })]))),
    );

    const page = mount(<RegistrationsList slug="pqc-2026" attendanceChange="left_in_person" />);
    await settle();
    await settle();

    const heads = [...page.querySelectorAll("th")].map((th) => th.textContent!.trim());
    expect(heads.some((head) => head.startsWith("Email"))).toBe(true);
    const cells = [...page.querySelectorAll("tbody td .pk-table__value")].map((td) => td.textContent!.trim());
    expect(cells).toContain("Bounced");
  });

  it("makes the row's activation a real control with a name that says whose row it is", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<RegistrationsList slug="pqc-2026" attendanceChange="left_in_person" />);
    await settle();
    await settle();

    // Several unnamed tables on one page are announced as several tables.
    expect(page.querySelector("caption")?.textContent).toBe("Event registrations");
    // Never an onClick on the `<tr>`: a row is not focusable and takes no
    // Enter key, which is how fourteen portal lists became mouse-only.
    const rowLink = page.querySelector<HTMLAnchorElement>("tbody a.pk-table__row-link");
    expect(rowLink).not.toBeNull();
    expect(rowLink?.textContent).toBe("View registration for Ada Lovelace");
    expect(page.querySelector("tbody tr")?.getAttribute("onclick")).toBeNull();
  });

  it("keeps the 'View →' column out of the row's announced name, because the row is the link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json(listPage([registration()]))),
    );

    const page = mount(<RegistrationsList slug="pqc-2026" attendanceChange="left_in_person" />);
    await settle();
    await settle();

    const view = [...page.querySelectorAll("[aria-hidden='true']")].find((element) =>
      element.textContent?.includes("View →"),
    );
    expect(view).toBeDefined();
    // And it is not a control: a span wearing button classes is worse than
    // no affordance, because it looks like something to press.
    expect(view?.tagName.toLowerCase()).toBe("span");
  });

  it("announces a failed list as a sentence rather than leaving the table blank", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ error: "unavailable" }, 503)),
    );

    const page = mount(<RegistrationsList slug="pqc-2026" attendanceChange="left_in_person" />);
    await settle();
    await settle();

    const alert = page.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("Online services are temporarily unavailable.");
  });
});
